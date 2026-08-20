/**
 * file-edits — file changes as a first-class surface.
 *
 * The built-in edit and write tools are re-registered with the same names so
 * their transcript rows collapse to two lines: an icon, the path, and the
 * counts, plus a peek at the largest hunk. Execution is delegated to the SDK's
 * own implementation, so edit semantics are untouched; only the renderers and
 * a store subscription are ours.
 *
 * Both render slots are ours, because the built-ins put all the visual weight
 * in renderCall — edit.js:229 renders the FULL diff there and only appends a
 * summary line in renderResult. Overriding renderResult alone would make the
 * row longer, not shorter.
 *
 * A settled collapsed call never reaches a built-in renderer, failed or not:
 * a failure has no CallDelta to collapse (executeAndRecord records nothing
 * when the tool throws), so its row is rebuilt from the arguments and the
 * error text instead of falling back to the built-in's red box.
 *
 * alt+e (or /files) opens the picker; Enter there opens the diff viewer,
 * which toggles between a unified and a side-by-side layout.
 */

import * as fs from "node:fs";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import {
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { formatFilesStatus } from "./src/status.ts";
import type { FileChange } from "./src/domain.ts";
import { failedCallPath, failedChange, failureReason } from "./src/failure.ts";
import { observeChildFiles } from "./src/observe.ts";
import {
  createCallRecords,
  executeAndRecord,
  measureEdit,
  measureWrite,
} from "./src/record.ts";
import { createFileEditStore } from "./src/store.ts";
import {
  CollapsedRow,
  EmptyRow,
  NoteRow,
  delegationContext,
  paintPath,
} from "./src/render/row.ts";
import { boxedDelegation, shellBg } from "../shared/tui-kit/boxed.ts";
import { iconFor, paintIcon } from "../shared/tui-kit/icons.ts";
import { browseChangedFiles } from "./src/ui/picker.ts";
import { createViewerState } from "./src/ui/viewer.ts";

const STATUS_KEY = "file-edits";

type Theme = ExtensionContext["ui"]["theme"];

/** Fold an error reason to one line: the collapsed row has no room for a
 * multi-line trace, and read's own errors are usually one sentence anyway. */
const oneLineOf = (text: string) => text.replace(/\s+/g, " ").trim();

export default function (pi: ExtensionAPI) {
  const store = createFileEditStore();
  /** Per tool call, so a row can describe its own call: the store is
   * cumulative per file, which is what the picker and the status want. */
  const calls = createCallRecords();
  const viewerState = createViewerState();
  let ui: ExtensionUIContext | undefined;
  let stopChildFiles: (() => void) | undefined;

  const updateStatus = () => {
    if (!ui) return;
    try {
      ui.setStatus(STATUS_KEY, formatFilesStatus(ui.theme, store.totals()));
    } catch {
      // UI unavailable in print/RPC modes or during teardown.
    }
  };

  store.subscribe(updateStatus);

  const collapsedRow = (
    lastComponent: unknown,
    change: FileChange,
    theme: Theme,
    failed = false,
  ) => {
    const row =
      lastComponent instanceof CollapsedRow
        ? lastComponent
        : new CollapsedRow();
    row.update(change, theme, failed);
    return row;
  };

  /** The reason line under a failed header. renderCall cannot draw it: the
   * error text only exists in the result slot. */
  const noteRow = (lastComponent: unknown, text: string, theme: Theme) => {
    const row = lastComponent instanceof NoteRow ? lastComponent : new NoteRow();
    row.update(text, theme);
    return row;
  };

  /** renderCall draws the whole row when collapsed, so the result slot has
   * nothing left to add. An empty container renders no lines. */
  const noResult = () => new EmptyRow();

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    ui = ctx.mode === "tui" ? ctx.ui : undefined;
    stopChildFiles = observeChildFiles(pi.events, store, ctx.cwd);

    const baseEdit = createEditToolDefinition(ctx.cwd);
    const baseWrite = createWriteToolDefinition(ctx.cwd);

    const editTool: typeof baseEdit = {
      ...baseEdit,
      async execute(toolCallId, params, signal, onUpdate, executeCtx) {
        return executeAndRecord({
          toolCallId,
          params,
          run: () =>
            baseEdit.execute(toolCallId, params, signal, onUpdate, executeCtx),
          measure: measureEdit(ctx.cwd),
          store,
          calls,
          at: Date.now(),
        });
      },
      renderCall(args, theme, context) {
        // The built-in renders the full diff here (edit.js:229), so this is
        // the slot that has to collapse. Until the call has been recorded
        // there is nothing to collapse to: argument streaming stays built-in.
        // A settled failure is never recorded, so its row is rebuilt from the
        // path the arguments named — anything else is the built-in's red box.
        const change = calls.get(context.toolCallId);
        if (context.expanded) {
          return baseEdit.renderCall!(args, theme, delegationContext(context));
        }
        if (change) return collapsedRow(context.lastComponent, change, theme);
        const failed = context.isError
          ? failedCallPath(args, context.cwd)
          : undefined;
        if (failed) {
          return collapsedRow(
            context.lastComponent,
            failedChange(failed),
            theme,
            true,
          );
        }
        return baseEdit.renderCall!(args, theme, delegationContext(context));
      },
      renderResult(result, options, theme, context) {
        // A failure collapses like everything else: renderCall drew the header
        // and this slot adds the reason, in a dim line rather than a red box.
        // ctrl+o — the expanded view — still gets the built-in, and so does a
        // still-streaming result. A recorded change wins over isError, as it
        // does in renderCall: a hook can mark a call that did apply an edit as
        // an error, and that row should still be the recorded one.
        const change = calls.get(context.toolCallId);
        const expanded = options.expanded || context.expanded;
        const failed = context.isError
          ? failedCallPath(context.args, context.cwd)
          : undefined;
        if (!expanded && !options.isPartial && !change && failed) {
          return noteRow(
            context.lastComponent,
            failureReason(result.content),
            theme,
          );
        }
        if (expanded || options.isPartial || !change) {
          return baseEdit.renderResult!(
            result,
            options,
            theme,
            delegationContext(context),
          );
        }
        // Not a rendering call: edit.js:253-275 is where the APPLIED diff is
        // written back into the call component, and the diff speculated from
        // the arguments can differ from it (CRLF normalization, BOM
        // stripping — edit.js:206-215). Run it for that write-back, then
        // throw the component it returns away.
        baseEdit.renderResult!(
          result,
          options,
          theme,
          delegationContext(context),
        );
        return noResult();
      },
    };
    pi.registerTool(editTool);

    const writeTool: typeof baseWrite = {
      ...baseWrite,
      // The built-in edit sets this (edit.js:178) and the built-in write does
      // not, so without it ToolExecutionComponent paints its own colored Box
      // around our plain rows (tool-execution.js:50) — a red block behind a
      // collapsed failure. "self" hands the framing to us, as it already does
      // for edit; the rows draw their own leading spacing either way. Unlike
      // edit, whose call component is its own Box, the built-in write
      // renderers want that shell back when expanded — boxedDelegation below
      // is where they get it.
      renderShell: "self",
      async execute(toolCallId, params, signal, onUpdate, executeCtx) {
        return executeAndRecord({
          toolCallId,
          params,
          run: () =>
            baseWrite.execute(toolCallId, params, signal, onUpdate, executeCtx),
          measure: measureWrite(ctx.cwd, fs.existsSync),
          store,
          calls,
          at: Date.now(),
        });
      },
      renderCall(args, theme, context) {
        const change = calls.get(context.toolCallId);
        // Expanded is the built-in's view, and the built-in expects the shell
        // Box that "self" took away — so it gets one of ours, with the padding
        // and background pi would have used.
        if (context.expanded) {
          return boxedDelegation(
            context,
            1,
            shellBg(theme, context),
            delegationContext,
            (ctx) => baseWrite.renderCall!(args, theme, ctx),
          );
        }
        if (change) return collapsedRow(context.lastComponent, change, theme);
        const failed = context.isError
          ? failedCallPath(args, context.cwd)
          : undefined;
        if (failed) {
          return collapsedRow(
            context.lastComponent,
            failedChange(failed),
            theme,
            true,
          );
        }
        return baseWrite.renderCall!(args, theme, delegationContext(context));
      },
      renderResult(result, options, theme, context) {
        const change = calls.get(context.toolCallId);
        const expanded = options.expanded || context.expanded;
        const failed = context.isError
          ? failedCallPath(context.args, context.cwd)
          : undefined;
        if (!expanded && !options.isPartial && !change && failed) {
          return noteRow(
            context.lastComponent,
            failureReason(result.content),
            theme,
          );
        }
        // The result slot only draws on an error, and edit keeps that text
        // outside its own Box but indented (edit.js:283) — so this one is
        // padding without a background, matching it.
        if (expanded) {
          return boxedDelegation(context, 0, undefined, delegationContext, (ctx) =>
            baseWrite.renderResult!(result, options, theme, ctx),
          );
        }
        if (options.isPartial || !change) {
          return baseWrite.renderResult!(
            result,
            options,
            theme,
            delegationContext(context),
          );
        }
        // write's renderResult has no write-back to perform (it only formats
        // errors — write.js:123-135), but running it costs nothing and keeps
        // both tools on the same path.
        baseWrite.renderResult!(
          result,
          options,
          theme,
          delegationContext(context),
        );
        return noResult();
      },
    };
    pi.registerTool(writeTool);

    const baseRead = createReadToolDefinition(ctx.cwd);
    const readTool: typeof baseRead = {
      ...baseRead,
      // The built-in sets no shell (read.js has no renderShell), so without
      // this pi paints its own colored Box around our plain rows
      // (tool-execution.js:50). Expanded and streaming views still delegate
      // to the built-in, which renders plain Text and needs no shell back.
      renderShell: "self",
      renderCall(args, theme, context) {
        // Expanded is the built-in's own view. It caches a plain pi-tui
        // `Text` on lastComponent and only ever calls `setText` on it
        // (read.js:265,274) — our collapsed rows are Text too, so handing
        // context straight through (rather than hiding lastComponent) is
        // harmless either way; a probe confirmed no stale content or crash
        // across expanded/collapsed transitions.
        if (context.expanded) {
          return baseRead.renderCall!(args, theme, context);
        }
        const path = typeof args.path === "string" ? args.path : "";
        return new Text(
          `${paintIcon(iconFor(path))} ${paintPath(path, theme)}`,
          0,
          0,
        );
      },
      renderResult(result, options, theme, context) {
        if (options.expanded || context.expanded || options.isPartial) {
          return baseRead.renderResult!(result, options, theme, context);
        }
        const first = result.content[0];
        if (context.isError) {
          const reason = first?.type === "text" ? first.text : "failed";
          return new Text(theme.fg("error", `\u2717 ${oneLineOf(reason ?? "failed")}`), 0, 0);
        }
        // Image reads return a text note plus an { type: "image" } block
        // (read.js:191-196) \u2014 no line count applies.
        if (result.content.some((block) => block.type === "image")) {
          return new Text(theme.fg("dim", "   \u2502 read image"), 0, 0);
        }
        const lines = first?.type === "text" ? first.text.split("\n").length : 0;
        return new Text(theme.fg("dim", `   \u2502 read ${lines} lines`), 0, 0);
      },
    };
    pi.registerTool(readTool);

    updateStatus();
  });

  pi.on("session_shutdown", () => {
    stopChildFiles?.();
    stopChildFiles = undefined;
    calls.clear();
    try {
      ui?.setStatus(STATUS_KEY, undefined);
    } catch {
      // Teardown races are not worth reporting.
    }
    ui = undefined;
  });

  pi.registerCommand("files", {
    description: "Browse files changed in this session",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") return;
      await browseChangedFiles(ctx, store, ctx.cwd, viewerState);
    },
  });

  pi.registerShortcut("alt+e", {
    description: "Browse changed files",
    handler: async (ctx) => {
      if (ctx.mode !== "tui") return;
      await browseChangedFiles(ctx, store, ctx.cwd, viewerState);
    },
  });
}
