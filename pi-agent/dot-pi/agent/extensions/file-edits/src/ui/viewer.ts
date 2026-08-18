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
import { iconFor, paintIcon } from "../icons.ts";
import type { FileEditStore } from "../store.ts";

export type ViewMode = "stacked" | "split";

/** Below this, two panes of code are unreadable. */
const MIN_SPLIT_WIDTH = 90;

/** Survives one viewer instance so the choice is made once per session. */
export interface ViewerState {
  mode: ViewMode;
}

/** What the viewer returns: a sibling to open, or null to go back. */
export type ViewerExit = { readonly next: string } | null;

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

class DiffViewer implements Component {
  private offset = 0;
  private closed = false;
  private unsubscribe: () => void;

  constructor(
    private tui: TUI,
    private theme: Theme,
    private keybindings: KeybindingsManager,
    private store: FileEditStore,
    private path: string,
    private state: ViewerState,
    private done: (value: ViewerExit) => void,
  ) {
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
    const paths = this.store.list().map((change) => change.path);
    const current = paths.indexOf(this.path);
    if (current === -1 || paths.length === 0) return undefined;
    return paths[(current + step + paths.length) % paths.length];
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

  private stackedLines(change: FileChange, width: number): string[] {
    const lines: string[] = [];
    change.hunks.forEach((hunk, index) => {
      if (index > 0) lines.push(this.theme.fg("dim", "─".repeat(width)));
      for (const line of hunk.lines) {
        const number = line.newLine ?? line.oldLine ?? 0;
        lines.push(
          truncateToWidth(
            this.theme.fg("dim", String(number).padStart(4)) +
              " " +
              this.theme.fg(
                lineColor(line.kind),
                `${marker(line.kind)} ${line.text}`,
              ),
            width,
          ),
        );
      }
    });
    return lines;
  }

  private splitLines(change: FileChange, width: number): string[] {
    const pane = Math.floor((width - 1) / 2);
    const cell = (line: DiffLine | undefined) => {
      if (!line) return " ".repeat(pane);
      const body = truncateToWidth(
        this.theme.fg("dim", String(line.newLine ?? line.oldLine ?? 0).padStart(4)) +
          " " +
          this.theme.fg(lineColor(line.kind), line.text),
        pane,
      );
      return body + " ".repeat(Math.max(0, pane - visibleWidth(body)));
    };

    return pairRows(change.hunks).map((row: SplitRow) =>
      row.separator
        ? this.theme.fg("dim", "─".repeat(width))
        : `${cell(row.left)}${this.theme.fg("border", "│")}${cell(row.right)}`,
    );
  }

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

    const heading =
      `${paintIcon(iconFor(this.path))} ${theme.bold(theme.fg("text", this.path))} ` +
      (change
        ? `${theme.fg("toolDiffAdded", `+${change.added}`)} ${theme.fg("toolDiffRemoved", `−${change.removed}`)} `
        : "") +
      `${label("stacked")} ${label("split")}` +
      (narrow ? theme.fg("dim", "  (too narrow to split)") : "");

    const lines: string[] = [
      theme.fg("border", "╭─ ") +
        truncateToWidth(heading, inner - 2) +
        theme.fg("border", " ─╮"),
    ];

    const body = !change
      ? [theme.fg("dim", "file is no longer tracked")]
      : change.hunksPending
        ? [theme.fg("dim", "no diff available for this file")]
        : mode === "split"
          ? this.splitLines(change, inner - 2)
          : this.stackedLines(change, inner - 2);

    const height = Math.max(4, (this.tui.terminal.rows || 30) - 6);
    this.offset = Math.max(0, Math.min(this.offset, Math.max(0, body.length - height)));

    for (const line of body.slice(this.offset, this.offset + height)) {
      const padding = " ".repeat(Math.max(0, inner - 2 - visibleWidth(line)));
      lines.push(
        theme.fg("border", "│ ") + line + padding + theme.fg("border", " │"),
      );
    }

    const hint = theme.fg(
      "dim",
      "s split · n/p file · j/k scroll · q close",
    );
    lines.push(
      theme.fg("border", "╰─ ") +
        hint +
        theme.fg(
          "border",
          "─".repeat(Math.max(0, inner - visibleWidth(hint) - 2)),
        ) +
        theme.fg("border", "╯"),
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
): Promise<ViewerExit> {
  return ctx.ui.custom<ViewerExit>(
    (tui, theme, keybindings, done) =>
      new DiffViewer(tui, theme, keybindings, store, path, state, done),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
    },
  );
}
