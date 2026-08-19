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
import { diffAgainstHead } from "../git-diff.ts";
import { iconFor, paintIcon } from "../../../shared/tui-kit/icons.ts";
import {
  highlightBlock,
  languageForPath,
} from "../../../shared/tui-kit/highlight.ts";
import {
  DIFF_ADDED_BG,
  DIFF_REMOVED_BG,
  fillLine,
  rgbBgOpener,
} from "../../../shared/tui-kit/paint.ts";
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
 * Whether the viewer has to ask git what changed.
 *
 * Two records arrive without hunks, not one: a child session's change, which
 * announces itself as pending, and anything `write` produced — write reports
 * no patch (record.ts measureWrite), so its record lands with zero hunks and
 * `hunksPending` already false. Keying off the flag alone left every written
 * file showing an empty panel.
 */
export function needsHunkResolution(change: FileChange | undefined): boolean {
  if (!change) return false;
  return change.hunksPending || change.hunks.length === 0;
}

/** Why the body is empty, or null when it is not. A blank panel is a bug
 * report waiting to happen; say what happened instead. */
export function emptyBodyMessage(change: FileChange | undefined): string | null {
  if (!change) return "file is no longer tracked";
  if (change.hunks.length > 0) return null;
  if (change.hunksPending) return "no diff available for this file yet";
  return "no diff against HEAD — the file matches the last commit";
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
 * copied hunk is meant to paste into a review or a patch file. Hunks are
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

/** The background a line sits on: none for context, a tint for a change. */
function tintOpener(kind: DiffLine["kind"]): string {
  if (kind === "add") return ADDED_OPENER;
  if (kind === "remove") return REMOVED_OPENER;
  return "";
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
 * The code half of a line: syntax-highlighted, or — when the line has a
 * counterpart — painted flat with the words that differ inverted.
 */
export function codeBody(
  theme: Theme,
  line: DiffLine,
  counterpart: string | undefined,
  highlighted: string,
): string {
  const color = lineColor(line.kind);
  if (counterpart === undefined || line.kind === "context") {
    // highlightBlock hands back the input unchanged when the language is
    // unknown or the theme has no colours; fall back to a flat diff colour
    // rather than emitting an uncoloured row.
    return highlighted === line.text ? theme.fg(color, line.text) : highlighted;
  }
  // Syntax highlighting is intentionally skipped on these lines: the word
  // spans are offsets into the raw text, and they cannot be mapped onto an
  // already-ANSI-coloured string.
  const spans =
    line.kind === "remove"
      ? wordSpans(line.text, counterpart).removed
      : wordSpans(counterpart, line.text).added;
  return spans
    .map((span) =>
      span.changed
        ? theme.inverse(theme.fg(color, span.text))
        : theme.fg(color, span.text),
    )
    .join("");
}

export class DiffViewer implements Component {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private store: FileEditStore;
  private path: string;
  private state: ViewerState;
  private paths: ReadonlyArray<string>;
  private done: (value: ViewerExit) => void;

  private offset = 0;
  /** The body height the last render used, so a page/half-page key knows how
   * far a page is before render() runs again. Seeded with a plausible pane
   * rather than 0: the first keypress can arrive before the first render. */
  private lastViewport = 20;
  private copyNote: string | undefined;
  private closed = false;
  private unsubscribe: () => void;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    store: FileEditStore,
    path: string,
    state: ViewerState,
    paths: ReadonlyArray<string>,
    done: (value: ViewerExit) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.store = store;
    this.path = path;
    this.state = state;
    this.paths = paths;
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
    // The receipt belongs to the copy that produced it; any other key that we
    // act on moves past it. The pending copy's .then still overwrites this,
    // which is what makes a slow copier's note land rather than vanish.
    this.copyNote = undefined;
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
    if (data === "n" || data === "p") {
      const next = this.sibling(data === "n" ? 1 : -1);
      if (next) this.close({ next });
      return;
    }
    if (data === "y") {
      const change = this.change();
      if (change) {
        void copyText(serializeHunks(change.hunks), "diff").then((note) => {
          this.copyNote = note;
          this.tui.requestRender();
        });
      }
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

    const placeholder = emptyBodyMessage(change);
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
    const legend =
      `  s split/stacked · n/p file · j/k/ctrl-d/u scroll · g/G top/bottom` +
      ` · y copy · ${configuredKeys(this.keybindings, "tui.select.cancel")}/q close` +
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
): Promise<ViewerExit> {
  const change = store.get(path);
  if (needsHunkResolution(change)) {
    const resolved = diffAgainstHead(cwd, path);
    if (resolved) {
      store.resolveHunks(path, {
        hunks: resolved.hunks,
        added: resolved.added,
        removed: resolved.removed,
      });
    }
  }
  return ctx.ui.custom<ViewerExit>(
    (tui, theme, keybindings, done) =>
      new DiffViewer(tui, theme, keybindings, store, path, state, paths, done),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
    },
  );
}
