/**
 * A session's collapsed surfaces, written down so they survive it.
 *
 * /files, /cmds and /subagents are read models built as the session runs, and
 * the transcript rows behind them are collapsed to a line or two on purpose.
 * That trade is only fair while the read model exists: after /reload or
 * /resume the stores start empty, the rows are still collapsed, and the detail
 * is gone for good. This is the sidecar that gives it back.
 *
 * Append-only JSON lines, one file per surface per session, because the
 * failure mode of an append-only file is a truncated last line and the failure
 * mode of a rewritten one is an empty file. Nothing here reaches the model:
 * it is local state on disk, and replaying it costs one small read rather than
 * a walk through the transcript.
 *
 * Every operation swallows its errors. A log that cannot be written is worth
 * less than the session it is logging.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface SessionLog<T> {
  append(record: T): void;
  /** Every record still readable, oldest first. */
  readAll(): T[];
  readonly file: string;
}

export interface SessionLogOptions {
  readonly sessionId: string;
  /** "files" | "commands" | "subagents" — one file each. */
  readonly surface: string;
  /** State root. Defaults to `<agentDir>/state`. Injected by tests. */
  readonly root?: string;
  /** Beyond this, the oldest records are dropped on read, so a long session
   * cannot make replay unbounded. */
  readonly maxRecords?: number;
}

const DEFAULT_MAX_RECORDS = 5000;

/** Ids and surfaces become path segments, so anything that could climb out of
 * the root is flattened rather than trusted. */
function segment(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return safe === "" ? "_" : safe;
}

export function defaultStateRoot(agentDir?: string): string {
  if (agentDir) return path.join(agentDir, "state");
  try {
    return path.join(getAgentDir(), "state");
  } catch {
    return path.join(os.homedir(), ".pi", "agent", "state");
  }
}

export function openSessionLog<T>(options: SessionLogOptions): SessionLog<T> {
  const root = options.root ?? defaultStateRoot();
  const directory = path.join(root, segment(options.sessionId));
  const file = path.join(directory, `${segment(options.surface)}.jsonl`);
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;

  return {
    file,

    append(record) {
      try {
        fs.mkdirSync(directory, { recursive: true });
        fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
      } catch {
        // Read-only home, a full disk, a path taken by a directory: none of
        // them are worth interrupting a session over.
      }
    },

    readAll() {
      let text: string;
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        return [];
      }
      const records: T[] = [];
      for (const line of text.split("\n")) {
        if (!line) continue;
        try {
          const parsed: unknown = JSON.parse(line);
          // A crash between the write and the newline leaves half a record;
          // that is expected, not exceptional.
          if (typeof parsed === "object" && parsed !== null) {
            records.push(parsed as T);
          }
        } catch {
          continue;
        }
      }
      // Recent history is the history anyone wants back.
      return records.length > maxRecords
        ? records.slice(records.length - maxRecords)
        : records;
    },
  };
}

/**
 * Which session's history a `session_start` should replay, or undefined for a
 * session that starts with none.
 *
 * A fork continues the history it forked from; a brand new session inherits
 * nothing, however recently its predecessor was on screen.
 */
export function historySessionId(
  reason: "startup" | "reload" | "new" | "resume" | "fork",
  currentSessionId: string,
  previousSessionFile: string | undefined,
): string | undefined {
  switch (reason) {
    case "startup":
    case "reload":
    case "resume":
      return currentSessionId;
    case "fork":
      return previousSessionFile
        ? path.basename(previousSessionFile, path.extname(previousSessionFile))
        : undefined;
    case "new":
      return undefined;
  }
}

/** Delete state directories not modified within `maxAgeMs`. Best effort. */
export function pruneState(
  root: string,
  maxAgeMs: number,
  now: number = Date.now(),
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, entry.name);
    try {
      if (fs.statSync(directory).mtimeMs >= now - maxAgeMs) continue;
      fs.rmSync(directory, { recursive: true, force: true });
    } catch {
      continue;
    }
  }
}
