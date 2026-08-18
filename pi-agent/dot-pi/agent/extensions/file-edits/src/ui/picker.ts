/**
 * The picker: every file changed this session, filterable, most recent first.
 *
 * Hand-rolled rather than built on SelectList because the rows need four
 * columns (icon, path, counts, origin/age) and SelectList's item model is a
 * fixed label/description pair.
 */

import type {
  ExtensionContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { FileChange } from "../domain.ts";
import type { FileEditStore } from "../store.ts";
import {
  createPickerState,
  filterChanges,
  reconcilePickerSelection,
  renderPickerRow,
  type PickerState,
} from "./picker-rows.ts";
import { createViewerState, openDiffViewer, type ViewerState } from "./viewer.ts";

class FilePicker implements Component {
  private closed = false;
  private unsubscribe: () => void;

  constructor(
    private tui: TUI,
    private theme: Theme,
    private keybindings: KeybindingsManager,
    private store: FileEditStore,
    private state: PickerState,
    private done: (value: string | null) => void,
  ) {
    this.unsubscribe = store.subscribe(() => this.tui.requestRender());
  }

  private rows(): ReadonlyArray<FileChange> {
    return filterChanges(this.store.list(), this.state.query);
  }

  private cleanup() {
    if (this.closed) return false;
    this.closed = true;
    this.unsubscribe();
    return true;
  }

  private close(result: string | null) {
    if (this.cleanup()) this.done(result);
  }

  dispose(): void {
    this.cleanup();
  }

  invalidate(): void {}

  handleInput(data: string): void {
    const rows = this.rows();
    reconcilePickerSelection(this.state, rows);

    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.close(null);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.confirm")) {
      const picked = rows[this.state.index];
      if (picked) this.close(picked.path);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.up")) {
      if (rows.length > 0) {
        this.state.index = (this.state.index - 1 + rows.length) % rows.length;
        this.state.path = rows[this.state.index]?.path;
        this.tui.requestRender();
      }
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down")) {
      if (rows.length > 0) {
        this.state.index = (this.state.index + 1) % rows.length;
        this.state.path = rows[this.state.index]?.path;
        this.tui.requestRender();
      }
      return;
    }
    // Backspace, then any printable character, edit the filter. Arrow keys
    // are already handled above, so this only sees real text. A filter
    // change reshuffles the rows entirely, so the cursor goes back to the
    // top rather than trying to re-anchor to a row that may have moved.
    if (data === "\x7f" || data === "\b") {
      this.state.query = this.state.query.slice(0, -1);
      this.state.index = 0;
      this.state.path = undefined;
      this.tui.requestRender();
      return;
    }
    // Any printable input extends the filter. Length is not a useful test:
    // a non-ASCII character arrives as several bytes.
    if (!data.startsWith("\x1b") && ![...data].some((ch) => ch < " ")) {
      this.state.query += data;
      this.state.index = 0;
      this.state.path = undefined;
      this.tui.requestRender();
    }
  }

  render(width: number): string[] {
    const theme = this.theme;
    const rows = this.rows();
    reconcilePickerSelection(this.state, rows);

    const inner = width - 2;
    const totals = this.store.totals();
    const now = Date.now();

    const title = theme.fg("accent", " files changed ");
    const summary = theme.fg(
      "muted",
      ` ${totals.files} files  ${theme.fg("toolDiffAdded", `+${totals.added}`)} ${theme.fg("toolDiffRemoved", `−${totals.removed}`)} `,
    );
    const fillWidth = Math.max(
      0,
      inner - visibleWidth(title) - visibleWidth(summary),
    );

    const lines: string[] = [
      theme.fg("border", "╭─") +
        title +
        theme.fg("border", "─".repeat(fillWidth)) +
        summary +
        theme.fg("border", "─╮"),
    ];

    const maxVisible = Math.max(3, (this.tui.terminal.rows || 30) - 8);
    const start = Math.max(
      0,
      Math.min(this.state.index - 2, rows.length - maxVisible),
    );
    const visible = rows.slice(start, start + maxVisible);

    if (visible.length === 0) {
      lines.push(
        theme.fg("border", "│ ") +
          truncateToWidth(theme.fg("dim", "no matching files"), inner - 1) +
          theme.fg("border", " │"),
      );
    }

    visible.forEach((change, offset) => {
      const selected = start + offset === this.state.index;
      const marker = selected ? theme.fg("accent", "› ") : "  ";
      const body = renderPickerRow(change, inner - 3, theme, now);
      const padding = " ".repeat(
        Math.max(0, inner - 3 - visibleWidth(body)),
      );
      lines.push(
        theme.fg("border", "│") +
          marker +
          body +
          padding +
          theme.fg("border", "│"),
      );
    });

    const hint = this.state.query
      ? theme.fg("accent", `filter: ${this.state.query}`)
      : theme.fg("dim", "type to filter · enter open · esc close");
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

/** Returns the chosen path, or null when the user cancelled. */
export async function openFilePicker(
  ctx: ExtensionContext,
  store: FileEditStore,
  state: PickerState,
): Promise<string | null> {
  if (store.size() === 0) {
    ctx.ui.notify("No files changed yet", "info");
    return null;
  }
  return ctx.ui.custom<string | null>(
    (tui, theme, keybindings, done) =>
      new FilePicker(tui, theme, keybindings, store, state, done),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
    },
  );
}

/**
 * Picker → viewer → picker, the same two-stage loop /ps uses. `n`/`p` inside
 * the viewer move between files without returning to the list.
 *
 * The picker state is created once per call — not session-scoped like
 * ViewerState — so filter and cursor survive a trip through the viewer but
 * do not linger between unrelated /files invocations. Mirrors how
 * openTerminalPicker scopes DashboardSelection to one call.
 */
export async function browseChangedFiles(
  ctx: ExtensionContext,
  store: FileEditStore,
  cwd: string,
  viewerState: ViewerState = createViewerState(),
) {
  const pickerState = createPickerState();
  while (true) {
    const picked = await openFilePicker(ctx, store, pickerState);
    if (!picked) return;
    pickerState.path = picked;

    let current: string | null = picked;
    while (current) {
      const paths = filterChanges(store.list(), pickerState.query).map(
        (change) => change.path,
      );
      const exit = await openDiffViewer(ctx, store, current, viewerState, cwd, paths);
      current = exit ? exit.next : null;
      if (current) pickerState.path = current;
    }
  }
}
