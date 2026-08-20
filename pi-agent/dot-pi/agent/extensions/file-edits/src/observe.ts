/**
 * Child-session edits. Subagents and workflows announce the files they touch,
 * with their own patch when the tool produced one; we record the path, the
 * patch and who changed it. The patch is a fallback, not the headline: the
 * resolver prefers the file's session baseline, which describes the whole
 * session rather than one call.
 */

import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  CHILD_FILE_CHANNEL,
  isChildFileEvent,
} from "../../shared/dashboard-state.ts";
import { storeKeyFor } from "./paths.ts";
import type { FileEditStore } from "./store.ts";

export function observeChildFiles(
  events: ExtensionAPI["events"],
  store: FileEditStore,
  cwd: string,
  onRecorded?: (key: string) => void,
): () => void {
  return events.on(CHILD_FILE_CHANNEL, (value) => {
    if (!isChildFileEvent(value)) return;
    const absolute = path.isAbsolute(value.path)
      ? value.path
      : path.join(value.cwd ?? cwd, value.path);
    const key = storeKeyFor(cwd, absolute);
    store.recordExternal({
      path: key,
      origin: value.origin,
      ...(value.patch ? { patch: value.patch } : {}),
      at: Date.now(),
    });
    // A child's edit is worth resolving now rather than at open: the file is
    // on disk already, and the picker shows counts before anyone opens it.
    onRecorded?.(key);
  });
}
