/**
 * file-edits — file changes as a first-class surface.
 *
 * The built-in edit and write tools are re-registered with the same names so
 * their transcript rows collapse to two lines: an icon, the path, and the
 * counts, plus a peek at the largest hunk. Execution is delegated to the SDK's
 * own implementation, so edit semantics are untouched; only the renderers and
 * a store subscription are ours.
 *
 * ctrl+f (or /files) opens the picker; Enter there opens the diff viewer,
 * which toggles between a unified and a side-by-side layout.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import {
  createEditToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { parseUnifiedPatch } from "./src/diff.ts";
import { observeChildFiles } from "./src/observe.ts";
import { createFileEditStore } from "./src/store.ts";
import { renderCollapsedRow } from "./src/render/row.ts";
import { browseChangedFiles } from "./src/ui/picker.ts";
import { createViewerState } from "./src/ui/viewer.ts";

const STATUS_KEY = "file-edits";
const SELF = { kind: "self" } as const;

export default function (pi: ExtensionAPI) {
  const store = createFileEditStore();
  const viewerState = createViewerState();
  let ui: ExtensionUIContext | undefined;
  let stopChildFiles: (() => void) | undefined;

  /** Store keys are cwd-relative: that is what the user reads and types. */
  const relative = (cwd: string, target: string) => {
    const absolute = path.isAbsolute(target) ? target : path.join(cwd, target);
    const rel = path.relative(cwd, absolute);
    return rel.startsWith("..") ? absolute : rel;
  };

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

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    ui = ctx.mode === "tui" ? ctx.ui : undefined;
    stopChildFiles = observeChildFiles(pi.events, store, ctx.cwd);

    const baseEdit = createEditToolDefinition(ctx.cwd);
    const baseWrite = createWriteToolDefinition(ctx.cwd);

    const editTool: typeof baseEdit = {
      ...baseEdit,
      async execute(toolCallId, params, signal, onUpdate, executeCtx) {
        const result = await baseEdit.execute(
          toolCallId,
          params,
          signal,
          onUpdate,
          executeCtx,
        );
        const patch = result.details?.patch;
        const parsed = patch ? parseUnifiedPatch(patch) : null;
        store.record({
          path: relative(ctx.cwd, params.path),
          hunks: parsed?.hunks ?? [],
          added: parsed?.added ?? 0,
          removed: parsed?.removed ?? 0,
          isNew: false,
          origin: SELF,
          at: Date.now(),
        });
        return result;
      },
      renderResult(result, options, theme, context) {
        // A failure must never be collapsed: that is exactly the output the
        // user needs. Same for the expanded view — ctrl+o still works.
        if (context.isError || options.expanded) {
          return baseEdit.renderResult!(result, options, theme, context);
        }
        const change = store.get(relative(context.cwd, context.args.path));
        if (!change) {
          return baseEdit.renderResult!(result, options, theme, context);
        }
        return {
          render: (width: number) => renderCollapsedRow(change, width, theme),
          invalidate: () => {},
        };
      },
    };
    pi.registerTool(editTool);

    const writeTool: typeof baseWrite = {
      ...baseWrite,
      async execute(toolCallId, params, signal, onUpdate, executeCtx) {
        const target = path.isAbsolute(params.path)
          ? params.path
          : path.join(ctx.cwd, params.path);
        const isNew = !fs.existsSync(target);
        const result = await baseWrite.execute(
          toolCallId,
          params,
          signal,
          onUpdate,
          executeCtx,
        );
        // write has no details, so the counts come from the content itself.
        store.record({
          path: relative(ctx.cwd, params.path),
          hunks: [],
          added: params.content.split("\n").length,
          removed: 0,
          isNew,
          origin: SELF,
          at: Date.now(),
        });
        return result;
      },
      renderResult(result, options, theme, context) {
        if (context.isError || options.expanded) {
          return baseWrite.renderResult!(result, options, theme, context);
        }
        const change = store.get(relative(context.cwd, context.args.path));
        if (!change) {
          return baseWrite.renderResult!(result, options, theme, context);
        }
        return {
          render: (width: number) => renderCollapsedRow(change, width, theme),
          invalidate: () => {},
        };
      },
    };
    pi.registerTool(writeTool);

    updateStatus();
  });

  pi.on("session_shutdown", () => {
    stopChildFiles?.();
    stopChildFiles = undefined;
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
