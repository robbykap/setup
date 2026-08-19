/**
 * /ps UI — two-stage full-screen overlay over the synchronous
 * TerminalReadModel:
 * - TerminalDashboard: list of all tracked terminals (select, kill, open).
 * - TerminalDetailView: read-only inspector for one terminal — metadata,
 *   stdout/stderr toggle, scrolling, live tail. No input surface: background
 *   terminals have no stdin by design.
 */

import type {
  ExtensionCommandContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { formatSize } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatElapsed, formatExit, type TerminalSnapshot } from "../domain.ts";
import type { TerminalReadModel } from "../manager.ts";
import { copyText } from "../../../shared/tui-kit/copy.ts";
import { borderSegment, pad } from "../../../shared/tui-kit/frame.ts";
import { paintSelected } from "../../../shared/tui-kit/paint.ts";
import {
  applyBottomAnchored,
  clampOffset,
  scrollActionFor,
} from "../../../shared/tui-kit/scroll.ts";
import { createOutputLineCache, sanitizeText } from "./output-view.ts";

/** One-line-safe rendering of model-provided text (titles, commands): a
 * newline or control char inside a fixed-height row desyncs the renderer. */
function oneLine(text: string) {
  return sanitizeText(text.replace(/\s+/g, " "));
}

function configuredKeys(
  keybindings: KeybindingsManager,
  binding: Parameters<KeybindingsManager["getKeys"]>[0],
) {
  return keybindings.getKeys(binding).join("/") || "unbound";
}

function statusGlyph(snap: TerminalSnapshot, theme: Theme) {
  switch (snap.status) {
    case "running":
      return theme.fg("warning", "■");
    case "done":
      return theme.fg("success", "■");
    case "failed":
      return theme.fg("error", "■");
    case "killed":
      return theme.fg("muted", "■");
  }
}

function statusWord(snap: TerminalSnapshot, theme: Theme) {
  switch (snap.status) {
    case "running":
      return theme.fg("warning", "running");
    case "done":
      return theme.fg("success", "done");
    case "failed":
      return theme.fg("error", "failed");
    case "killed":
      return theme.fg("muted", "killed");
  }
}

// --- Entry point ---------------------------------------------------------------

export async function openTerminalPicker(
  ctx: ExtensionCommandContext,
  view: TerminalReadModel,
) {
  const selection: DashboardSelection = { index: 0 };

  while (true) {
    if (view.size() === 0) {
      ctx.ui.notify("No background terminals", "info");
      return;
    }

    const picked = await ctx.ui.custom<string | null>(
      (tui, theme, keybindings, done) =>
        new TerminalDashboard(tui, theme, keybindings, view, selection, done),
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
      },
    );

    if (!picked) return;
    if (!view.get(picked)) continue;

    await ctx.ui.custom<null>(
      (tui, theme, keybindings, done) =>
        new TerminalDetailView(tui, theme, keybindings, picked, view, done),
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
      },
    );
    // After leaving the detail view, fall back to the dashboard.
  }
}

// --- Dashboard (fullscreen overlay) ----------------------------------------------

export interface DashboardSelection {
  id?: string;
  index: number;
}

export function reconcileDashboardSelection(
  selection: DashboardSelection,
  terminals: ReadonlyArray<Pick<TerminalSnapshot, "id">>,
) {
  const stableIndex = selection.id
    ? terminals.findIndex((snap) => snap.id === selection.id)
    : -1;
  selection.index =
    stableIndex >= 0
      ? stableIndex
      : Math.min(
          Math.max(0, selection.index),
          Math.max(0, terminals.length - 1),
        );
  selection.id = terminals[selection.index]?.id;
}

export class TerminalDashboard implements Component {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private view: TerminalReadModel;
  private selection: DashboardSelection;
  private done: (value: string | null) => void;

  private closed = false;
  private ticker: ReturnType<typeof setInterval>;
  private unsubChange: () => void;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    view: TerminalReadModel,
    selection: DashboardSelection,
    done: (value: string | null) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.view = view;
    this.selection = selection;
    this.done = done;
    // Elapsed times and output sizes tick along at 1Hz.
    this.ticker = setInterval(() => this.tui.requestRender(), 1000);
    this.unsubChange = view.subscribe(() => this.tui.requestRender());
  }

  private terminals(): ReadonlyArray<TerminalSnapshot> {
    return this.view.list();
  }

  private cleanup() {
    if (this.closed) return false;
    this.closed = true;
    clearInterval(this.ticker);
    this.unsubChange();
    return true;
  }

  private close(result: string | null) {
    if (this.cleanup()) this.done(result);
  }

  dispose(): void {
    this.cleanup();
  }

  handleInput(data: string): void {
    const terminals = this.terminals();
    reconcileDashboardSelection(this.selection, terminals);

    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.close(null);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.confirm")) {
      const snap = terminals[this.selection.index];
      if (snap) this.close(snap.id);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.up") || data === "k") {
      if (terminals.length > 0) {
        this.selection.index =
          (this.selection.index - 1 + terminals.length) % terminals.length;
        this.selection.id = terminals[this.selection.index]?.id;
        this.tui.requestRender();
      }
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down") || data === "j") {
      if (terminals.length > 0) {
        this.selection.index = (this.selection.index + 1) % terminals.length;
        this.selection.id = terminals[this.selection.index]?.id;
        this.tui.requestRender();
      }
      return;
    }
    if (data === "x") {
      const snap = terminals[this.selection.index];
      if (snap && snap.status === "running") this.view.requestKill(snap.id);
      return;
    }
  }

  render(width: number): string[] {
    const theme = this.theme;
    const terminals = this.terminals();
    reconcileDashboardSelection(this.selection, terminals);

    const rows = this.tui.terminal.rows || 30;
    // Render exactly terminal rows - 1 so the overlay covers the header,
    // chat, editor, and extra footer lines while leaving pi's final footer
    // row visible.
    const bodyHeight = Math.max(6, rows - 5);
    const innerWidth = width - 2;

    const lines: string[] = [];

    // Header: title left, count right
    const headerLeft = theme.fg("accent", theme.bold("Background terminals"));
    const headerRight = theme.fg(
      "muted",
      `${terminals.length} terminal${terminals.length === 1 ? "" : "s"}`,
    );
    const headerPad = Math.max(
      1,
      width - visibleWidth(headerLeft) - visibleWidth(headerRight) - 4,
    );
    lines.push(
      pad(`  ${headerLeft}${" ".repeat(headerPad)}${headerRight}  `, width),
    );

    // Top border with panel title
    const running = terminals.filter((s) => s.status === "running").length;
    lines.push(
      theme.fg("border", "╭") +
        borderSegment(
          theme,
          innerWidth,
          `terminals · ${running} running / ${terminals.length}`,
        ) +
        theme.fg("border", "╮"),
    );

    // Rows
    const divider = theme.fg("border", "│");
    // renderRows returns rows already fitted to innerWidth: a selected row
    // carries a background fill, and re-padding it here would run the escapes
    // through truncateToWidth a second time.
    const rowLines = this.renderRows(terminals, innerWidth, bodyHeight);
    for (let i = 0; i < bodyHeight; i++) {
      lines.push(
        divider + (rowLines[i] ?? " ".repeat(Math.max(0, innerWidth))) + divider,
      );
    }

    // Bottom border
    lines.push(
      theme.fg("border", "╰") +
        theme.fg("border", "─".repeat(Math.max(0, innerWidth))) +
        theme.fg("border", "╯"),
    );

    // Hints
    lines.push(
      pad(
        theme.fg(
          "dim",
          `  ${configuredKeys(this.keybindings, "tui.select.up")}/${configuredKeys(this.keybindings, "tui.select.down")}/jk select · ${configuredKeys(this.keybindings, "tui.select.confirm")} inspect · x kill · ${configuredKeys(this.keybindings, "tui.select.cancel")} close`,
        ),
        width,
      ),
    );

    return lines;
  }

  private renderRows(
    terminals: ReadonlyArray<TerminalSnapshot>,
    width: number,
    height: number,
  ): string[] {
    const theme = this.theme;
    const out: string[] = [];

    // Scroll window around selection
    let start = 0;
    if (terminals.length > height) {
      start = Math.min(
        Math.max(0, this.selection.index - Math.floor(height / 2)),
        terminals.length - height,
      );
    }
    const visible = terminals.slice(start, start + height);

    for (let i = 0; i < visible.length; i++) {
      const snap = visible[i];
      const index = start + i;
      const isSelected = index === this.selection.index;

      // Left: marker, status square, title, dim id
      const marker = isSelected ? theme.fg("accent", "❯") : " ";
      const title = isSelected
        ? theme.fg("accent", oneLine(snap.title))
        : theme.fg("text", oneLine(snap.title));
      const left = ` ${marker} ${statusGlyph(snap, theme)} ${title} ${theme.fg("dim", snap.id)}`;

      // Right: pid · elapsed · exit/status
      const dot = theme.fg("dim", " · ");
      const rightParts = [
        theme.fg("muted", `pid ${snap.pid ?? "?"}`),
        theme.fg("muted", formatElapsed(snap)),
        snap.status === "running"
          ? statusWord(snap, theme)
          : theme.fg("muted", formatExit(snap)),
      ];
      const right = `${rightParts.join(dot)} `;

      const rightWidth = visibleWidth(right);
      const leftMax = Math.max(0, width - rightWidth - 2);
      const leftTruncated = truncateToWidth(left, leftMax);
      const gap = Math.max(2, width - visibleWidth(leftTruncated) - rightWidth);
      // The marker lives inside the painted body, so the fill spans the row
      // edge to edge; paintSelected pads to `width` itself.
      const row = leftTruncated + " ".repeat(gap) + right;
      out.push(isSelected ? paintSelected(row, width, theme) : pad(row, width));
    }

    if (start > 0) {
      out[0] = pad(theme.fg("dim", `   ... ${start} more`), width);
    }
    if (start + height < terminals.length) {
      out[out.length - 1] = pad(
        theme.fg("dim", `   ... ${terminals.length - start - height} more`),
        width,
      );
    }
    return out;
  }

  invalidate(): void {}
}

// --- Detail view (read-only inspector) --------------------------------------------

export class TerminalDetailView implements Component {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private id: string;
  private view: TerminalReadModel;
  private done: (value: null) => void;

  /** Active output stream shown in the viewport; `t` toggles. */
  private stream: "stdout" | "stderr" = "stdout";
  /** Scroll offset in lines from the bottom. 0 = pinned to bottom (live tail). */
  private scrollOffset = 0;
  private lineCache = createOutputLineCache();
  private copyNote: string | undefined;
  private unsubscribe: () => void;
  private renderTimer?: ReturnType<typeof setTimeout>;
  private ticker: ReturnType<typeof setInterval>;
  private closed = false;
  /** The clipboard itself, injectable so a test can press `y` without one.
   * Package-internal: nothing outside this extension sets it. */
  copier?: (text: string) => Promise<void> | void;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    id: string,
    view: TerminalReadModel,
    done: (value: null) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.id = id;
    this.view = view;
    this.done = done;
    this.unsubscribe = view.subscribeTo(id, () => this.scheduleRender());
    // Elapsed time in the header ticks along at 1Hz.
    this.ticker = setInterval(() => this.tui.requestRender(), 1000);
  }

  private snap(): TerminalSnapshot | undefined {
    return this.view.get(this.id);
  }

  private scheduleRender() {
    if (this.renderTimer) return;
    // A chatty process emits a chunk per write. Limit terminal repaints so
    // this view cannot starve input handling.
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      if (!this.closed) this.tui.requestRender();
    }, 50);
  }

  private cleanup() {
    if (this.closed) return false;
    this.closed = true;
    this.unsubscribe();
    clearInterval(this.ticker);
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = undefined;
    return true;
  }

  private close() {
    if (this.cleanup()) this.done(null);
  }

  dispose(): void {
    this.cleanup();
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
      this.keybindings.matches(data, "app.interrupt") ||
      this.keybindings.matches(data, "tui.select.cancel")
    ) {
      this.close();
      return;
    }
    if (data === "t") {
      this.stream = this.stream === "stdout" ? "stderr" : "stdout";
      this.lineCache = createOutputLineCache();
      this.scrollOffset = 0;
      this.tui.requestRender();
      return;
    }
    if (data === "x") {
      const snap = this.snap();
      if (snap?.status === "running") this.view.requestKill(this.id);
      return;
    }
    if (data === "y") {
      const snap = this.snap();
      if (!snap) return;
      const buffer = this.stream === "stdout" ? snap.stdout : snap.stderr;
      this.copy(buffer.text, this.stream);
      return;
    }
    // vimKeys: this view has no input surface — background terminals have no
    // stdin — so printable keys are ours to bind.
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
        // A copy can outlive the view: the note has nowhere to land, and
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
    // The complete view renders viewport + 8 chrome rows (borders, header,
    // command, tab, hints). rows - 9 makes the overlay ~terminal rows - 1.
    return Math.max(6, rows - 9);
  }

  render(width: number): string[] {
    const theme = this.theme;
    const border = theme.fg("borderAccent", "─".repeat(Math.max(1, width)));
    const lines: string[] = [];
    const snap = this.snap();

    if (!snap) {
      lines.push(border);
      lines.push(theme.fg("dim", `${this.id} is no longer tracked`));
      lines.push(border);
      return lines;
    }

    lines.push(border);
    const header =
      `${statusGlyph(snap, theme)} ` +
      theme.fg("accent", theme.bold(`${snap.id} · ${oneLine(snap.title)}`)) +
      theme.fg(
        "muted",
        ` · ${snap.status} · ${formatElapsed(snap)} · pid ${snap.pid ?? "?"}`,
      ) +
      (snap.status !== "running"
        ? theme.fg("muted", ` · ${formatExit(snap)}`)
        : "") +
      theme.fg("dim", ` · ${snap.cwd}`);
    lines.push(truncateToWidth(header, width));
    lines.push(
      truncateToWidth(
        theme.fg("dim", "$ ") + theme.fg("text", oneLine(snap.command)),
        width,
      ),
    );
    lines.push(border);

    // Stream tab line: which stream is active, both sizes.
    const active = this.stream;
    const viewData = active === "stdout" ? snap.stdout : snap.stderr;
    const tab = (name: "stdout" | "stderr", size: number) =>
      name === active
        ? theme.fg("accent", theme.bold(`${name} (${formatSize(size)})`))
        : theme.fg("dim", `${name} (${formatSize(size)})`);
    lines.push(
      truncateToWidth(
        `  ${tab("stdout", snap.stdout.totalBytes)}${theme.fg("dim", " | ")}${tab("stderr", snap.stderr.totalBytes)}${theme.fg("dim", "  — t to switch")}`,
        width,
      ),
    );

    // Fixed-height output viewport. Notes and scroll status consume rows
    // inside the viewport so streaming/scrolling never changes overlay height.
    const buffer = viewData;
    const version =
      // The cached view text identity changes with the buffer; totalBytes is a
      // monotonically increasing proxy for a version counter.
      buffer.totalBytes;
    const output = this.lineCache.get(buffer.text, version, width - 2);
    const viewport = this.viewportHeight();

    const noteRows: string[] = [];
    if (snap.errorText) {
      noteRows.push(
        truncateToWidth(
          theme.fg("error", `error: ${oneLine(snap.errorText)}`),
          width,
        ),
      );
    }
    if (buffer.truncatedBytes > 0) {
      noteRows.push(
        truncateToWidth(
          theme.fg(
            "dim",
            `first ${formatSize(buffer.truncatedBytes)} dropped from view — full log: ${buffer.spillPath ?? "(unavailable)"}`,
          ),
          width,
        ),
      );
    }

    const body: string[] = [...noteRows];
    const scrollRows = this.scrollOffset > 0 ? 1 : 0;
    const capacity = Math.max(1, viewport - body.length - scrollRows);
    // The kit asks callers to clamp on store, which we cannot: the maximum
    // offset depends on the wrapped output's height, and that is only known
    // here. Clamping here is equivalent because the assignment writes the
    // clamped value back into this.scrollOffset, and render() always follows
    // the requestRender that handleInput issued — so `g`'s sentinel is replaced
    // by a real offset before the next keypress reads it, and `j` after `g`
    // moves one line down from the top.
    const maxOffset = Math.max(0, output.length - capacity);
    this.scrollOffset = clampOffset(this.scrollOffset, maxOffset);

    const end = output.length - this.scrollOffset;
    const visible = output.slice(Math.max(0, end - capacity), end);
    if (visible.length === 0) {
      body.push(theme.fg("dim", `(no ${active} yet)`));
    } else {
      for (const line of visible) {
        body.push(truncateToWidth(`  ${line}`, width));
      }
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
    // Short enough to fit an 80-column terminal, so the close key — the way
    // out — is never the part that falls off the end. A copy receipt outranks
    // the scroll hints: it answers a question the reader just asked, and the
    // hints are on screen every other moment.
    const segments = [
      `${configuredKeys(this.keybindings, "tui.select.cancel")} back`,
      "t stdout/stderr",
      "x kill",
      ...(this.copyNote ? [] : ["j/k ^d/^u g/G scroll"]),
      "y copy",
      ...(this.copyNote ? [this.copyNote] : []),
    ];
    lines.push(truncateToWidth(theme.fg("dim", segments.join(" · ")), width));
    lines.push(border);
    return lines;
  }

  invalidate(): void {}
}
