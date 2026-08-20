/**
 * commands — shell history as a first-class surface.
 *
 * The built-in bash tool is re-registered under the same name so its
 * transcript row collapses to two lines: the command, its outcome, and a peek
 * at the last line it printed. A failure collapses too, with a few more tail
 * lines instead of the built-in's coloured box. Execution is delegated to the
 * SDK's own implementation, so shell semantics are untouched; only the
 * renderers and a store subscription are ours.
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
import { formatCommandsStatus } from "./src/status.ts";
import type { CommandRecord } from "./src/domain.ts";
import { observeCommandChannel } from "./src/observe.ts";
import {
  createCallRecords,
  executeBashAndRecord,
  resultText,
} from "./src/record.ts";
import {
  CollapsedRow,
  EmptyRow,
  LiveCallRow,
  LivePeekRow,
  delegationContext,
} from "./src/render/row.ts";
import { boxedDelegation, shellBg } from "../shared/tui-kit/boxed.ts";
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
      ui.setStatus(STATUS_KEY, formatCommandsStatus(ui.theme, store.totals()));
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

  const liveCall = (lastComponent: unknown, command: string, theme: Theme) => {
    const row =
      lastComponent instanceof LiveCallRow ? lastComponent : new LiveCallRow();
    row.update(command, theme);
    return row;
  };

  const livePeek = (lastComponent: unknown, output: string, theme: Theme) => {
    const row =
      lastComponent instanceof LivePeekRow ? lastComponent : new LivePeekRow();
    row.update(output, theme);
    return row;
  };

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    ui = ctx.mode === "tui" ? ctx.ui : undefined;
    stopChannel = observeCommandChannel(pi.events, store);

    const baseBash = createBashToolDefinition(ctx.cwd);

    const bashTool: typeof baseBash = {
      ...baseBash,
      // The built-in bash renderer sets no shell, so pi paints a colored Box
      // around it (tool-execution.js:50). "self" hands the framing to us, so
      // the collapsed and live rows stay plain; expanded gets the box back
      // through boxedDelegation below.
      renderShell: "self",
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
        // Expanded is the built-in's view, and the built-in expects the shell
        // Box that "self" took away — so it gets one of ours.
        if (context.expanded) {
          return boxedDelegation(
            context,
            1,
            shellBg(theme, context),
            delegationContext,
            (ctx) => baseBash.renderCall!(args, theme, ctx),
          );
        }
        const record = calls.get(context.toolCallId);
        // Settled: the result slot draws the whole row.
        if (record) return noCall();
        // Still running: our own live header instead of the boxed built-in line.
        return liveCall(
          context.lastComponent,
          typeof args.command === "string" ? args.command : "",
          theme,
        );
      },
      renderResult(result, options, theme, context) {
        const expanded = options.expanded || context.expanded;
        if (expanded) {
          return boxedDelegation(
            context,
            0,
            shellBg(theme, {
              isPartial: options.isPartial,
              isError: context.isError,
            }),
            delegationContext,
            (ctx) => baseBash.renderResult!(result, options, theme, ctx),
          );
        }
        const record = calls.get(context.toolCallId);
        // Streaming: a dim peek at the tail of what has arrived so far.
        if (options.isPartial || !record) {
          return livePeek(context.lastComponent, resultText(result), theme);
        }
        // Not a rendering call: while the command streamed AND was expanded, the
        // built-in may have started its 1Hz elapsed-time interval
        // (bash.js:369-380), and the final call is where it clears it. Run it
        // for the cleanup, then throw the component it returns away.
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
