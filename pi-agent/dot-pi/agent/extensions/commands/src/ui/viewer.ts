/**
 * The detail view: one command, its metadata, and its output in a fixed-height
 * scrollable viewport. Read-only — a finished command has nothing to steer,
 * and a running one is what /ps is for.
 *
 * The one thing this shows that the transcript could not: when bash truncated
 * the output, the whole run is still in a temp file, and `f` reads it back.
 */

import type {
  ExtensionContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { CommandRecord } from "../domain.ts";
import {
  formatBytes,
  formatDuration,
  formatLines,
  formatStatus,
  originLabel,
  statusColor,
  statusGlyph,
} from "../domain.ts";
import { readFullOutput, type FullOutput } from "../full-output.ts";
import { createOutputLineCache, oneLine, sanitizeText } from "../output.ts";
import type { CommandStore } from "../store.ts";

const SCROLL_STEP = 6;

/** Session-scoped preferences, so a choice made once survives the next open. */
export interface ViewerState {
  /** Prefer the untruncated spill file when there is one. */
  full: boolean;
}

export function createViewerState(): ViewerState {
  return { full: true };
}

export interface ViewerExit {
  /** The record to open next, or null to fall back to the picker. */
  readonly next: string | null;
}

/** Walk a list of ids by `delta`, wrapping. Pure, so navigation is testable
 * without a terminal. */
export function stepId(
  ids: ReadonlyArray<string>,
  current: string,
  delta: number,
): string | null {
  if (ids.length === 0) return null;
  const index = ids.indexOf(current);
  if (index < 0) return ids[0] ?? null;
  const next = (index + delta + ids.length) % ids.length;
  return ids[next] ?? null;
}

class CommandViewer implements Component {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private store: CommandStore;
  private id: string;
  private state: ViewerState;
  private ids: ReadonlyArray<string>;
  private done: (value: ViewerExit | null) => void;

  /** Lines from the bottom. 0 pins to the end, where the result is. */
  private scrollOffset = 0;
  private lineCache = createOutputLineCache();
  private fullOutput: FullOutput | undefined;
  private closed = false;
  private unsubscribe: () => void;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    store: CommandStore,
    id: string,
    state: ViewerState,
    ids: ReadonlyArray<string>,
    done: (value: ViewerExit | null) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.store = store;
    this.id = id;
    this.state = state;
    this.ids = ids;
    this.done = done;
    this.unsubscribe = store.subscribe(() => this.tui.requestRender());
    this.loadFull();
  }

  private record(): CommandRecord | undefined {
    return this.store.get(this.id);
  }

  /** Lazy, once per record: the spill file is read when the view opens, not
   * when the command ran. */
  private loadFull() {
    this.fullOutput = undefined;
    const path = this.record()?.fullOutputPath;
    if (!path) return;
    this.fullOutput = readFullOutput(path);
  }

  private cleanup() {
    if (this.closed) return false;
    this.closed = true;
    this.unsubscribe();
    return true;
  }

  private close(exit: ViewerExit | null) {
    if (this.cleanup()) this.done(exit);
  }

  dispose(): void {
    this.cleanup();
  }

  invalidate(): void {}

  /** Whether the viewport is currently showing the spill file. */
  private showingFull() {
    return this.state.full && this.fullOutput?.kind === "loaded";
  }

  handleInput(data: string): void {
    if (
      this.keybindings.matches(data, "tui.select.cancel") ||
      this.keybindings.matches(data, "app.interrupt")
    ) {
      this.close(null);
      return;
    }
    if (data === "n" || data === "p") {
      const next = stepId(this.ids, this.id, data === "n" ? 1 : -1);
      this.close(next ? { next } : null);
      return;
    }
    if (data === "f") {
      this.state.full = !this.state.full;
      this.lineCache = createOutputLineCache();
      this.scrollOffset = 0;
      this.tui.requestRender();
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.cursorUp") || data === "k") {
      this.scrollOffset += SCROLL_STEP;
      this.tui.requestRender();
      return;
    }
    if (
      this.keybindings.matches(data, "tui.editor.cursorDown") ||
      data === "j"
    ) {
      this.scrollOffset = Math.max(0, this.scrollOffset - SCROLL_STEP);
      this.tui.requestRender();
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.pageUp")) {
      this.scrollOffset += this.viewportHeight();
      this.tui.requestRender();
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.pageDown")) {
      this.scrollOffset = Math.max(0, this.scrollOffset - this.viewportHeight());
      this.tui.requestRender();
      return;
    }
    if (data === "g") {
      this.scrollOffset = Number.MAX_SAFE_INTEGER; // clamped in render
      this.tui.requestRender();
      return;
    }
    if (data === "G") {
      this.scrollOffset = 0;
      this.tui.requestRender();
    }
  }

  private viewportHeight(): number {
    const rows = this.tui.terminal.rows || 30;
    // viewport + 8 chrome rows keeps the overlay at terminal rows - 1.
    return Math.max(6, rows - 9);
  }

  render(width: number): string[] {
    const theme = this.theme;
    const border = theme.fg("borderAccent", "─".repeat(Math.max(1, width)));
    const record = this.record();
    if (!record) {
      return [border, theme.fg("dim", "this command is no longer tracked"), border];
    }

    const lines: string[] = [border];

    const color = statusColor(record);
    const origin = originLabel(record.origin);
    const header =
      theme.fg(color, `${statusGlyph(record)} `) +
      theme.bold(theme.fg("accent", record.tool)) +
      theme.fg(
        "muted",
        ` · ${formatStatus(record)} · ${formatDuration(record.durationMs)} · ${formatLines(record.outputLines)} · ${formatBytes(record.outputBytes)}`,
      ) +
      (origin ? theme.fg("accent", ` · ${oneLine(origin)}`) : "") +
      theme.fg("dim", ` · ${record.cwd}`);
    lines.push(truncateToWidth(header, width));

    // The command gets its own lines: a script pasted into bash is the thing
    // you came here to read, and folding it to one line would hide it.
    const commandLines = sanitizeText(record.command).split("\n").slice(0, 3);
    for (const line of commandLines) {
      lines.push(
        truncateToWidth(theme.fg("dim", "$ ") + theme.fg("text", line), width),
      );
    }
    lines.push(border);

    const { text, note } = this.body(record, theme);
    const output = this.lineCache.get(
      text,
      `${record.id}:${this.showingFull() ? "full" : "tool"}`,
      width - 2,
    );

    const viewport = this.viewportHeight();
    const body: string[] = [];
    if (note) body.push(truncateToWidth(note, width));

    const scrollRows = this.scrollOffset > 0 ? 1 : 0;
    const capacity = Math.max(1, viewport - body.length - scrollRows);
    const maxOffset = Math.max(0, output.length - capacity);
    if (this.scrollOffset > maxOffset) this.scrollOffset = maxOffset;

    const end = output.length - this.scrollOffset;
    const visible = output.slice(Math.max(0, end - capacity), end);
    if (visible.length === 0) {
      body.push(theme.fg("dim", "  (no output)"));
    } else {
      for (const line of visible) body.push(truncateToWidth(`  ${line}`, width));
    }
    if (this.scrollOffset > 0) {
      body.push(
        truncateToWidth(
          theme.fg("dim", `... ${this.scrollOffset} lines below · ↓/pgdn`),
          width,
        ),
      );
    }
    while (body.length < viewport) body.push("");
    lines.push(...body.slice(0, viewport));

    lines.push(border);
    lines.push(
      truncateToWidth(
        theme.fg(
          "dim",
          `${configuredKeys(this.keybindings, "tui.select.cancel")} back · n/p prev/next · ${record.fullOutputPath ? "f full/truncated · " : ""}${configuredKeys(this.keybindings, "tui.editor.cursorUp")}/${configuredKeys(this.keybindings, "tui.editor.cursorDown")}/jk scroll · g/G top/bottom`,
        ),
        width,
      ),
    );
    lines.push(border);
    return lines;
  }

  /** Which text the viewport shows, and the one-line explanation of why. */
  private body(record: CommandRecord, theme: Theme) {
    const full = this.fullOutput;
    if (!record.fullOutputPath || !full) {
      return { text: record.output, note: "" };
    }
    if (full.kind === "missing") {
      return {
        text: record.output,
        note: theme.fg(
          "dim",
          `  truncated · the full log at ${record.fullOutputPath} is gone`,
        ),
      };
    }
    if (full.kind === "error") {
      return {
        text: record.output,
        note: theme.fg("warning", `  truncated · ${oneLine(full.message)}`),
      };
    }
    if (!this.state.full) {
      return {
        text: record.output,
        note: theme.fg("dim", "  truncated as the model saw it · f for the full log"),
      };
    }
    return {
      text: full.text,
      note: theme.fg(
        "success",
        `  full log${full.capped ? " (last 2 MB)" : ""} from ${record.fullOutputPath} · f for the truncated view`,
      ),
    };
  }
}

function configuredKeys(
  keybindings: KeybindingsManager,
  binding: Parameters<KeybindingsManager["getKeys"]>[0],
) {
  return keybindings.getKeys(binding).join("/") || "unbound";
}

export async function openCommandViewer(
  ctx: ExtensionContext,
  store: CommandStore,
  id: string,
  state: ViewerState,
  ids: ReadonlyArray<string>,
): Promise<ViewerExit | null> {
  return ctx.ui.custom<ViewerExit | null>(
    (tui, theme, keybindings, done) =>
      new CommandViewer(tui, theme, keybindings, store, id, state, ids, done),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
    },
  );
}
