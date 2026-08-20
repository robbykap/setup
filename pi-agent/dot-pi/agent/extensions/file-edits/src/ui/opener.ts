/**
 * Handing the file under the cursor to an editor.
 *
 * The overlays cannot ask for configuration themselves: a picker or a viewer
 * owns the screen while it is open, and stacking a dialog on top of one is a
 * fight over the same rows. So an unconfigured `o` raises a flag and closes
 * instead, and browseChangedFiles — which is already a loop around these
 * overlays — runs the chooser between two of them and comes back.
 */

import type { FileChange } from "../domain.ts";

export type OpenOutcome = "opened" | "unconfigured" | "failed";

export interface FileOpener {
  /** Launch the configured editor on a cwd-relative path. */
  open(relativePath: string, line: number): OpenOutcome;
  /** Raised by a component that closed itself to ask for configuration. */
  configureRequested: boolean;
}

/**
 * Where the editor should land: the first line the diff actually changed, so
 * the cursor arrives at the hunk rather than at the top of a file. Falls back
 * to line 1 for anything with no hunks to point at.
 */
export function firstChangedLine(change: FileChange | undefined): number {
  for (const hunk of change?.hunks ?? []) {
    for (const line of hunk.lines) {
      if (line.kind === "context") continue;
      return line.newLine ?? line.oldLine ?? 1;
    }
  }
  return 1;
}

/**
 * The `o` key, shared by both overlays. Returns true when the component should
 * close itself — which is how an unconfigured editor gets one.
 */
export function requestOpen(
  opener: FileOpener | undefined,
  path: string,
  line: number,
): boolean {
  if (!opener) return false;
  if (opener.open(path, line) !== "unconfigured") return false;
  opener.configureRequested = true;
  return true;
}
