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
import type { DiffLine, FileChange } from "../domain.ts";
import { diffAgainstHead } from "../git-diff.ts";
import { iconFor, paintIcon } from "../../../shared/tui-kit/icons.ts";
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
    if (this.keybindings.matches(data, "tui.select.down") || data === "j") {
      this.offset += 1;
      this.tui.requestRender();
      return;
    }
    if (this.keybindings.matches(data, "tui.select.up") || data === "k") {
      this.offset = Math.max(0, this.offset - 1);
      this.tui.requestRender();
    }
  }

  /** Paint a line, inverting the words that differ from its counterpart. */
  private paint(line: DiffLine, counterpart: string | undefined): string {
    const color = lineColor(line.kind);
    if (counterpart === undefined || line.kind === "context") {
      return this.theme.fg(color, line.text);
    }
    const spans =
      line.kind === "remove"
        ? wordSpans(line.text, counterpart).removed
        : wordSpans(counterpart, line.text).added;
    return spans
      .map((span) =>
        span.changed
          ? this.theme.inverse(this.theme.fg(color, span.text))
          : this.theme.fg(color, span.text),
      )
      .join("");
  }

  private stackedLines(change: FileChange, width: number): string[] {
    const lines: string[] = [];
    const counterparts = new Map<DiffLine, string>();
    for (const row of pairRows(change.hunks)) {
      if (row.separator || !row.left || !row.right || row.left === row.right) continue;
      counterparts.set(row.left, row.right.text);
      counterparts.set(row.right, row.left.text);
    }
    change.hunks.forEach((hunk, index) => {
      if (index > 0) lines.push(this.theme.fg("dim", "─".repeat(width)));
      for (const line of hunk.lines) {
        const number = line.newLine ?? line.oldLine ?? 0;
        lines.push(
          truncateToWidth(
            this.theme.fg("dim", String(number).padStart(4)) +
              " " +
              this.theme.fg(lineColor(line.kind), `${marker(line.kind)} `) +
              this.paint(line, counterparts.get(line)),
            width,
          ),
        );
      }
    });
    return lines;
  }

  private splitLines(change: FileChange, width: number): string[] {
    const pane = Math.floor((width - 1) / 2);
    const cell = (line: DiffLine | undefined, counterpart: string | undefined) => {
      if (!line) return " ".repeat(pane);
      const body = truncateToWidth(
        this.theme.fg("dim", String(line.newLine ?? line.oldLine ?? 0).padStart(4)) +
          " " +
          this.paint(line, counterpart),
        pane,
      );
      return body + " ".repeat(Math.max(0, pane - visibleWidth(body)));
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
    this.offset = Math.max(
      0,
      Math.min(this.offset, Math.max(0, body.length - height)),
    );

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
    lines.push(
      outerLine(
        width,
        theme.fg(
          "dim",
          `  s split/stacked · n/p file · j/k scroll · ${configuredKeys(this.keybindings, "tui.select.cancel")}/q close`,
        ),
      ),
    );

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
