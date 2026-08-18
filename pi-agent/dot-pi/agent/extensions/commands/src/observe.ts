/**
 * Commands we did not run ourselves: fd and rg from file-search, and whatever
 * a subagent or workflow child ran. They arrive on COMMAND_CHANNEL because no
 * emitter should have to know this extension exists.
 *
 * Everything on the channel is validated before it lands: an emitter may be a
 * version behind, and a malformed payload must be ignored, not stored.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  COMMAND_CHANNEL,
  isCommandLogEvent,
} from "../../shared/command-log.ts";
import { byteLength, countLines } from "./domain.ts";
import type { CommandStore } from "./store.ts";

export interface ObserveOptions {
  readonly now?: () => number;
}

export function observeCommandChannel(
  events: ExtensionAPI["events"],
  store: CommandStore,
  options: ObserveOptions = {},
): () => void {
  const now = options.now ?? Date.now;
  let sequence = 0;

  return events.on(COMMAND_CHANNEL, (value) => {
    if (!isCommandLogEvent(value)) return;
    sequence += 1;
    const at = now();
    const durationMs = value.durationMs ?? 0;
    store.record({
      // Channel events carry no tool call id we can trust to be unique across
      // sessions — a child's ids live in its own numbering.
      id: `log-${at}-${sequence}`,
      tool: value.tool,
      command: value.command,
      cwd: value.cwd,
      origin: value.origin,
      startedAt: at - Math.max(0, durationMs),
      durationMs: Math.max(0, durationMs),
      status: value.status,
      output: value.output,
      outputLines: countLines(value.output),
      outputBytes: byteLength(value.output),
      ...(value.exitCode === undefined ? {} : { exitCode: value.exitCode }),
      ...(value.fullOutputPath === undefined
        ? {}
        : { fullOutputPath: value.fullOutputPath }),
    });
  });
}
