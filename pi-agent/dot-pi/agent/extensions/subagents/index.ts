/**
 * Subagents — spawn background subagents on in-process pi sessions, with
 * intent-based model routing.
 *
 * The caller declares intent (`effort` plus optional `needs`) rather than a
 * model; `src/router.ts` resolves that against this machine's model registry
 * using `routing.json`. The same config therefore works across machines with
 * different providers configured.
 *
 * Tools (for the parent LLM):
 * - subagent_spawn: fire-and-forget spawn (prompt, name, effort, needs,
 *   working_dir, model override). Max 4 running at once.
 * - subagent_wait: block until the listed subagents settle, return results.
 * - subagent_cancel: stop one or more running subagents.
 * - subagent_check: peek at a subagent's status and recent activity.
 * - subagent_list: list all subagents.
 *
 * Unawaited subagents queue their result as a follow-up message when they
 * settle. `/subagents` opens a picker + full interactive takeover view;
 * `/routing` shows the routing table and what each tier resolves to here.
 *
 * Architecture: Effect v4 generators throughout (backend -> manager ->
 * runtime); this file is the async boundary where tool handlers run effects
 * against one shared ManagedRuntime.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  getAgentDir,
  getMarkdownTheme,
  ProjectTrustStore,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Markdown, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { UI_ICONS } from "../shared/tui-kit/icons.ts";
import { plainResultText, toolCallTitle } from "../shared/tui-kit/row.ts";
import { deriveBtwTitle, isModelVisible } from "./src/by-the-way.ts";
import {
  formatElapsed,
  latestText,
  type SubagentSnapshot,
} from "./src/domain.ts";
import {
  EFFORTS,
  loadRoutingConfig,
  NEEDS,
  REASONING_LEVELS_FOR_TIERS,
  routeModel,
  saveRoutingConfig,
  setTierModels,
  setTierThinking,
  type Effort,
  type ModelLike,
  type Need,
  type RoutingConfig,
} from "./src/router.ts";
import {
  buildTierMenu,
  describeTier,
  parseTierChoice,
} from "./src/routing-ui.ts";
import {
  registrySnapshot,
  validateExplicitModel,
} from "./src/registry-snapshot.ts";
import { CHILD_FILE_CHANNEL } from "../shared/dashboard-state.ts";
import {
  historySessionId,
  openSessionLog,
  type SessionLog,
} from "../shared/session-log.ts";
import {
  fromHistoryRecord,
  toHistoryRecord,
  withHistory,
  type SubagentHistoryRecord,
} from "./src/history.ts";
import { COMMAND_CHANNEL } from "../shared/command-log.ts";
import type { ChildCommand, ChildFile } from "./src/domain.ts";
import { buildModelChoices } from "../shared/model-choices.ts";
import { formatContextUtilization } from "./src/format.ts";
import { formatSubagentsStatus } from "./src/status.ts";
import { SubagentManager, type SubagentManagerShape } from "./src/manager.ts";
import {
  buildSubagentResultMessage,
  buildSubagentSpawnResult,
  SUBAGENT_CANCEL_PARAMETER_DESCRIPTIONS,
  SUBAGENT_CANCEL_TOOL_DESCRIPTION,
  SUBAGENT_CHECK_PARAMETER_DESCRIPTIONS,
  SUBAGENT_CHECK_TOOL_DESCRIPTION,
  SUBAGENT_LIST_TOOL_DESCRIPTION,
  SUBAGENT_SPAWN_PARAMETER_DESCRIPTIONS,
  SUBAGENT_SPAWN_PROMPT_GUIDELINES,
  SUBAGENT_SPAWN_PROMPT_SNIPPET,
  SUBAGENT_SPAWN_TOOL_DESCRIPTION,
  SUBAGENT_WAIT_PARAMETER_DESCRIPTIONS,
  SUBAGENT_WAIT_TOOL_DESCRIPTION,
} from "./src/prompt.ts";
import { createDeferredResultDelivery } from "./src/result-delivery.ts";
import {
  createSubagentRuntime,
  runTool,
  type SubagentRuntime,
} from "./src/runtime.ts";
import { openSubagentPicker, openSubagentTakeover } from "./src/ui/takeover.ts";

const SUBAGENT_OUTPUT_MAX_BYTES = 24 * 1024;
const WAIT_OUTPUT_MAX_BYTES = 48 * 1024;
const WAIT_PER_AGENT_MAX_BYTES = 16 * 1024;

interface BtwResultData {
  readonly id: string;
  readonly title: string;
  readonly status: SubagentSnapshot["status"];
  readonly errorText?: string;
  readonly prompt: string;
  readonly answer: string;
  readonly sessionFilePath?: string;
}

function describeSubagent(snap: SubagentSnapshot) {
  const details = [
    `${snap.backend}: ${snap.meta.modelLabel ?? "?"}`,
    formatContextUtilization(snap.usage),
    formatElapsed(snap),
    snap.cwd,
  ].filter(Boolean);
  return `${snap.id} [${snap.status}] "${snap.title}" (${details.join(", ")})`;
}

function truncatedOutput(
  snap: SubagentSnapshot,
  maxBytes = SUBAGENT_OUTPUT_MAX_BYTES,
): string {
  const output = snap.finalText || "(no output)";
  const truncation = truncateHead(output, {
    maxBytes: Math.min(maxBytes, DEFAULT_MAX_BYTES),
    maxLines: Math.min(600, DEFAULT_MAX_LINES),
  });
  let text = truncation.content;
  if (truncation.truncated) {
    text += `\n\n[Output truncated: ${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)} shown. Full transcript in session file: ${snap.meta.sessionFilePath ?? "?"}]`;
  }
  return text;
}

/**
 * Same-directory children inherit the live parent decision. An alternate cwd
 * is trusted only when pi's persisted trust store explicitly trusts it (or a
 * containing directory); unreadable/invalid trust data fails closed.
 */
function resolveChildProjectTrust(options: {
  parentCwd: string;
  childCwd: string;
  parentTrusted: boolean;
}) {
  if (path.resolve(options.childCwd) === path.resolve(options.parentCwd)) {
    return options.parentTrusted;
  }
  try {
    const trustStore = new ProjectTrustStore(getAgentDir());
    return trustStore.get(options.childCwd) === true;
  } catch {
    return false;
  }
}

/** This extension's own directory, where `routing.json` lives. */
const EXTENSION_DIR = path.dirname(url.fileURLToPath(import.meta.url));

function routeSpawn(
  ctx: ExtensionContext,
  effort: Effort | undefined,
  needs: readonly Need[] | undefined,
) {
  return routeModel(registrySnapshot(ctx), loadRoutingConfig(EXTENSION_DIR), {
    effort,
    needs,
    inherited: ctx.model
      ? { provider: ctx.model.provider, id: ctx.model.id }
      : undefined,
  });
}

/**
 * Pick an ordered candidate list for one tier. Selection repeats so the first
 * pick is the preferred model and later picks are fallbacks, which is exactly
 * the order `routeModel` walks.
 */
async function pickTierModels(
  ctx: ExtensionCommandContext,
  models: readonly ModelLike[],
  current: readonly string[],
) {
  const chosen: string[] = [];
  for (;;) {
    const remaining = buildModelChoices(models, { selected: chosen }).filter(
      (choice) => !chosen.includes(choice.value),
    );
    if (remaining.length === 0) break;

    const position = chosen.length === 0 ? "preferred" : `fallback ${chosen.length}`;
    const doneLabel =
      chosen.length === 0 ? "Cancel (keep current)" : `Done (${chosen.length} selected)`;
    const choice = await ctx.ui.select(
      `Choose the ${position} model`,
      [...remaining.map((entry) => entry.label), doneLabel],
    );
    if (choice === undefined || choice === doneLabel) break;

    const picked = remaining.find((entry) => entry.label === choice);
    if (!picked) break;
    chosen.push(picked.value);
  }
  return chosen.length > 0 ? chosen : [...current];
}

/** The `/routing` dialog loop: pick a tier, edit it, repeat until done. */
async function runRoutingEditor(
  ctx: ExtensionCommandContext,
  models: readonly ModelLike[],
) {
  let config = loadRoutingConfig(EXTENSION_DIR);
  let dirty = false;

  for (;;) {
    const menu = buildTierMenu(config, models);
    const choice = await ctx.ui.select(
      "Subagent routing — choose a tier to configure",
      menu,
    );
    if (choice === undefined) break;

    const effort = parseTierChoice(choice);
    if (!effort) break;

    const action = await ctx.ui.select(describeTier(effort, config, models), [
      "Choose models",
      "Set thinking level",
      "Clear this tier",
      "Back",
    ]);
    if (action === undefined || action === "Back") continue;

    if (action === "Choose models") {
      const picked = await pickTierModels(
        ctx,
        models,
        config.tiers[effort].models,
      );
      config = setTierModels(config, effort, picked);
      dirty = true;
    } else if (action === "Set thinking level") {
      const level = await ctx.ui.select(
        `Thinking level for "${effort}"`,
        [...REASONING_LEVELS_FOR_TIERS],
      );
      if (level) {
        config = setTierThinking(config, effort, level as never);
        dirty = true;
      }
    } else if (action === "Clear this tier") {
      config = setTierModels(config, effort, []);
      dirty = true;
    }
  }

  if (!dirty) return;
  try {
    saveRoutingConfig(EXTENSION_DIR, config);
    ctx.ui.notify(
      `Saved routing config.\n${EFFORTS.map((effort) =>
        describeTier(effort, config, models),
      ).join("\n")}`,
      "info",
    );
  } catch (error) {
    ctx.ui.notify(
      `Could not save routing config: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
  }
}

export default function (pi: ExtensionAPI) {
  let runtime: SubagentRuntime | undefined;
  let managerPromise: Promise<SubagentManagerShape> | undefined;
  let sessionContext: ExtensionContext | undefined;
  let ui: ExtensionUIContext | undefined;
  let unsubStatus: (() => void) | undefined;
  const resultDelivery = createDeferredResultDelivery<SubagentSnapshot>();
  /** Opened at session_start, once the session id is known. */
  let log: SessionLog<SubagentHistoryRecord> | undefined;
  /** Subagents from an earlier segment of this session. They cannot be
   * steered or aborted, so they live beside the manager rather than in it. */
  let restored: ReadonlyArray<SubagentSnapshot> = [];

  const getRuntime = () => (runtime ??= createSubagentRuntime());

  /** Resolve the manager service once per runtime and wire the extension hooks. */
  const getManager = () => {
    managerPromise ??= getRuntime()
      .runPromise(SubagentManager)
      .then((manager) => {
        manager.view.setOnSettled(onSettled);
        unsubStatus?.();
        unsubStatus = manager.view.subscribe(() => updateStatus(manager));
        updateStatus(manager);
        return manager;
      });
    return managerPromise;
  };

  const updateStatus = (manager: SubagentManagerShape) => {
    if (!ui) return;
    try {
      // No guard on an empty list: with no subagents all three counts are
      // zero, which the formatter already reads as "nothing to show".
      const subs = manager.view.list();
      const running = subs.filter((snap) => snap.status === "running").length;
      const failed = subs.filter((snap) => snap.status === "error").length;
      const done = subs.length - running - failed;
      ui.setStatus(
        "subagents",
        formatSubagentsStatus(ui.theme, { running, done, failed }),
      );
    } catch {
      // UI unavailable in print/RPC modes or during teardown.
    }
  };

  const deliverResult = (snap: SubagentSnapshot) => {
    pi.sendMessage(
      {
        customType: "subagent-result",
        content: buildSubagentResultMessage({
          id: snap.id,
          title: snap.title,
          status: snap.status,
          errorText: snap.errorText,
          output: truncatedOutput(snap),
        }),
        display: true,
        details: { id: snap.id, title: snap.title, status: snap.status },
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  };

  const flushResults = () => {
    for (const snap of resultDelivery.drain()) deliverResult(snap);
  };

  const deliverBtwResult = (snap: SubagentSnapshot) => {
    // appendEntry is a synchronous SessionManager operation and emits an
    // entry_appended event, so it is safe while the parent is streaming and
    // never enters the model's context or follow-up queue.
    pi.appendEntry<BtwResultData>("btw-result", {
      id: snap.id,
      title: snap.title,
      status: snap.status,
      errorText: snap.errorText,
      prompt: snap.prompt,
      answer: truncatedOutput(snap),
      sessionFilePath: snap.meta.sessionFilePath,
    });
    ui?.notify(
      snap.status === "error"
        ? `by the way “${snap.title}” failed — reopen it with /subagents`
        : `by the way “${snap.title}” answered — reopen it with /subagents`,
      snap.status === "error" ? "error" : "info",
    );
  };

  const onSettled = (snap: SubagentSnapshot, consumed: boolean) => {
    // Settling is the one moment a subagent is both finished and still in
    // memory, so it is where the session log is written. Before the origin
    // branch below: a `by the way` subagent belongs in the history too.
    const record = toHistoryRecord(snap);
    if (record) log?.append(record);
    // A shutdown can settle children while disposing their scopes. Never
    // append into a session whose extension runtime is already closing.
    if (!sessionContext) return;
    if (snap.origin === "btw") {
      deliverBtwResult({ ...snap, meta: { ...snap.meta } });
      return;
    }
    if (consumed) {
      resultDelivery.consume([snap.id]);
      return;
    }
    // Keep the result retractable while the parent is working. A later
    // subagent_wait can consume it before agent_settled flushes follow-ups.
    // Defer a copy: the live snapshot keeps mutating if the subagent is
    // restarted before the deferred result flushes.
    resultDelivery.defer({ ...snap, meta: { ...snap.meta } });
    if (sessionContext?.isIdle()) flushResults();
  };

  pi.on("session_start", (event, ctx) => {
    sessionContext = ctx;
    if (ctx.hasUI) ui = ctx.ui;
    try {
      const current = ctx.sessionManager.getSessionId();
      const history = historySessionId(
        event.reason,
        current,
        event.previousSessionFile,
      );
      // Writes always go to the current session; only the read follows a fork
      // back to where it came from.
      log = openSessionLog<SubagentHistoryRecord>({
        sessionId: current,
        surface: "subagents",
      });
      if (!history) return;
      const records =
        history === current
          ? log.readAll()
          : openSessionLog<SubagentHistoryRecord>({
              sessionId: history,
              surface: "subagents",
            }).readAll();
      const byId = new Map<string, SubagentSnapshot>();
      for (const value of records) {
        const snapshot = fromHistoryRecord(value);
        // Later records win: a subagent that was restarted was written twice.
        if (snapshot) byId.set(snapshot.id, snapshot);
      }
      restored = [...byId.values()];
    } catch {
      // History is a convenience. A session that cannot read it still works.
    }
  });

  pi.on("agent_settled", flushResults);

  pi.on("session_shutdown", async () => {
    sessionContext = undefined;
    resultDelivery.clear();
    unsubStatus?.();
    unsubStatus = undefined;
    ui?.setStatus("subagents", undefined);
    ui = undefined;
    const closing = runtime;
    runtime = undefined;
    managerPromise = undefined;
    // Disposing the runtime runs the manager finalizer, which tears down all
    // subagent scopes (and, later, their real child processes).
    await closing?.dispose();
  });

  // --- Tools -------------------------------------------------------------

  pi.registerTool({
    name: "subagent_spawn",
    label: "Spawn Subagent",
    description: SUBAGENT_SPAWN_TOOL_DESCRIPTION,
    promptSnippet: SUBAGENT_SPAWN_PROMPT_SNIPPET,
    promptGuidelines: SUBAGENT_SPAWN_PROMPT_GUIDELINES,
    parameters: Type.Object({
      prompt: Type.String({
        description: SUBAGENT_SPAWN_PARAMETER_DESCRIPTIONS.prompt,
      }),
      name: Type.String({
        description: SUBAGENT_SPAWN_PARAMETER_DESCRIPTIONS.name,
      }),
      effort: Type.Optional(
        StringEnum(EFFORTS, {
          description: SUBAGENT_SPAWN_PARAMETER_DESCRIPTIONS.effort,
        }),
      ),
      needs: Type.Optional(
        Type.Array(StringEnum(NEEDS), {
          description: SUBAGENT_SPAWN_PARAMETER_DESCRIPTIONS.needs,
        }),
      ),
      working_dir: Type.Optional(
        Type.String({
          description: SUBAGENT_SPAWN_PARAMETER_DESCRIPTIONS.workingDir,
        }),
      ),
      model: Type.Optional(
        Type.String({
          description: SUBAGENT_SPAWN_PARAMETER_DESCRIPTIONS.model,
        }),
      ),
    }),
    renderShell: "self",
    renderCall(args, theme) {
      return new Text(
        toolCallTitle(
          UI_ICONS.agent,
          "subagent_spawn",
          typeof args.name === "string" ? args.name : undefined,
          theme,
        ),
        0,
        0,
      );
    },
    renderResult(result, options, theme, context) {
      return new Text(plainResultText(result, theme, context, options), 0, 0);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const manager = await getManager();

      const cwd = path.resolve(ctx.cwd, params.working_dir ?? ".");
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        throw new Error(`working_dir is not a directory: ${cwd}`);
      }

      // An explicit `model` bypasses the router entirely, but is still checked
      // for credentials here: spawning first would create a session and hold a
      // concurrency slot only to die on the first request.
      if (params.model) {
        const check = validateExplicitModel(
          ctx.modelRegistry as never,
          params.model,
        );
        if (check._tag !== "Ok") throw new Error(check.message);
      }

      const route = params.model
        ? undefined
        : routeSpawn(ctx, params.effort, params.needs);
      if (route?._tag === "Unroutable") throw new Error(route.message);

      const title = params.name.trim().slice(0, 160) || "subagent";
      const snap = await runTool(
        getRuntime(),
        manager.spawn("pi", {
          prompt: params.prompt,
          title,
          cwd,
          model: params.model ?? route?.model,
          reasoningEffort: route?.thinking,
          parent: {
            parentCwd: ctx.cwd,
            projectTrusted: resolveChildProjectTrust({
              parentCwd: ctx.cwd,
              childCwd: cwd,
              parentTrusted: ctx.isProjectTrusted(),
            }),
            inheritedModel: ctx.model
              ? { provider: ctx.model.provider, id: ctx.model.id }
              : undefined,
            inheritedThinkingLevel: pi.getThinkingLevel(),
            modelRegistry: ctx.modelRegistry,
            onFileTouched: (file: ChildFile) =>
              pi.events.emit(CHILD_FILE_CHANNEL, {
                ...file,
                cwd,
                origin: { kind: "subagent", id: title, name: title },
              }),
            onCommandRun: (command: ChildCommand) =>
              pi.events.emit(COMMAND_CHANNEL, {
                ...command,
                cwd,
                origin: { kind: "subagent", id: title, name: title },
              }),
          },
        }),
        { signal, interruptMessage: "Subagent spawn aborted." },
      );

      return {
        content: [
          {
            type: "text",
            text: buildSubagentSpawnResult({
              id: snap.id,
              title: snap.title,
              effort: params.effort ?? "standard",
              modelLabel: snap.meta.modelLabel ?? "?",
              routeReason: route?.reason ?? "explicit",
              cwd,
            }),
          },
        ],
        details: {
          id: snap.id,
          title: snap.title,
          cwd,
          effort: params.effort ?? "standard",
          needs: params.needs ?? [],
          model: snap.meta.modelLabel,
        },
      };
    },
  });

  pi.registerTool({
    name: "subagent_wait",
    label: "Wait for Subagents",
    description: SUBAGENT_WAIT_TOOL_DESCRIPTION,
    parameters: Type.Object({
      ids: Type.Array(Type.String(), {
        maxItems: 64,
        description: SUBAGENT_WAIT_PARAMETER_DESCRIPTIONS.ids,
      }),
    }),
    renderShell: "self",
    renderCall(args, theme) {
      const detail = Array.isArray(args.ids) ? args.ids.join(", ") : undefined;
      return new Text(
        toolCallTitle(UI_ICONS.agent, "subagent_wait", detail, theme),
        0,
        0,
      );
    },
    renderResult(result, options, theme, context) {
      return new Text(plainResultText(result, theme, context, options), 0, 0);
    },
    async execute(_toolCallId, params, signal, onUpdate) {
      const manager = await getManager();
      const ids = [...new Set(params.ids)];
      if (ids.length === 0)
        throw new Error("Provide at least one subagent id.");
      const known = manager.view
        .list()
        .filter(isModelVisible)
        .map((snap) => snap.id);
      const unknown = ids.filter((id) => {
        const snap = manager.view.get(id);
        return !snap || !isModelVisible(snap);
      });
      if (unknown.length > 0) {
        throw new Error(
          `Unknown subagent id(s): ${unknown.join(", ")}. Known: ${known.join(", ") || "none"}.`,
        );
      }

      await runTool(
        getRuntime(),
        manager.waitFor(ids, (pending) => {
          onUpdate?.({
            content: [
              { type: "text", text: `Waiting for ${pending.join(", ")}...` },
            ],
            details: { pending },
          });
        }),
        { signal, interruptMessage: "Wait aborted. Subagents keep running." },
      );

      // Settlement may have happened before this wait began. Remove any
      // deferred automatic delivery now that the tool is returning the result.
      resultDelivery.consume(ids);

      const sections: string[] = [];
      let remainingBytes = WAIT_OUTPUT_MAX_BYTES;
      for (const id of ids) {
        const snap = manager.view.get(id);
        if (!snap) {
          sections.push(`## ${id}\n\n(no longer tracked)`);
          continue;
        }
        const verb = snap.status === "error" ? "failed" : "finished";
        let section = `## ${snap.id} "${snap.title}" ${verb}`;
        if (snap.errorText) section += `\nError: ${snap.errorText}`;
        const headerBytes = Buffer.byteLength(section, "utf8") + 2;
        const outputBudget = Math.max(
          512,
          Math.min(WAIT_PER_AGENT_MAX_BYTES, remainingBytes - headerBytes),
        );
        section += `\n\n${truncatedOutput(snap, outputBudget)}`;
        const sectionBytes = Buffer.byteLength(section, "utf8");
        if (sectionBytes > remainingBytes) {
          sections.push(
            `## ${snap.id} "${snap.title}"\n\n[omitted: total wait output limit reached]`,
          );
          break;
        }
        sections.push(section);
        remainingBytes -= sectionBytes;
      }

      const combined = sections.join("\n\n---\n\n");
      const bounded = truncateHead(combined, {
        maxBytes: WAIT_OUTPUT_MAX_BYTES - 128,
        maxLines: DEFAULT_MAX_LINES,
      });
      const text = bounded.truncated
        ? `${bounded.content}\n\n[wait output truncated at the total output limit]`
        : bounded.content;
      return {
        content: [{ type: "text", text }],
        details: {
          results: ids.map((id) => {
            const snap = manager.view.get(id);
            return { id, title: snap?.title, status: snap?.status };
          }),
        },
      };
    },
  });

  pi.registerTool({
    name: "subagent_cancel",
    label: "Cancel Subagents",
    description: SUBAGENT_CANCEL_TOOL_DESCRIPTION,
    parameters: Type.Object({
      ids: Type.Array(Type.String(), {
        description: SUBAGENT_CANCEL_PARAMETER_DESCRIPTIONS.ids,
      }),
    }),
    renderShell: "self",
    renderCall(args, theme) {
      const detail = Array.isArray(args.ids) ? args.ids.join(", ") : undefined;
      return new Text(
        toolCallTitle(UI_ICONS.agent, "subagent_cancel", detail, theme),
        0,
        0,
      );
    },
    renderResult(result, options, theme, context) {
      return new Text(plainResultText(result, theme, context, options), 0, 0);
    },
    async execute(_toolCallId, params, signal) {
      const manager = await getManager();
      const ids = [...new Set(params.ids)];
      if (ids.length === 0)
        throw new Error("Provide at least one subagent id.");

      const known = manager.view
        .list()
        .filter(isModelVisible)
        .map((snap) => snap.id);
      const unknown = ids.filter((id) => {
        const snap = manager.view.get(id);
        return !snap || !isModelVisible(snap);
      });
      if (unknown.length > 0) {
        throw new Error(
          `Unknown subagent id(s): ${unknown.join(", ")}. Known: ${known.join(", ") || "none"}.`,
        );
      }

      const report = await runTool(getRuntime(), manager.cancel(ids), {
        signal,
        interruptMessage: "Subagent cancellation aborted.",
      });

      const lines = report.map((entry) =>
        entry.cancelled
          ? `Cancelled ${entry.id} "${entry.title}".`
          : `${entry.id} "${entry.title}" was already ${entry.status}.`,
      );

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          results: report.map((entry) => ({
            id: entry.id,
            title: entry.title,
            status: entry.status,
          })),
        },
      };
    },
  });

  pi.registerTool({
    name: "subagent_check",
    label: "Check Subagent",
    description: SUBAGENT_CHECK_TOOL_DESCRIPTION,
    parameters: Type.Object({
      id: Type.String({
        description: SUBAGENT_CHECK_PARAMETER_DESCRIPTIONS.id,
      }),
    }),
    renderShell: "self",
    renderCall(args, theme) {
      return new Text(
        toolCallTitle(
          UI_ICONS.agent,
          "subagent_check",
          typeof args.id === "string" ? args.id : undefined,
          theme,
        ),
        0,
        0,
      );
    },
    renderResult(result, options, theme, context) {
      return new Text(plainResultText(result, theme, context, options), 0, 0);
    },
    async execute(_toolCallId, params) {
      const manager = await getManager();
      const snap = manager.view.get(params.id);
      if (!snap || !isModelVisible(snap)) {
        const known = manager.view
          .list()
          .filter(isModelVisible)
          .map((s) => s.id);
        throw new Error(
          `Unknown subagent id "${params.id}". Known: ${known.join(", ") || "none"}.`,
        );
      }

      let text = `${describeSubagent(snap)}\nTurns: ${snap.turns}`;
      if (snap.errorText) text += `\nError: ${snap.errorText}`;

      const output = latestText(snap);
      if (output) {
        const preview = truncateHead(output, { maxBytes: 2048, maxLines: 20 });
        text += `\n\nLatest output:\n${preview.content}`;
        if (preview.truncated) text += "\n[...]";
      } else if (snap.status === "running") {
        text += "\n\n(no text output yet)";
      }

      return {
        content: [{ type: "text", text }],
        details: { id: snap.id, status: snap.status, turns: snap.turns },
      };
    },
  });

  pi.registerTool({
    name: "subagent_list",
    label: "List Subagents",
    description: SUBAGENT_LIST_TOOL_DESCRIPTION,
    parameters: Type.Object({}),
    renderShell: "self",
    renderCall(_args, theme) {
      return new Text(
        toolCallTitle(UI_ICONS.agent, "subagent_list", undefined, theme),
        0,
        0,
      );
    },
    renderResult(result, options, theme, context) {
      return new Text(plainResultText(result, theme, context, options), 0, 0);
    },
    async execute() {
      const manager = await getManager();
      const subs = manager.view.list().filter(isModelVisible);
      const text =
        subs.length === 0
          ? "No subagents."
          : subs.map((snap) => describeSubagent(snap)).join("\n");
      return {
        content: [{ type: "text", text }],
        details: {
          subagents: subs.map((snap) => ({
            id: snap.id,
            title: snap.title,
            model: snap.meta.modelLabel,
            status: snap.status,
          })),
        },
      };
    },
  });

  // --- Result message rendering ------------------------------------------

  pi.registerMessageRenderer(
    "subagent-result",
    (message, { expanded }, theme) => {
      const details = (message.details ?? {}) as {
        id?: string;
        title?: string;
        status?: string;
      };
      const failed = details.status === "error";
      const icon = failed ? theme.fg("error", "x") : theme.fg("success", "■");
      const header =
        `${icon} ` +
        theme.fg("accent", theme.bold(`subagent ${details.id ?? "?"}`)) +
        theme.fg(
          "muted",
          ` · ${details.title ?? ""} · ${failed ? "failed" : "finished"}`,
        );

      const content =
        typeof message.content === "string" ? message.content : "";
      // Remove only the summary line. The following Error line (when present)
      // is part of the actual result and must remain visible.
      const body = content.split("\n").slice(1).join("\n").trim();

      if (expanded) {
        const md = new Markdown(`${body}`, 0, 0, getMarkdownTheme());
        const container = new Text(header, 0, 0);
        return {
          render: (width: number) => [
            ...container.render(width),
            ...md.render(width),
          ],
          invalidate: () => {
            container.invalidate();
            md.invalidate();
          },
        };
      }

      const previewLines = body.split("\n").slice(0, 8);
      let text = header;
      for (const line of previewLines)
        text += `\n${theme.fg("toolOutput", line)}`;
      if (body.split("\n").length > 8)
        text += `\n${theme.fg("dim", "... (ctrl+o to expand)")}`;
      return new Text(text, 0, 0);
    },
  );

  pi.registerEntryRenderer<BtwResultData>(
    "btw-result",
    (entry, { expanded }, theme) => {
      const data = entry.data;
      const failed = data?.status === "error";
      const icon = failed ? theme.fg("error", "x") : theme.fg("success", "■");
      const header =
        `${icon} ` +
        theme.fg("accent", theme.bold(`by the way · ${data?.title ?? "?"}`)) +
        theme.fg(
          "muted",
          ` · ${failed ? "failed" : "answered"} · ${data?.id ?? "?"}`,
        );
      const body = [
        data?.errorText ? `Error: ${data.errorText}` : "",
        data?.answer ?? "(no answer)",
      ]
        .filter(Boolean)
        .join("\n\n");

      if (expanded) {
        const md = new Markdown(body, 0, 0, getMarkdownTheme());
        const container = new Text(header, 0, 0);
        return {
          render: (width: number) => [
            ...container.render(width),
            ...md.render(width),
          ],
          invalidate: () => {
            container.invalidate();
            md.invalidate();
          },
        };
      }

      const lines = body.split("\n");
      let text = header;
      for (const line of lines.slice(0, 8))
        text += `\n${theme.fg("toolOutput", line)}`;
      if (lines.length > 8)
        text += `\n${theme.fg("dim", "... (ctrl+o to expand)")}`;
      return new Text(text, 0, 0);
    },
  );

  // --- Commands -----------------------------------------------------------

  const runByTheWay = async (rawArgs: string, ctx: ExtensionCommandContext) => {
    if (ctx.mode !== "tui") {
      if (ctx.hasUI)
        ctx.ui.notify("by the way is only available in the TUI", "error");
      return;
    }

    let prompt = rawArgs.trim();
    if (!prompt) {
      const input = await ctx.ui.input("by the way", "Ask a one-off question…");
      prompt = input?.trim() ?? "";
      if (!prompt) return;
    }

    const btwTitle = deriveBtwTitle(prompt);
    const manager = await getManager();
    let snap: SubagentSnapshot;
    try {
      snap = await runTool(
        getRuntime(),
        manager.spawn("pi", {
          origin: "btw",
          prompt,
          title: btwTitle,
          cwd: ctx.cwd,
          parent: {
            parentCwd: ctx.cwd,
            projectTrusted: ctx.isProjectTrusted(),
            inheritedModel: ctx.model
              ? { provider: ctx.model.provider, id: ctx.model.id }
              : undefined,
            inheritedThinkingLevel: pi.getThinkingLevel(),
            modelRegistry: ctx.modelRegistry,
            onFileTouched: (file: ChildFile) =>
              pi.events.emit(CHILD_FILE_CHANNEL, {
                ...file,
                cwd: ctx.cwd,
                origin: { kind: "subagent", id: btwTitle, name: btwTitle },
              }),
            onCommandRun: (command: ChildCommand) =>
              pi.events.emit(COMMAND_CHANNEL, {
                ...command,
                cwd: ctx.cwd,
                origin: { kind: "subagent", id: btwTitle, name: btwTitle },
              }),
          },
        }),
      );
    } catch (error) {
      ctx.ui.notify(
        error instanceof Error ? error.message : String(error),
        "error",
      );
      return;
    }

    await openSubagentTakeover(ctx, manager.view, snap.id, {
      badge: "by the way",
    });
  };

  pi.registerCommand("btw", {
    description:
      "Ask a one-off side question while the main agent keeps working",
    handler: runByTheWay,
  });

  pi.registerCommand("routing", {
    description: "Configure which models each subagent effort tier uses",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      const models = registrySnapshot(sessionContext ?? ({} as never));
      if (models.length === 0) {
        ctx.ui.notify(
          "No models are visible in this session, so there is nothing to configure.",
          "warning",
        );
        return;
      }
      await runRoutingEditor(ctx, models);
    },
  });

  pi.registerCommand("subagents", {
    description: "List, inspect, and take over subagents",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        if (ctx.hasUI)
          ctx.ui.notify(
            "Subagent takeover is only available in the TUI",
            "error",
          );
        return;
      }
      const manager = await getManager();
      // Live subagents first, then whatever an earlier segment of this
      // session left behind.
      const view = withHistory(manager.view, restored);
      if (view.size() === 0) {
        ctx.ui.notify(
          "No subagents yet. The agent spawns them with subagent_spawn.",
          "info",
        );
        return;
      }
      await openSubagentPicker(ctx, view);
    },
  });
}
