/**
 * What a FAILED tool call can tell its row.
 *
 * executeAndRecord writes nothing down when the tool throws — there is no
 * diff to record — and a call rejected before execute (a blocked or invalid
 * one) never reaches it at all. So a failed row is built from the only two
 * things the render slots still hold: the arguments the model sent, and the
 * error text the harness wrapped the rejection in.
 */

import type { FileChange } from "./domain.ts";
import { storeKeyFor } from "./paths.ts";
import { SELF } from "./record.ts";

/** The path the call named, as a store key, or undefined when the arguments
 * never got as far as naming one. Both spellings are accepted because the
 * built-ins accept both (edit.js:107). */
export function failedCallPath(args: unknown, cwd: string): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const record = args as { path?: unknown; file_path?: unknown };
  const raw = typeof record.path === "string" ? record.path : record.file_path;
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  return storeKeyFor(cwd, raw);
}

/**
 * The reason, folded to one line: the result's text blocks, the same ones the
 * built-in paints into its red box (edit.js:115-118). Escapes are stripped
 * rather than passed through — the reason is drawn inside a dim line, and a
 * stray SGR from a tool message would repaint the rest of the row.
 */
export function failureReason(content: ReadonlyArray<unknown> | undefined): string {
  if (!content) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const typed = block as { type?: unknown; text?: unknown };
      if (typed.type !== "text" || typeof typed.text !== "string") return "";
      return typed.text;
    })
    .join(" ")
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The change a failed call stands for: a path and nothing else. The counts
 * are zero because nothing was applied, not because nothing was asked for —
 * the row shows a failure marker in their place. */
export function failedChange(path: string): FileChange {
  return {
    path,
    hunks: [],
    added: 0,
    removed: 0,
    edits: 1,
    isNew: false,
    updatedAt: 0,
    origin: SELF,
    patches: [],
    hunksPending: false,
  };
}
