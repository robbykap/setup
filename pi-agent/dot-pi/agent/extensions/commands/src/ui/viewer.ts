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
import { sectionRule } from "../../../shared/tui-kit/frame.ts";
import { copyText } from "../../../shared/tui-kit/copy.ts";
import {
  applyBottomAnchored,
  clampOffset,
  scrollActionFor,
} from "../../../shared/tui-kit/scroll.ts";

/** How much of the command the top rule's label can carry before the rule
 * itself would be all label. */
const RULE_LABEL_WIDTH = 40;

/**
 * The scrollable half of the view, as one block: the command under its own
 * rule, the output under a second, and the result on a third. Built whole so
 * one bottom-anchored window can scroll all of it — the command scrolls out of
 * the way of a long log, and `g` brings it back.
 *
 * `outputLines` arrive already wrapped to `width` by the caller's line cache;
 * everything else is truncated here, so every line is at most `width` cells.
 */
export function buildBody(
  record: CommandRecord,
  outputLines: ReadonlyArray<string>,
  theme: Theme,
  width: number,
): string[] {
  const label = truncateToWidth(oneLine(record.command), RULE_LABEL_WIDTH);
  const lines = [sectionRule(theme, width, `$ ${label}`)];

  // The command gets its own lines, all of them: a script pasted into bash is
  // the thing you came here to read, and folding or clamping it would hide it.
  sanitizeText(record.command)
    .split("\n")
    .forEach((line, index) => {
      const prefix = index === 0 ? theme.fg("dim", "$ ") : "  ";
      lines.push(truncateToWidth(prefix + theme.fg("text", line), width));
    });

  lines.push(sectionRule(theme, width, "output", "muted"));
  for (const line of outputLines) lines.push(truncateToWidth(line, width));
  lines.push(
    sectionRule(
      theme,
      width,
      `${formatStatus(record)} · ${formatDuration(record.durationMs)}`,
      statusColor(record),
    ),
  );
  return lines;
}

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

export class CommandViewer implements Component {
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
    if (data === "y" || data === "Y") {
      const record = this.record();
      if (!record) return;
      const text = data === "y" ? record.command : this.body(record, this.theme).text;
      this.copy(text, data === "y" ? "command" : "output");
      return;
    }
    const action = scrollActionFor(data, this.keybindings, { vimKeys: true });
    if (action) {
      this.scrollOffset = applyBottomAnchored(
        this.scrollOffset,
        action,
        this.viewportHeight(),
      );
      this.tui.requestRender();
    }
  }

  private copy(text: string, label: string) {
    if (text.length === 0) {
      // An empty clipboard reads as a failed copy; say which it was.
      this.copyNote = "nothing to copy";
      this.tui.requestRender();
      return;
    }
    void copyText(text, label, this.copier)
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
  }

  private viewportHeight(): number {
    const rows = this.tui.terminal.rows || 30;
    // viewport + 6 chrome rows (four borders, the header, the legend) keeps
    // the overlay at terminal rows - 1.
    return Math.max(6, rows - 7);
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
    lines.push(border);

    const { text, note } = this.body(record, theme);
    const output =
      text.length === 0
        ? [theme.fg("dim", "(no output)")]
        : this.lineCache.get(
            text,
            `${record.id}:${this.showingFull() ? "full" : "tool"}`,
            width - 2,
          );

    const viewport = this.viewportHeight();
    const body: string[] = [];
    // The note explains which text the block below is, so it stays put while
    // that text scrolls under it.
    if (note) body.push(truncateToWidth(note, width));

    const block = buildBody(record, output, theme, width - 2);
    const scrollRows = this.scrollOffset > 0 ? 1 : 0;
    const capacity = Math.max(1, viewport - body.length - scrollRows);
    // The kit asks callers to clamp on store, which we cannot: the maximum
    // offset depends on the block's height, and that is only known here.
    // Clamping here is equivalent because the assignment writes the clamped
    // value back into this.scrollOffset, and render() always follows the
    // requestRender that handleInput issued — so `g`'s sentinel is replaced by
    // a real offset before the next keypress reads it, and `j` after `g` moves
    // one line down from the top rather than out of a number nothing can walk
    // back from.
    const maxOffset = Math.max(0, block.length - capacity);
    this.scrollOffset = clampOffset(this.scrollOffset, maxOffset);

    const end = block.length - this.scrollOffset;
    const visible = block.slice(Math.max(0, end - capacity), end);
    for (const line of visible) body.push(truncateToWidth(`  ${line}`, width));
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
    // Short enough to fit an 80-column terminal, so the close key — the way
    // out — is never the part that falls off the end. A copy receipt is the
    // one thing that outranks the scroll hints: it answers a question the
    // reader just asked, and the hints are on screen every other moment.
    const segments = [
      `${configuredKeys(this.keybindings, "tui.select.cancel")} back`,
      "n/p prev/next",
      ...(record.fullOutputPath ? ["f full"] : []),
      ...(this.copyNote ? [] : ["j/k ^d/^u g/G scroll"]),
      "y/Y copy",
      ...(this.copyNote ? [this.copyNote] : []),
    ];
    lines.push(truncateToWidth(theme.fg("dim", segments.join(" · ")), width));
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
