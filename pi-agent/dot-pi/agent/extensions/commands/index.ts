/**
 * commands — shell history as a first-class surface.
 *
 * The built-in bash tool is re-registered under the same name so its
 * transcript row collapses to two lines: the command, its outcome, and a peek
 * at the last line it printed. Execution is delegated to the SDK's own
 * implementation, so shell semantics are untouched; only the renderers and a
 * store subscription are ours.
 *
 * Both render slots have to be ours. The built-in puts the command in
 * renderCall and the whole output block in renderResult, so overriding one
 * would leave the other's lines behind.
 *
 * Everything else that runs a shell — fd and rg in file-search, and whatever
 * subagents and workflow children run — reports on COMMAND_CHANNEL instead.
 *
 * alt+c (or /cmds) opens the picker; Enter there opens the viewer, which can
 * read back the untruncated output bash spilled to a temp file.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import type { CommandRecord } from "./src/domain.ts";
import { observeCommandChannel } from "./src/observe.ts";
import { createCallRecords, executeBashAndRecord } from "./src/record.ts";
import {
  CollapsedRow,
  EmptyRow,
  delegationContext,
} from "./src/render/row.ts";
import { createCommandStore } from "./src/store.ts";
import { browseCommands } from "./src/ui/picker.ts";
import { createViewerState } from "./src/ui/viewer.ts";

const STATUS_KEY = "commands";

type Theme = ExtensionContext["ui"]["theme"];

export default function (pi: ExtensionAPI) {
  const store = createCommandStore();
  /** Per tool call, so a row describes its own call rather than the session. */
  const calls = createCallRecords();
  const viewerState = createViewerState();
  let ui: ExtensionUIContext | undefined;
  let stopChannel: (() => void) | undefined;

  const updateStatus = () => {
    if (!ui) return;
    try {
      const { commands, failed } = store.totals();
      if (commands === 0) {
        ui.setStatus(STATUS_KEY, undefined);
        return;
      }
      const tally = `${commands} cmd${commands === 1 ? "" : "s"}`;
      ui.setStatus(
        STATUS_KEY,
        `${ui.theme.fg("accent", "❯")} ${ui.theme.fg("text", tally)}` +
          (failed > 0 ? ` ${ui.theme.fg("error", `${failed}✗`)}` : ""),
      );
    } catch {
      // UI unavailable in print/RPC modes or during teardown.
    }
  };

  store.subscribe(updateStatus);

  const collapsedRow = (
    lastComponent: unknown,
    record: CommandRecord,
    theme: Theme,
  ) => {
    const row =
      lastComponent instanceof CollapsedRow ? lastComponent : new CollapsedRow();
    row.update(record, theme);
    return row;
  };

  /** renderResult draws the whole row when collapsed, so the call slot has
   * nothing left to say. An empty container renders no lines. */
  const noCall = () => new EmptyRow();

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    ui = ctx.mode === "tui" ? ctx.ui : undefined;
    stopChannel = observeCommandChannel(pi.events, store);

    const baseBash = createBashToolDefinition(ctx.cwd);

    const bashTool: typeof baseBash = {
      ...baseBash,
      async execute(toolCallId, params, signal, onUpdate, executeCtx) {
        return executeBashAndRecord({
          toolCallId,
          command: params.command,
          cwd: ctx.cwd,
          store,
          calls,
          run: () =>
            baseBash.execute(toolCallId, params, signal, onUpdate, executeCtx),
          now: Date.now,
        });
      },
      renderCall(args, theme, context) {
        // While the command is still running there is no record yet, so the
        // built-in's live "$ command · 3s" line stays: a collapsed row would
        // be a row about nothing. Once recorded, the result slot draws both
        // lines and this one steps aside.
        const record = calls.get(context.toolCallId);
        if (!record || context.expanded) {
          return baseBash.renderCall!(args, theme, delegationContext(context));
        }
        return noCall();
      },
      renderResult(result, options, theme, context) {
        // A failure must never be collapsed: that output is exactly what the
        // user needs. Same for an expanded row — ctrl+o still works. A
        // partial result is a command still streaming, which the built-in
        // renders live.
        const record = calls.get(context.toolCallId);
        const expanded = options.expanded || context.expanded;
        if (context.isError || expanded || options.isPartial || !record) {
          return baseBash.renderResult!(
            result,
            options,
            theme,
            delegationContext(context),
          );
        }
        // Not a rendering call: while the command streamed, the built-in
        // started a 1Hz interval to tick its elapsed time (bash.js:369-380),
        // and the final call is where it clears it. Skipping that would leave
        // a timer invalidating a component nobody draws. Run it for the
        // cleanup, then throw the component it returns away.
        baseBash.renderResult!(
          result,
          options,
          theme,
          delegationContext(context),
        );
        return collapsedRow(context.lastComponent, record, theme);
      },
    };
    pi.registerTool(bashTool);

    updateStatus();
  });

  pi.on("session_shutdown", () => {
    stopChannel?.();
    stopChannel = undefined;
    calls.clear();
    try {
      ui?.setStatus(STATUS_KEY, undefined);
    } catch {
      // Teardown races are not worth reporting.
    }
    ui = undefined;
  });

  pi.registerCommand("cmds", {
    description: "Browse commands run in this session",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") return;
      await browseCommands(ctx, store, viewerState);
    },
  });

  pi.registerShortcut("alt+c", {
    description: "Browse commands run",
    handler: async (ctx) => {
      if (ctx.mode !== "tui") return;
      await browseCommands(ctx, store, viewerState);
    },
  });
}
