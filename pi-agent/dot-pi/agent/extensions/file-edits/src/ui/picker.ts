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
import { visibleWidth } from "@earendil-works/pi-tui";
import { groupLabel, type FileChange } from "../domain.ts";
import type { FileEditStore } from "../store.ts";
import {
  bodyHeight,
  bodyRow,
  bottomBorder,
  outerLine,
  sectionRule,
  topBorder,
} from "../../../shared/tui-kit/frame.ts";
import { paintSelected } from "../../../shared/tui-kit/paint.ts";
import {
  displayIndexOf,
  groupRows,
  type DisplayRow,
} from "../../../shared/tui-kit/grouping.ts";
import {
  createPickerState,
  filterChanges,
  reconcilePickerSelection,
  renderPickerRow,
  type PickerState,
} from "./picker-rows.ts";
import { firstChangedLine, requestOpen, type FileOpener } from "./opener.ts";

function configuredKeys(
  keybindings: KeybindingsManager,
  binding: Parameters<KeybindingsManager["getKeys"]>[0],
) {
  return keybindings.getKeys(binding).join("/") || "unbound";
}
import { createViewerState, openDiffViewer, type ViewerState } from "./viewer.ts";

export class FilePicker implements Component {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private store: FileEditStore;
  private state: PickerState;
  private opener: FileOpener | undefined;
  private done: (value: string | null) => void;

  private closed = false;
  private unsubscribe: () => void;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    store: FileEditStore,
    state: PickerState,
    opener: FileOpener | undefined,
    done: (value: string | null) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.store = store;
    this.state = state;
    this.opener = opener;
    this.done = done;
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
    // Before the printable-character branch below, which would otherwise read
    // this as a filter keystroke.
    if (data === "o") {
      const picked = rows[this.state.index];
      if (picked && requestOpen(this.opener, picked.path, firstChangedLine(picked))) {
        this.close(null);
      }
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

  /** Title line, two borders, key legend. */
  private static readonly CHROME = 4;

  render(width: number): string[] {
    const theme = this.theme;
    const rows = this.rows();
    reconcilePickerSelection(this.state, rows);

    const totals = this.store.totals();
    const now = Date.now();
    const height = bodyHeight(this.tui.terminal.rows, FilePicker.CHROME);
    const inner = width - 2;

    // Title outside the box, matching /ps: name on the left, tally on the right.
    const heading = theme.bold(theme.fg("accent", "Files changed"));
    const tally =
      theme.fg("muted", `${totals.files} file${totals.files === 1 ? "" : "s"}  `) +
      theme.fg("toolDiffAdded", `+${totals.added}`) +
      " " +
      theme.fg("toolDiffRemoved", `−${totals.removed}`);
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

    // Unfiltered, the list is grouped by what happened to each file;
    // filtered, the query is already the organising principle, and headers
    // would only push matches off the screen. Either way the cursor stays
    // flat: this is a render-time transform, and handleInput never sees a
    // header row.
    const display: ReadonlyArray<DisplayRow<FileChange>> = this.state.query
      ? rows.map((item, index) => ({ kind: "item", item, index }))
      : groupRows(rows, groupLabel);

    // Keep the cursor inside the window, clamped so short lists start at 0.
    // The window walks DISPLAY rows, so a header can scroll past like any
    // other line, but the selected file is always on screen.
    const cursor = Math.max(0, displayIndexOf(display, this.state.index));
    const start = Math.max(
      0,
      Math.min(cursor - Math.floor(height / 2), display.length - height),
    );
    const visible = display.slice(start, start + height);

    for (let index = 0; index < height; index += 1) {
      const row = visible[index];
      if (row?.kind === "header") {
        lines.push(
          bodyRow(theme, width, sectionRule(theme, inner, row.label, "muted")),
        );
        continue;
      }
      const change = row?.item;
      if (!change) {
        // Empty rows still get drawn, so the panel keeps its shape.
        const placeholder =
          index === 0 && rows.length === 0
            ? `  ${theme.fg("dim", this.state.query ? "no matching files" : "no files changed yet")}`
            : "";
        lines.push(bodyRow(theme, width, placeholder));
        continue;
      }
      const selected = row.index === this.state.index;
      const marker = selected ? theme.fg("accent", "❯ ") : "  ";
      // inner - 2 leaves room for the marker; the selection fill (or bodyRow's
      // own pad) covers the remainder of the row.
      const body = marker + renderPickerRow(change, inner - 2, theme, now);
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
          `  ${configuredKeys(this.keybindings, "tui.select.up")}/${configuredKeys(this.keybindings, "tui.select.down")} select · ${configuredKeys(this.keybindings, "tui.select.confirm")} open diff · o ide · ${configuredKeys(this.keybindings, "tui.select.cancel")} close`,
        ),
      ),
    );

    return lines;
  }
}

/** Returns the chosen path, or null when the user cancelled. */
export async function openFilePicker(
  ctx: ExtensionContext,
  store: FileEditStore,
  state: PickerState,
  opener?: FileOpener,
): Promise<string | null> {
  if (store.size() === 0) {
    ctx.ui.notify("No files changed yet", "info");
    return null;
  }
  return ctx.ui.custom<string | null>(
    (tui, theme, keybindings, done) =>
      new FilePicker(tui, theme, keybindings, store, state, opener, done),
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
  resolve?: (path: string) => string | undefined,
  opener?: FileOpener,
  configureEditor?: (ctx: ExtensionContext) => Promise<void>,
) {
  const pickerState = createPickerState();
  /** An overlay closed to make room for the editor chooser; run it, and put
   * the user back where they were. */
  const configured = async () => {
    if (!opener?.configureRequested) return false;
    opener.configureRequested = false;
    await configureEditor?.(ctx);
    return true;
  };

  while (true) {
    const picked = await openFilePicker(ctx, store, pickerState, opener);
    if (!picked) {
      if (await configured()) continue;
      return;
    }
    pickerState.path = picked;

    let current: string | null = picked;
    while (current) {
      const paths = filterChanges(store.list(), pickerState.query).map(
        (change) => change.path,
      );
      const exit = await openDiffViewer(
        ctx,
        store,
        current,
        viewerState,
        cwd,
        paths,
        resolve,
        opener,
      );
      if (!exit && (await configured())) continue;
      current = exit ? exit.next : null;
      if (current) pickerState.path = current;
    }
  }
}
