/**
 * The diff viewer: unified by default, side-by-side on `s`.
 *
 * Split falls back to unified below MIN_SPLIT_WIDTH — two 40-column panes of
 * code are unreadable, and silently showing them would be worse than saying
 * why.
 */

import type {
  ExtensionContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { pairRows, type SplitRow } from "../diff.ts";
import type { DiffLine, FileChange, Hunk } from "../domain.ts";
import { iconFor, paintIcon } from "../../../shared/tui-kit/icons.ts";
import {
  highlightBlock,
  languageForPath,
} from "../../../shared/tui-kit/highlight.ts";
import {
  DIFF_ADDED_BG,
  DIFF_ADDED_EMPHASIS_BG,
  DIFF_REMOVED_BG,
  DIFF_REMOVED_EMPHASIS_BG,
  fillLine,
  rgbBgOpener,
} from "../../../shared/tui-kit/paint.ts";
import { overlayRanges, type Range } from "../../../shared/tui-kit/ansi-spans.ts";
import { copyText } from "../../../shared/tui-kit/copy.ts";
import {
  applyTopAnchored,
  clampOffset,
  scrollActionFor,
} from "../../../shared/tui-kit/scroll.ts";
import { wordSpans } from "../intraline.ts";
import type { FileEditStore } from "../store.ts";
import {
  bodyHeight,
  bodyRow,
  bottomBorder,
  outerLine,
  topBorder,
} from "../../../shared/tui-kit/frame.ts";
import { siblingPath } from "./navigation.ts";
import { firstChangedLine, requestOpen, type FileOpener } from "./opener.ts";

function configuredKeys(
  keybindings: KeybindingsManager,
  binding: Parameters<KeybindingsManager["getKeys"]>[0],
) {
  return keybindings.getKeys(binding).join("/") || "unbound";
}

export type ViewMode = "stacked" | "split";

/** Below this, two panes of code are unreadable. */
const MIN_SPLIT_WIDTH = 90;

/** Survives one viewer instance so the choice is made once per session. */
export interface ViewerState {
  mode: ViewMode;
}

/** What the viewer returns: a sibling to open, or null to go back. */
export type ViewerExit = { readonly next: string } | null;

/**
 * Whether the viewer has to work out what changed.
 *
 * Always, for a file the store still holds. Resolution is a file read and a
 * diff, which costs nothing next to opening a panel, and anything cheaper
 * goes stale: a record resolved three edits ago describes the file as it was
 * three edits ago.
 */
export function needsHunkResolution(change: FileChange | undefined): boolean {
  return change !== undefined;
}

/** Why the body is empty, or null when it is not. A blank panel is a bug
 * report waiting to happen; say what happened instead. `note` is the
 * resolver's own account of why it found nothing, which is more specific than
 * anything this function could guess. */
export function emptyBodyMessage(
  change: FileChange | undefined,
  note?: string,
): string | null {
  if (!change) return "file is no longer tracked";
  if (change.hunks.length > 0) return null;
  if (note) return note;
  if (change.hunksPending) return "no diff available for this file yet";
  return "no diff against the commit this session started on";
}

function lineColor(kind: DiffLine["kind"]) {
  if (kind === "add") return "toolDiffAdded" as const;
  if (kind === "remove") return "toolDiffRemoved" as const;
  return "toolDiffContext" as const;
}

function marker(kind: DiffLine["kind"]) {
  if (kind === "add") return "+";
  if (kind === "remove") return "−";
  return " ";
}

/**
 * The diff as a patch body, for the clipboard. The markers are ASCII on
 * purpose: the panel draws removals with U+2212 so the gutter lines up, but a
 * copied hunk is meant to paste into a review. Hunks are
 * separated by a blank line so two of them do not read as one block of code
 * that never existed.
 */
export function serializeHunks(hunks: ReadonlyArray<Hunk>): string {
  return hunks
    .map((hunk) =>
      hunk.lines
        .map(
          (line) =>
            `${line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}${line.text}`,
        )
        .join("\n"),
    )
    .join("\n\n");
}

/** The tint openers, named once so tests assert against these rather than
 * against a hand-copied escape sequence. */
export const ADDED_OPENER = rgbBgOpener(DIFF_ADDED_BG);
export const REMOVED_OPENER = rgbBgOpener(DIFF_REMOVED_BG);
export const ADDED_EMPHASIS_OPENER = rgbBgOpener(DIFF_ADDED_EMPHASIS_BG);
export const REMOVED_EMPHASIS_OPENER = rgbBgOpener(DIFF_REMOVED_EMPHASIS_BG);

/** The background a line sits on: none for context, a tint for a change. */
function tintOpener(kind: DiffLine["kind"]): string {
  if (kind === "add") return ADDED_OPENER;
  if (kind === "remove") return REMOVED_OPENER;
  return "";
}

/** The background under the words that differ, a shade further out. */
function emphasisOpener(kind: DiffLine["kind"]): string {
  if (kind === "add") return ADDED_EMPHASIS_OPENER;
  if (kind === "remove") return REMOVED_EMPHASIS_OPENER;
  return "";
}

/**
 * Word spans, as ranges over the line's visible characters.
 *
 * wordSpans counts in UTF-16 units (its tokenizer has no `u` flag) and
 * overlayRanges counts code points, so every boundary is converted through the
 * line itself rather than accumulated. Lines are short; this costs nothing,
 * for the same reason the word LCS upstream of it does not.
 */
export function emphasisRanges(
  spans: ReadonlyArray<{ readonly text: string; readonly changed: boolean }>,
  text: string,
): Range[] {
  const ranges: Range[] = [];
  let unit = 0;
  for (const span of spans) {
    const end = unit + span.text.length;
    if (span.changed) {
      ranges.push({
        start: [...text.slice(0, unit)].length,
        end: [...text.slice(0, end)].length,
      });
    }
    unit = end;
  }
  return ranges;
}

/** One highlight pass per hunk, zipped back line-for-line. The WeakMap keys
 * on the FileChange object: resolveHunks replaces the object, so a new diff
 * naturally re-highlights and a scroll never does. */
const highlightCache = new WeakMap<FileChange, Map<DiffLine, string>>();

export function highlightForChange(change: FileChange): Map<DiffLine, string> {
  const cached = highlightCache.get(change);
  if (cached) return cached;
  // The path comes off the change itself: the cache keys on the change alone,
  // so a caller-supplied path could disagree with it and win for good.
  const language = languageForPath(change.path);
  const map = new Map<DiffLine, string>();
  for (const hunk of change.hunks) {
    const lines = highlightBlock(
      hunk.lines.map((line) => line.text).join("\n"),
      language,
    );
    hunk.lines.forEach((line, i) => map.set(line, lines[i] ?? line.text));
  }
  highlightCache.set(change, map);
  return map;
}

/**
 * The code half of a line: syntax-highlighted, always, with the words that
 * differ raised onto a stronger tint.
 *
 * Highlighting used to be dropped on any line with a counterpart, because the
 * word spans are offsets into raw text and there was no way to lay them over
 * an already-coloured string. overlayRanges is that way, so the two no longer
 * compete: the colour says what the code IS, the background says what changed.
 */
export function codeBody(
  theme: Theme,
  line: DiffLine,
  counterpart: string | undefined,
  highlighted: string,
): string {
  const color = lineColor(line.kind);
  // highlightBlock hands back the input unchanged when the language is unknown
  // or the theme has no colours; fall back to a flat diff colour rather than
  // emitting an uncoloured row.
  const body =
    highlighted === line.text ? theme.fg(color, line.text) : highlighted;
  if (counterpart === undefined || line.kind === "context") return body;

  const spans =
    line.kind === "remove"
      ? wordSpans(line.text, counterpart).removed
      : wordSpans(counterpart, line.text).added;
  const ranges = emphasisRanges(spans, line.text);
  if (ranges.length === 0) return body;
  // Closing back to the line's own tint, not to a reset: the row sits on that
  // tint from end to end, and a reset here would punch a hole in it.
  return overlayRanges(
    body,
    ranges,
    emphasisOpener(line.kind),
    tintOpener(line.kind),
  );
}

export class DiffViewer implements Component {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private store: FileEditStore;
  private path: string;
  private state: ViewerState;
  private paths: ReadonlyArray<string>;
  private note: string | undefined;
  private opener: FileOpener | undefined;
  private done: (value: ViewerExit) => void;

  private offset = 0;
  /** The body height the last render used, so a page/half-page key knows how
   * far a page is before render() runs again. Seeded with a plausible pane
   * rather than 0: the first keypress can arrive before the first render. */
  private lastViewport = 20;
  private copyNote: string | undefined;
  private closed = false;
  private unsubscribe: () => void;
  /** The clipboard itself, injectable so a test can press `y` without one.
   * Package-internal: nothing outside this extension sets it. */
  copier?: (text: string) => Promise<void> | void;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    store: FileEditStore,
    path: string,
    state: ViewerState,
    paths: ReadonlyArray<string>,
    note: string | undefined,
    opener: FileOpener | undefined,
    done: (value: ViewerExit) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.store = store;
    this.path = path;
    this.state = state;
    this.paths = paths;
    this.note = note;
    this.opener = opener;
    this.done = done;
    this.unsubscribe = store.subscribe(() => this.tui.requestRender());
  }

  private change(): FileChange | undefined {
    return this.store.get(this.path);
  }

  private cleanup() {
    if (this.closed) return false;
    this.closed = true;
    this.unsubscribe();
    return true;
  }

  private close(result: ViewerExit) {
    if (this.cleanup()) this.done(result);
  }

  dispose(): void {
    this.cleanup();
  }

  invalidate(): void {}

  private sibling(step: number): string | undefined {
    return siblingPath(this.paths, this.path, step);
  }

  handleInput(data: string): void {
    // The receipt belongs to the copy that produced it: any keypress at all
    // clears it, handled or not. The pending copy's .then still overwrites
    // this, which is what makes a slow copier's note land rather than vanish.
    // Keys we don't bind return without asking for a render, so repaint here
    // or the cleared note lingers on screen until the next tick.
    const hadNote = this.copyNote !== undefined;
    this.copyNote = undefined;
    if (hadNote) this.tui.requestRender();
    if (
      this.keybindings.matches(data, "tui.select.cancel") ||
      data === "q"
    ) {
      this.close(null);
      return;
    }
    if (data === "s") {
      this.state.mode = this.state.mode === "split" ? "stacked" : "split";
      this.tui.requestRender();
      return;
    }
    if (data === "o") {
      // Closing is how an unconfigured editor gets its chooser: the loop
      // outside owns the screen once this overlay lets go of it.
      if (requestOpen(this.opener, this.path, firstChangedLine(this.change()))) {
        this.close(null);
      }
      return;
    }
    if (data === "n" || data === "p") {
      const next = this.sibling(data === "n" ? 1 : -1);
      if (next) this.close({ next });
      return;
    }
    if (data === "y") {
      const change = this.change();
      if (!change) return;
      if (change.hunks.length === 0) {
        // An empty clipboard reads as a failed copy; say which it was.
        this.copyNote = "nothing to copy";
        this.tui.requestRender();
        return;
      }
      void copyText(serializeHunks(change.hunks), "diff", this.copier)
        .then((note) => {
          // A copy can outlive the viewer: the note has nowhere to land, and
          // rendering a disposed component is worse than dropping it.
          if (this.closed) return;
          this.copyNote = note;
          this.tui.requestRender();
        })
        // copyText never throws, but the render above can; the no-throw
        // guarantee ends at its boundary (tui-kit/copy.ts).
        .catch(() => {});
      return;
    }
    const action = scrollActionFor(data, this.keybindings, { vimKeys: true });
    if (action) {
      this.offset = applyTopAnchored(this.offset, action, this.lastViewport);
      this.tui.requestRender();
      return;
    }
  }

  /**
   * The code half of a line, delegated to the module-level codeBody so the
   * choice between highlighted and flat is testable without a viewer.
   */
  private paint(
    line: DiffLine,
    counterpart: string | undefined,
    highlighted: string,
  ): string {
    return codeBody(this.theme, line, counterpart, highlighted);
  }

  /**
   * One code cell: the gutter prefix, then the code laid over the line's tint
   * for exactly the cells the prefix left over. Context lines pass an empty
   * opener, so fillLine degrades to plain padding. Either way the cell is
   * exactly `width` visible cells.
   */
  private cell(
    line: DiffLine,
    prefix: string,
    counterpart: string | undefined,
    highlights: Map<DiffLine, string>,
    width: number,
  ): string {
    const body = this.paint(
      line,
      counterpart,
      highlights.get(line) ?? line.text,
    );
    const remaining = Math.max(0, width - visibleWidth(prefix));
    return truncateToWidth(
      prefix + fillLine(body, remaining, tintOpener(line.kind)),
      width,
    );
  }

  private stackedLines(change: FileChange, width: number): string[] {
    const lines: string[] = [];
    const counterparts = new Map<DiffLine, string>();
    for (const row of pairRows(change.hunks)) {
      if (row.separator || !row.left || !row.right || row.left === row.right) continue;
      counterparts.set(row.left, row.right.text);
      counterparts.set(row.right, row.left.text);
    }
    const highlights = highlightForChange(change);
    change.hunks.forEach((hunk, index) => {
      if (index > 0) lines.push(this.theme.fg("dim", "─".repeat(width)));
      for (const line of hunk.lines) {
        const number = line.newLine ?? line.oldLine ?? 0;
        const prefix =
          this.theme.fg("dim", String(number).padStart(4)) +
          " " +
          this.theme.fg(lineColor(line.kind), `${marker(line.kind)} `);
        lines.push(
          this.cell(line, prefix, counterparts.get(line), highlights, width),
        );
      }
    });
    return lines;
  }

  private splitLines(change: FileChange, width: number): string[] {
    const pane = Math.floor((width - 1) / 2);
    const highlights = highlightForChange(change);
    const cell = (line: DiffLine | undefined, counterpart: string | undefined) => {
      if (!line) return " ".repeat(pane);
      const prefix =
        this.theme.fg(
          "dim",
          String(line.newLine ?? line.oldLine ?? 0).padStart(4),
        ) + " ";
      // The fill runs to the end of the pane, so each side's tint reads as a
      // full-height column rather than a ragged one.
      return this.cell(line, prefix, counterpart, highlights, pane);
    };

    return pairRows(change.hunks).map((row: SplitRow) =>
      row.separator
        ? this.theme.fg("dim", "─".repeat(width))
        : `${cell(row.left, row.right?.text)}${this.theme.fg("border", "│")}${cell(row.right, row.left?.text)}`,
    );
  }

  /** Title line, two borders, key legend. */
  private static readonly CHROME = 4;

  render(width: number): string[] {
    const theme = this.theme;
    const change = this.change();
    const inner = width - 2;

    const narrow = width < MIN_SPLIT_WIDTH;
    const mode: ViewMode = narrow ? "stacked" : this.state.mode;

    const label = (name: ViewMode) =>
      name === mode
        ? theme.bold(theme.fg("accent", `[${name}]`))
        : theme.fg("dim", name);

    // Title outside the box: file on the left, counts and mode on the right.
    const left =
      `${paintIcon(iconFor(this.path))} ${theme.bold(theme.fg("text", this.path))}` +
      (change
        ? `  ${theme.fg("toolDiffAdded", `+${change.added}`)} ${theme.fg("toolDiffRemoved", `−${change.removed}`)}`
        : "");
    const right =
      `${label("stacked")} ${label("split")}` +
      (narrow ? theme.fg("dim", "  (too narrow to split)") : "");
    const gap = Math.max(
      1,
      width - visibleWidth(left) - visibleWidth(right) - 4,
    );

    const position =
      this.paths.length > 1
        ? `${this.paths.indexOf(this.path) + 1}/${this.paths.length}`
        : "";

    const lines: string[] = [
      outerLine(width, `  ${left}${" ".repeat(gap)}${right}  `),
      topBorder(theme, width, position),
    ];

    const placeholder = emptyBodyMessage(change, this.note);
    const body = placeholder
      ? [theme.fg("dim", placeholder)]
      : mode === "split"
        ? this.splitLines(change!, inner - 2)
        : this.stackedLines(change!, inner - 2);

    const height = bodyHeight(this.tui.terminal.rows, DiffViewer.CHROME);
    this.lastViewport = height;
    // The kit asks callers to clamp on store, which we cannot: the maximum
    // offset depends on body.length, and that is only known here. Clamping
    // here is equivalent because the assignment writes the clamped value back
    // into this.offset, and render() always follows the requestRender that
    // handleInput issued — so `G`'s sentinel is replaced by a real offset
    // before the next keypress reads it, and `k` after `G` moves one line up
    // from the bottom rather than out of a number nothing can walk back from.
    this.offset = clampOffset(this.offset, Math.max(0, body.length - height));

    // Always emit `height` rows, blank ones included, so the panel keeps its
    // shape whether the diff is three lines or three hundred.
    for (let index = 0; index < height; index += 1) {
      const line = body[this.offset + index];
      lines.push(bodyRow(theme, width, line === undefined ? "" : ` ${line}`));
    }

    const scrollable = Math.max(0, body.length - height);
    lines.push(
      bottomBorder(
        theme,
        width,
        scrollable > 0
          ? `${Math.round((this.offset / scrollable) * 100)}%`
          : "",
      ),
    );
    // Short enough to fit an 80-column terminal, so the close key — the way
    // out — is never the part that falls off the end.
    const legend =
      `  s split · n/p file · j/k g/G scroll` +
      ` · y copy · o ide · ${configuredKeys(this.keybindings, "tui.select.cancel")}/q close` +
      (this.copyNote ? ` · ${this.copyNote}` : "");
    lines.push(outerLine(width, theme.fg("dim", legend)));

    return lines;
  }
}

export function createViewerState(): ViewerState {
  return { mode: "stacked" };
}

export async function openDiffViewer(
  ctx: ExtensionContext,
  store: FileEditStore,
  path: string,
  state: ViewerState,
  cwd: string,
  paths: ReadonlyArray<string> = store.list().map((change) => change.path),
  resolve?: (path: string) => string | undefined,
  opener?: FileOpener,
): Promise<ViewerExit> {
  // Resolution happens once, on open, and its account of an empty result is
  // carried into the panel: the store holds hunks, not reasons.
  const note = resolve?.(path);
  return ctx.ui.custom<ViewerExit>(
    (tui, theme, keybindings, done) =>
      new DiffViewer(
        tui,
        theme,
        keybindings,
        store,
        path,
        state,
        paths,
        note,
        opener,
        done,
      ),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
    },
  );
}
