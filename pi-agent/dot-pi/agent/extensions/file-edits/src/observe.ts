/**
 * Child-session edits. Subagents and workflows announce the files they touch;
 * we record the path and who changed it. The diff arrives later, computed
 * against git HEAD, because tool_execution_end carries no details.
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
): () => void {
  return events.on(CHILD_FILE_CHANNEL, (value) => {
    if (!isChildFileEvent(value)) return;
    const absolute = path.isAbsolute(value.path)
      ? value.path
      : path.join(value.cwd ?? cwd, value.path);
    store.recordExternal({
      path: storeKeyFor(cwd, absolute),
      origin: value.origin,
      at: Date.now(),
    });
  });
}
