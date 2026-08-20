/**
 * Subagents from an earlier segment of this session.
 *
 * The manager owns live subagents: each entry holds a session, a scope and a
 * pump fiber, and none of those survive a /reload. Rather than forge entries
 * without them — every send, abort and teardown path would have to learn about
 * a subagent that cannot be any of those things — restored subagents live
 * beside the manager, and the two are composed into one read model for the
 * dashboard.
 *
 * That keeps the concurrency-critical part of the extension untouched, and
 * gives restored subagents exactly the capabilities they can honour: they can
 * be listed and read, and they refuse to be steered or aborted.
 */

import type { SubagentReadModel } from "./manager.ts";
import type {
  BackendName,
  SubagentSnapshot,
  SubagentStatus,
  TranscriptItem,
} from "./domain.ts";

/** A settled subagent, as written to the session log. */
export interface SubagentHistoryRecord {
  readonly snapshot: SubagentSnapshot;
}

/** Transcripts are the point of keeping any of this — the collapsed row shows
 * a line of it — but they are also the only unbounded part, so the tail is
 * what survives. */
const MAX_TRANSCRIPT_ITEMS = 200;
const MAX_TEXT = 4000;

function trimText(text: string): string {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT)}…`;
}

function trimItem(item: TranscriptItem): TranscriptItem {
  switch (item.kind) {
    case "user":
      return { kind: "user", text: trimText(item.text) };
    case "assistant":
      return {
        kind: "assistant",
        parts: item.parts.map((part) =>
          part.type === "toolCall" ? part : { ...part, text: trimText(part.text) },
        ),
      };
    case "toolResult":
      return item.outputPreview === undefined
        ? item
        : { ...item, outputPreview: trimText(item.outputPreview) };
  }
}

/**
 * A snapshot as it should be written down: settled, without the live-run
 * scaffolding. A running subagent is not written at all — it will not be
 * running after the reload, and recording it as running would leave a ghost
 * the dashboard waits on forever.
 */
export function toHistoryRecord(
  snapshot: SubagentSnapshot,
): SubagentHistoryRecord | undefined {
  if (snapshot.status === "running") return undefined;
  return {
    snapshot: {
      ...snapshot,
      transcript: snapshot.transcript.slice(-MAX_TRANSCRIPT_ITEMS).map(trimItem),
      liveTools: [],
      queued: [],
      ...(snapshot.liveAssistant === undefined ? {} : { liveAssistant: undefined }),
    },
  };
}

const STATUSES: ReadonlySet<string> = new Set(["running", "done", "error"]);

/**
 * A record from disk, back into a snapshot. Validated rather than trusted: the
 * log outlives the version of this extension that wrote it. A subagent
 * recorded as running is read as an error — whatever it was doing, it stopped
 * when the session it belonged to did.
 */
export function fromHistoryRecord(value: unknown): SubagentSnapshot | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const snapshot = (value as Partial<SubagentHistoryRecord>).snapshot;
  if (typeof snapshot !== "object" || snapshot === null) return undefined;
  const candidate = snapshot as Partial<SubagentSnapshot>;
  if (typeof candidate.id !== "string" || candidate.id === "") return undefined;
  if (typeof candidate.title !== "string") return undefined;
  if (typeof candidate.status !== "string" || !STATUSES.has(candidate.status)) {
    return undefined;
  }
  const status: SubagentStatus =
    candidate.status === "running" ? "error" : (candidate.status as SubagentStatus);
  const meta = candidate.meta;
  if (typeof meta !== "object" || meta === null) return undefined;
  return {
    id: candidate.id,
    origin: candidate.origin === "btw" ? "btw" : "model",
    backend: (candidate.backend ?? meta.backend ?? "pi") as BackendName,
    title: candidate.title,
    prompt: typeof candidate.prompt === "string" ? candidate.prompt : "",
    cwd: typeof candidate.cwd === "string" ? candidate.cwd : "",
    status,
    createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : 0,
    ...(typeof candidate.settledAt === "number"
      ? { settledAt: candidate.settledAt }
      : {}),
    ...(typeof candidate.errorText === "string"
      ? { errorText: candidate.errorText }
      : status === "error" && candidate.status === "running"
        ? { errorText: "did not survive the session it was spawned in" }
        : {}),
    meta,
    usage: candidate.usage ?? {},
    transcript: Array.isArray(candidate.transcript) ? candidate.transcript : [],
    liveTools: [],
    queued: [],
    finalText: typeof candidate.finalText === "string" ? candidate.finalText : "",
    turns: typeof candidate.turns === "number" ? candidate.turns : 0,
  };
}

/**
 * The live read model with restored subagents behind it. A live subagent wins
 * any id collision: the one that exists now is the one that can be steered.
 */
export function withHistory(
  view: SubagentReadModel,
  restored: ReadonlyArray<SubagentSnapshot>,
): SubagentReadModel {
  const byId = new Map(restored.map((snapshot) => [snapshot.id, snapshot]));
  const historyOnly = () => {
    const live = new Set(view.list().map((snapshot) => snapshot.id));
    return [...byId.values()].filter((snapshot) => !live.has(snapshot.id));
  };

  return {
    list: () => [...view.list(), ...historyOnly()],
    get: (id) => view.get(id) ?? byId.get(id),
    size: () => view.size() + historyOnly().length,
    subscribe: (listener) => view.subscribe(listener),
    subscribeTo: (id, listener) =>
      // A restored subagent never changes again, so a subscription to one is
      // an unsubscribe that costs nothing.
      view.get(id) ? view.subscribeTo(id, listener) : () => {},
    requestSend: (id, text) => {
      if (view.get(id)) view.requestSend(id, text);
    },
    requestAbort: (id) => {
      if (view.get(id)) view.requestAbort(id);
    },
    setOnSettled: (hook) => view.setOnSettled(hook),
  };
}
