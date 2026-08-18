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
 * ctrl+f (or /files) opens the picker; Enter there opens the diff viewer,
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
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { FileChange } from "./src/domain.ts";
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
  delegationContext,
} from "./src/render/row.ts";
import { browseChangedFiles } from "./src/ui/picker.ts";
import { createViewerState } from "./src/ui/viewer.ts";

const STATUS_KEY = "file-edits";

type Theme = ExtensionContext["ui"]["theme"];

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
      const { files } = store.totals();
      if (files === 0) {
        ui.setStatus(STATUS_KEY, undefined);
        return;
      }
      ui.setStatus(
        STATUS_KEY,
        `${ui.theme.fg("accent", "󰈔")} ${ui.theme.fg("text", `${files} file${files === 1 ? "" : "s"}`)}`,
      );
    } catch {
      // UI unavailable in print/RPC modes or during teardown.
    }
  };

  store.subscribe(updateStatus);

  const collapsedRow = (
    lastComponent: unknown,
    change: FileChange,
    theme: Theme,
  ) => {
    const row =
      lastComponent instanceof CollapsedRow
        ? lastComponent
        : new CollapsedRow();
    row.update(change, theme);
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
        const change = calls.get(context.toolCallId);
        if (!change || context.expanded) {
          return baseEdit.renderCall!(args, theme, delegationContext(context));
        }
        return collapsedRow(context.lastComponent, change, theme);
      },
      renderResult(result, options, theme, context) {
        // A failure must never be collapsed: that is exactly the output the
        // user needs. Same for the expanded view — ctrl+o still works.
        const change = calls.get(context.toolCallId);
        const expanded = options.expanded || context.expanded;
        if (context.isError || expanded || !change) {
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
        if (!change || context.expanded) {
          return baseWrite.renderCall!(args, theme, delegationContext(context));
        }
        return collapsedRow(context.lastComponent, change, theme);
      },
      renderResult(result, options, theme, context) {
        const change = calls.get(context.toolCallId);
        const expanded = options.expanded || context.expanded;
        if (context.isError || expanded || !change) {
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

  pi.registerShortcut("ctrl+f", {
    description: "Browse changed files",
    handler: async (ctx) => {
      if (ctx.mode !== "tui") return;
      await browseChangedFiles(ctx, store, ctx.cwd, viewerState);
    },
  });
}
