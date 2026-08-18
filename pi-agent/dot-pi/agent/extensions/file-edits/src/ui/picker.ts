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
import { filterChanges, renderPickerRow } from "./picker-rows.ts";
import { createViewerState, openDiffViewer, type ViewerState } from "./viewer.ts";

class FilePicker implements Component {
  private query = "";
  private index = 0;
  private closed = false;
  private unsubscribe: () => void;

  constructor(
    private tui: TUI,
    private theme: Theme,
    private keybindings: KeybindingsManager,
    private store: FileEditStore,
    private done: (value: string | null) => void,
  ) {
    this.unsubscribe = store.subscribe(() => this.tui.requestRender());
  }

  private rows(): ReadonlyArray<FileChange> {
    return filterChanges(this.store.list(), this.query);
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

    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.close(null);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.confirm")) {
      const picked = rows[this.index];
      if (picked) this.close(picked.path);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.up")) {
      if (rows.length > 0) {
        this.index = (this.index - 1 + rows.length) % rows.length;
        this.tui.requestRender();
      }
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down")) {
      if (rows.length > 0) {
        this.index = (this.index + 1) % rows.length;
        this.tui.requestRender();
      }
      return;
    }
    // Backspace, then any printable character, edit the filter. Arrow keys
    // are already handled above, so this only sees real text.
    if (data === "\x7f" || data === "\b") {
      this.query = this.query.slice(0, -1);
      this.index = 0;
      this.tui.requestRender();
      return;
    }
    if (data.length === 1 && data >= " " && data !== "\x1b") {
      this.query += data;
      this.index = 0;
      this.tui.requestRender();
    }
  }

  render(width: number): string[] {
    const theme = this.theme;
    const rows = this.rows();
    if (this.index >= rows.length) this.index = Math.max(0, rows.length - 1);

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
    const start = Math.max(0, Math.min(this.index - 2, rows.length - maxVisible));
    const visible = rows.slice(start, start + maxVisible);

    if (visible.length === 0) {
      lines.push(
        theme.fg("border", "│ ") +
          truncateToWidth(theme.fg("dim", "no matching files"), inner - 1) +
          theme.fg("border", " │"),
      );
    }

    visible.forEach((change, offset) => {
      const selected = start + offset === this.index;
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

    const hint = this.query
      ? theme.fg("accent", `filter: ${this.query}`)
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
): Promise<string | null> {
  if (store.size() === 0) {
    ctx.ui.notify("No files changed yet", "info");
    return null;
  }
  return ctx.ui.custom<string | null>(
    (tui, theme, keybindings, done) =>
      new FilePicker(tui, theme, keybindings, store, done),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
    },
  );
}

/**
 * Picker → viewer → picker, the same two-stage loop /ps uses. `n`/`p` inside
 * the viewer move between files without returning to the list.
 */
export async function browseChangedFiles(
  ctx: ExtensionContext,
  store: FileEditStore,
  state: ViewerState = createViewerState(),
) {
  while (true) {
    const picked = await openFilePicker(ctx, store);
    if (!picked) return;

    let current: string | null = picked;
    while (current) {
      const exit = await openDiffViewer(ctx, store, current, state);
      current = exit ? exit.next : null;
    }
  }
}
