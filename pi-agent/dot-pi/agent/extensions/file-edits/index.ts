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
import * as path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import {
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ReadToolDetails,
} from "@earendil-works/pi-coding-agent";
import { formatFilesStatus } from "./src/status.ts";
import { createBaselineStore, nodeBaselineIo } from "./src/baseline.ts";
import type { FileChange } from "./src/domain.ts";
import { blobAtRef, diffAgainstRef, resolveHeadSha } from "./src/git-diff.ts";
import { resolveChange, resolutionNote } from "./src/resolve.ts";
import { failedCallPath, failedChange, failureReason } from "./src/failure.ts";
import { observeChildFiles } from "./src/observe.ts";
import { storeKeyFor } from "./src/paths.ts";
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
  ReadCallRow,
  ReadResultRow,
  delegationContext,
  paintPath,
  readDelegation,
} from "./src/render/row.ts";
import { boxedDelegation, shellBg } from "../shared/tui-kit/boxed.ts";
import { iconFor, paintIcon } from "../shared/tui-kit/icons.ts";
import { browseChangedFiles } from "./src/ui/picker.ts";
import { createViewerState } from "./src/ui/viewer.ts";

const STATUS_KEY = "file-edits";

type Theme = ExtensionContext["ui"]["theme"];

/** Where a tool's `path` argument actually points. The store key is
 * cwd-relative; a snapshot has to be read from the filesystem. */
function absolutePathOf(cwd: string, target: string): string {
  return path.isAbsolute(target) ? target : path.join(cwd, target);
}

/** Line count the way read itself counts (pi's truncateHead convention):
 * a trailing newline is not an extra empty line. */
function countTextLines(text: string): number {
  if (text.length === 0) return 0;
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines.length;
}

/** The continuation notice read.js appends when a user `limit` stops a read
 * before end-of-file without setting `details.truncation` (read.js:238-243),
 * so the fallback below can strip it instead of counting it as read lines. */
const LIMITED_READ_NOTICE = /\n\n\[(\d+) more lines in file\. Use offset=\d+ to continue\.\]$/;

/** "read N lines", honest about what actually reached the model: a
 * truncated read counts from `details.truncation` (which also carries the
 * total, for the "(truncated)" marker) rather than the displayed text,
 * which read.js appends a continuation notice to (read.js:232,243). A
 * limit-stopped read has no `details.truncation` either, so its notice is
 * stripped before counting (read.js:238-243). */
function readLineSummary(text: string, details: ReadToolDetails | undefined): string {
  const truncation = details?.truncation;
  if (truncation) {
    const label = truncation.outputLines === 1 ? "line" : "lines";
    const marker = truncation.truncated ? ` of ${truncation.totalLines} (truncated)` : "";
    return `read ${truncation.outputLines} ${label}${marker}`;
  }
  const noticeMatch = text.match(LIMITED_READ_NOTICE);
  const body = noticeMatch ? text.slice(0, noticeMatch.index) : text;
  const shown = countTextLines(body);
  const label = shown === 1 ? "line" : "lines";
  const marker = noticeMatch ? ` of ${shown + Number(noticeMatch[1])} (truncated)` : "";
  return `read ${shown} ${label}${marker}`;
}

/** The dim `:start-end` suffix read.js prints for a sliced read
 * (formatReadLineRange, read.js:32-38), so a collapsed row says so too. */
function formatReadRange(
  args: { offset?: number; limit?: number },
  theme: Theme,
): string {
  if (args.offset === undefined && args.limit === undefined) return "";
  const start = args.offset ?? 1;
  const end = args.limit !== undefined ? start + args.limit - 1 : undefined;
  return theme.fg("dim", `:${start}${end !== undefined ? `-${end}` : ""}`);
}

export default function (pi: ExtensionAPI) {
  const store = createFileEditStore();
  /** Per tool call, so a row can describe its own call: the store is
   * cumulative per file, which is what the picker and the status want. */
  const calls = createCallRecords();
  const viewerState = createViewerState();
  /** What each file looked like before this session touched it. Captured
   * before a tool writes, because afterwards nobody can reconstruct it. */
  const baselines = createBaselineStore(nodeBaselineIo());
  let ui: ExtensionUIContext | undefined;
  let stopChildFiles: (() => void) | undefined;
  /** The commit this session started on, pinned once. A commit made mid-session
   * moves HEAD past the work someone opened /files to look at. */
  let headSha: string | null = null;
  let sessionCwd = process.cwd();

  /**
   * Recompute a file's whole-session diff and write it back to the store, so
   * the hunks and the counts beside them describe the same thing. Returns the
   * note to show when it comes to nothing.
   */
  const resolve = (key: string): string | undefined => {
    const change = store.get(key);
    if (!change) return undefined;
    const resolution = resolveChange(change, {
      cwd: sessionCwd,
      baselines,
      headSha,
      readFile: (absolutePath) => {
        try {
          return fs.readFileSync(absolutePath, "utf8");
        } catch {
          return null;
        }
      },
      blobAtRef,
      diffAgainstRef,
    });
    if (resolution.kind === "resolved") {
      store.resolveHunks(key, {
        hunks: resolution.hunks,
        added: resolution.added,
        removed: resolution.removed,
      });
    } else {
      // Nothing to show is still an answer, and the record should stop
      // claiming counts no diff supports.
      store.resolveHunks(key, { hunks: [], added: 0, removed: 0 });
    }
    return resolutionNote(resolution);
  };

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

  const readCallRow = (lastComponent: unknown) =>
    lastComponent instanceof ReadCallRow ? lastComponent : new ReadCallRow();

  const readResultRow = (lastComponent: unknown) =>
    lastComponent instanceof ReadResultRow
      ? lastComponent
      : new ReadResultRow();

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    ui = ctx.mode === "tui" ? ctx.ui : undefined;
    sessionCwd = ctx.cwd;
    headSha = resolveHeadSha(ctx.cwd);
    stopChildFiles = observeChildFiles(pi.events, store, ctx.cwd, resolve);

    const baseEdit = createEditToolDefinition(ctx.cwd);
    const baseWrite = createWriteToolDefinition(ctx.cwd);

    const editTool: typeof baseEdit = {
      ...baseEdit,
      async execute(toolCallId, params, signal, onUpdate, executeCtx) {
        // Before the tool writes: this is the only moment the file's
        // pre-session state still exists anywhere.
        baselines.capture(
          storeKeyFor(ctx.cwd, params.path),
          absolutePathOf(ctx.cwd, params.path),
        );
        return executeAndRecord({
          toolCallId,
          params,
          run: () =>
            baseEdit.execute(toolCallId, params, signal, onUpdate, executeCtx),
          measure: measureEdit(ctx.cwd),
          store,
          calls,
          at: Date.now(),
          onRecorded: resolve,
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
        baselines.capture(
          storeKeyFor(ctx.cwd, params.path),
          absolutePathOf(ctx.cwd, params.path),
        );
        return executeAndRecord({
          toolCallId,
          params,
          run: () =>
            baseWrite.execute(toolCallId, params, signal, onUpdate, executeCtx),
          measure: measureWrite(ctx.cwd, fs.existsSync),
          store,
          calls,
          at: Date.now(),
          onRecorded: resolve,
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

    // No settings accessor on ExtensionContext reaches the image-resize
    // option a real session passes (agent-session.js:2018 reads it off
    // SettingsManager, which extensions cannot see) — this pins the
    // built-in's own default (autoResizeImages: true) instead.
    const baseRead = createReadToolDefinition(ctx.cwd);
    const readTool: typeof baseRead = {
      ...baseRead,
      // The built-in sets no shell (read.js has no renderShell), so without
      // this pi paints its own colored Box around our plain rows
      // (tool-execution.js:50). Expanded delegates to the built-in, which
      // wants that shell back — boxedDelegation below is where it gets one,
      // the same way write's expanded view does.
      renderShell: "self",
      renderCall(args, theme, context) {
        if (context.expanded) {
          return boxedDelegation(
            context,
            1,
            shellBg(theme, context),
            readDelegation,
            (ctx) => baseRead.renderCall!(args, theme, ctx),
          );
        }
        const path = typeof args.path === "string" ? args.path : "";
        const key = path ? storeKeyFor(ctx.cwd, path) : path;
        const row = readCallRow(context.lastComponent);
        row.update(
          `${paintIcon(iconFor(key))} ${paintPath(key, theme)}${formatReadRange(args, theme)}`,
        );
        return row;
      },
      renderResult(result, options, theme, context) {
        const expanded = options.expanded || context.expanded;
        if (expanded) {
          return boxedDelegation(context, 0, undefined, readDelegation, (ctx) =>
            baseRead.renderResult!(result, options, theme, ctx),
          );
        }
        if (options.isPartial) {
          return baseRead.renderResult!(result, options, theme, readDelegation(context));
        }
        if (context.isError) {
          const reason = failureReason(result.content);
          if (!reason) return noResult();
          // Read has no CollapsedRow header carrying a ✗ the way edit/write's
          // NoteRow does — the gutter line here IS the error row, so it is
          // built and painted directly rather than through NoteRow.
          const row = readResultRow(context.lastComponent);
          row.update(`   │ ${theme.fg("error", `✗ ${reason}`)}`);
          return row;
        }
        // Image reads return a text note plus an { type: "image" } block
        // (read.js:191-196) — no line count applies.
        if (result.content.some((block) => block.type === "image")) {
          const row = readResultRow(context.lastComponent);
          row.update(theme.fg("dim", "   │ read image"));
          return row;
        }
        const first = result.content[0];
        const text = first?.type === "text" ? first.text : "";
        const row = readResultRow(context.lastComponent);
        row.update(theme.fg("dim", `   │ ${readLineSummary(text, result.details)}`));
        return row;
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
      await browseChangedFiles(ctx, store, ctx.cwd, viewerState, resolve);
    },
  });

  pi.registerShortcut("alt+e", {
    description: "Browse changed files",
    handler: async (ctx) => {
      if (ctx.mode !== "tui") return;
      await browseChangedFiles(ctx, store, ctx.cwd, viewerState, resolve);
    },
  });
}
