/**
 * The picker: every command run this session, filterable, most recent first.
 *
 * Hand-rolled rather than built on SelectList, for the same reason the
 * file-edits picker is: the rows need columns, and SelectList's item model is
 * a fixed label/description pair.
 */

import type {
  ExtensionContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { CommandRecord } from "../domain.ts";
import type { CommandStore } from "../store.ts";
import {
  bodyHeight,
  bodyRow,
  bottomBorder,
  outerLine,
  topBorder,
} from "../../../shared/tui-kit/frame.ts";
import { paintSelected } from "../../../shared/tui-kit/paint.ts";
import {
  createPickerState,
  filterRecords,
  reconcilePickerSelection,
  renderPickerRow,
  type PickerState,
} from "./rows.ts";
import { openCommandViewer, createViewerState, type ViewerState } from "./viewer.ts";

function configuredKeys(
  keybindings: KeybindingsManager,
  binding: Parameters<KeybindingsManager["getKeys"]>[0],
) {
  return keybindings.getKeys(binding).join("/") || "unbound";
}

export class CommandPicker implements Component {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private store: CommandStore;
  private state: PickerState;
  private done: (value: string | null) => void;

  private closed = false;
  private unsubscribe: () => void;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    store: CommandStore,
    state: PickerState,
    done: (value: string | null) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.store = store;
    this.state = state;
    this.done = done;
    this.unsubscribe = store.subscribe(() => this.tui.requestRender());
  }

  private rows(): ReadonlyArray<CommandRecord> {
    return filterRecords(this.store.list(), this.state.query);
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
      if (picked) this.close(picked.id);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.up")) {
      if (rows.length > 0) {
        this.state.index = (this.state.index - 1 + rows.length) % rows.length;
        this.state.id = rows[this.state.index]?.id;
        this.tui.requestRender();
      }
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down")) {
      if (rows.length > 0) {
        this.state.index = (this.state.index + 1) % rows.length;
        this.state.id = rows[this.state.index]?.id;
        this.tui.requestRender();
      }
      return;
    }
    // Backspace, then any printable character, edit the filter. A filter
    // change reshuffles the rows entirely, so the cursor goes back to the top
    // rather than re-anchoring to a row that may have moved.
    if (data === "\x7f" || data === "\b") {
      this.state.query = this.state.query.slice(0, -1);
      this.state.index = 0;
      this.state.id = undefined;
      this.tui.requestRender();
      return;
    }
    // Length is not a useful test here: a non-ASCII character arrives as
    // several bytes.
    if (!data.startsWith("\x1b") && ![...data].some((ch) => ch < " ")) {
      this.state.query += data;
      this.state.index = 0;
      this.state.id = undefined;
      this.tui.requestRender();
    }
  }

  /** Title line, two borders, key legend. */
  private static readonly CHROME = 4;

  render(width: number): string[] {
    const theme = this.theme;
    const rows = this.rows();
    reconcilePickerSelection(this.state, rows);

    const totals = this.store.totals();
    const now = Date.now();
    const height = bodyHeight(this.tui.terminal.rows, CommandPicker.CHROME);
    const inner = width - 2;

    const heading = theme.bold(theme.fg("accent", "Commands run"));
    const tally =
      theme.fg(
        "muted",
        `${totals.commands} command${totals.commands === 1 ? "" : "s"}`,
      ) +
      (totals.failed > 0 ? theme.fg("error", `  ${totals.failed} failed`) : "");
    const gap = Math.max(
      1,
      width - visibleWidth(heading) - visibleWidth(tally) - 4,
    );

    const lines: string[] = [
      outerLine(width, `  ${heading}${" ".repeat(gap)}${tally}  `),
      topBorder(
        theme,
        width,
        this.state.query ? `filter: ${this.state.query}` : "",
      ),
    ];

    // Keep the cursor inside the window, clamped so short lists start at 0.
    const start = Math.max(
      0,
      Math.min(this.state.index - Math.floor(height / 2), rows.length - height),
    );
    const visible = rows.slice(start, start + height);

    for (let index = 0; index < height; index += 1) {
      const record = visible[index];
      if (!record) {
        // Empty rows are still drawn, so the panel keeps its shape.
        const placeholder =
          index === 0 && rows.length === 0
            ? `  ${theme.fg("dim", this.state.query ? "no matching commands" : "no commands yet")}`
            : "";
        lines.push(bodyRow(theme, width, placeholder));
        continue;
      }
      const selected = start + index === this.state.index;
      const marker = selected ? theme.fg("accent", "❯ ") : "  ";
      // inner - 2 leaves room for the marker; the selection fill (or bodyRow's
      // own pad) covers the remainder of the row.
      const body = marker + renderPickerRow(record, inner - 2, theme, now);
      lines.push(
        bodyRow(theme, width, selected ? paintSelected(body, inner, theme) : body),
      );
    }

    lines.push(bottomBorder(theme, width));
    lines.push(
      outerLine(
        width,
        theme.fg(
          "dim",
          `  ${configuredKeys(this.keybindings, "tui.select.up")}/${configuredKeys(this.keybindings, "tui.select.down")} select · ${configuredKeys(this.keybindings, "tui.select.confirm")} inspect · type to filter · ${configuredKeys(this.keybindings, "tui.select.cancel")} close`,
        ),
      ),
    );

    return lines;
  }
}

/** Returns the chosen record id, or null when the user cancelled. */
export async function openCommandPicker(
  ctx: ExtensionContext,
  store: CommandStore,
  state: PickerState,
): Promise<string | null> {
  if (store.size() === 0) {
    ctx.ui.notify("No commands run yet", "info");
    return null;
  }
  return ctx.ui.custom<string | null>(
    (tui, theme, keybindings, done) =>
      new CommandPicker(tui, theme, keybindings, store, state, done),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
    },
  );
}

/**
 * Picker → viewer → picker, the two-stage loop /ps and /files both use.
 * `n`/`p` inside the viewer walk the filtered list without coming back here.
 *
 * Picker state is per invocation, so a filter survives a trip through the
 * viewer but does not linger between unrelated /cmds calls.
 */
export async function browseCommands(
  ctx: ExtensionContext,
  store: CommandStore,
  viewerState: ViewerState = createViewerState(),
) {
  const pickerState = createPickerState();
  while (true) {
    const picked = await openCommandPicker(ctx, store, pickerState);
    if (!picked) return;
    pickerState.id = picked;

    let current: string | null = picked;
    while (current) {
      const ids = filterRecords(store.list(), pickerState.query).map(
        (record) => record.id,
      );
      const exit = await openCommandViewer(ctx, store, current, viewerState, ids);
      current = exit?.next ?? null;
      if (current) pickerState.id = current;
    }
  }
}
