/**
 * Stage 1 of the tasks UI: the list.
 *
 * State and rendering are pure functions over a task array so they can be
 * tested without a terminal; TaskDashboard is only the TUI shell that feeds
 * them keyboard input and a store subscription.
 */

import type {
  ExtensionCommandContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  filterTasks,
  formatElapsed,
  formatExit,
  isKillable,
  nextFilter,
  type FilterMode,
  type Task,
} from "../domain.ts";
import type { TaskStore } from "../store.ts";
import { oneLine } from "./output-lines.ts";

/** Minimal shape of Pi's Theme, so tests can pass a plain object. */
export interface ThemeLike {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

export interface DashboardState {
  index: number;
  id?: string;
  filter: FilterMode;
}

export function newDashboardState(): DashboardState {
  return { index: 0, filter: "all" };
}

export type DashboardKey = "up" | "down" | "confirm" | "cancel" | "kill" | "filter";

export type DashboardAction =
  | { type: "render" }
  | { type: "close" }
  | { type: "inspect"; id: string }
  | { type: "kill"; id: string }
  | { type: "notify"; message: string }
  | { type: "ignore" };

/** Keep the cursor on the same task as the list changes underneath it. */
export function reconcileSelection(
  state: DashboardState,
  tasks: readonly Task[],
): void {
  const byId = state.id ? tasks.findIndex((task) => task.id === state.id) : -1;
  state.index =
    byId >= 0
      ? byId
      : Math.min(Math.max(0, state.index), Math.max(0, tasks.length - 1));
  state.id = tasks[state.index]?.id;
}

export function handleDashboardKey(
  key: DashboardKey,
  state: DashboardState,
  allTasks: readonly Task[],
): DashboardAction {
  const tasks = filterTasks(allTasks, state.filter);
  reconcileSelection(state, tasks);
  const selected = tasks[state.index];

  switch (key) {
    case "cancel":
      return { type: "close" };
    case "up":
    case "down": {
      if (tasks.length === 0) return { type: "ignore" };
      const delta = key === "up" ? -1 : 1;
      state.index = (state.index + delta + tasks.length) % tasks.length;
      state.id = tasks[state.index]?.id;
      return { type: "render" };
    }
    case "filter":
      state.filter = nextFilter(state.filter);
      reconcileSelection(state, filterTasks(allTasks, state.filter));
      return { type: "render" };
    case "confirm":
      return selected ? { type: "inspect", id: selected.id } : { type: "ignore" };
    case "kill":
      if (!selected) return { type: "ignore" };
      if (!isKillable(selected)) {
        return {
          type: "notify",
          message:
            selected.status !== "running"
              ? "That task already finished."
              : "Pi owns that command; only background tasks can be killed here.",
        };
      }
      return { type: "kill", id: selected.id };
  }
}

function statusGlyph(task: Task, theme: ThemeLike) {
  switch (task.status) {
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

function kindGlyph(task: Task, theme: ThemeLike) {
  switch (task.kind) {
    case "background":
      return theme.fg("accent", "&");
    case "foreground":
      return theme.fg("dim", "$");
    case "user":
      return theme.fg("dim", "!");
  }
}

function pad(text: string, width: number): string {
  const truncated = truncateToWidth(text, width);
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

export interface RenderOptions {
  width: number;
  height: number;
  theme: ThemeLike;
  now: number;
}

export function renderDashboardLines(
  allTasks: readonly Task[],
  state: DashboardState,
  { width, height, theme, now }: RenderOptions,
): string[] {
  const tasks = filterTasks(allTasks, state.filter);
  reconcileSelection(state, tasks);

  const running = allTasks.filter((task) => task.status === "running").length;
  const lines: string[] = [];

  const left = theme.fg("accent", theme.bold("Tasks"));
  const right = theme.fg(
    "muted",
    `${running} running · ${tasks.length} shown · filter: ${state.filter}`,
  );
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right) - 2);
  lines.push(truncateToWidth(` ${left}${" ".repeat(gap)}${right} `, width));
  lines.push(theme.fg("border", "─".repeat(width)));

  // Two header rows and two footer rows are added around the body, so the
  // rendered block is exactly `height` rows tall.
  const bodyHeight = Math.max(3, height - 4);
  for (const row of renderRows(tasks, state, { width, height: bodyHeight, theme, now })) {
    lines.push(pad(row, width));
  }

  lines.push(theme.fg("border", "─".repeat(width)));
  lines.push(
    truncateToWidth(
      theme.fg(
        "dim",
        " j/k select · enter inspect · x kill · f filter · esc close",
      ),
      width,
    ),
  );
  return lines;
}

function renderRows(
  tasks: readonly Task[],
  state: DashboardState,
  { width, height, theme, now }: RenderOptions,
): string[] {
  if (tasks.length === 0) {
    const rows = [theme.fg("dim", "  No tasks match this filter (f to change)")];
    while (rows.length < height) rows.push("");
    return rows;
  }

  let start = 0;
  if (tasks.length > height) {
    start = Math.min(
      Math.max(0, state.index - Math.floor(height / 2)),
      tasks.length - height,
    );
  }
  const visible = tasks.slice(start, start + height);
  const rows: string[] = [];

  for (let i = 0; i < visible.length; i++) {
    const task = visible[i];
    const selected = start + i === state.index;
    const marker = selected ? theme.fg("accent", "❯") : " ";
    const title = selected
      ? theme.fg("accent", oneLine(task.title))
      : theme.fg("text", oneLine(task.title));
    const left = ` ${marker} ${statusGlyph(task, theme)} ${kindGlyph(task, theme)} ${title} ${theme.fg("dim", task.id)}`;

    const dot = theme.fg("dim", " · ");
    const right =
      [
        theme.fg("muted", task.pid ? `pid ${task.pid}` : "no pid"),
        theme.fg("muted", formatElapsed(task, now)),
        task.status === "running"
          ? theme.fg("warning", "running")
          : theme.fg("muted", formatExit(task)),
      ].join(dot) + " ";

    const rightWidth = visibleWidth(right);
    const leftText = truncateToWidth(left, Math.max(0, width - rightWidth - 2));
    const spacer = Math.max(2, width - visibleWidth(leftText) - rightWidth);
    rows.push(truncateToWidth(leftText + " ".repeat(spacer) + right, width));
  }

  if (start > 0) {
    rows[0] = truncateToWidth(theme.fg("dim", `   ... ${start} more above`), width);
  }
  if (start + height < tasks.length) {
    rows[rows.length - 1] = truncateToWidth(
      theme.fg("dim", `   ... ${tasks.length - start - height} more below`),
      width,
    );
  }
  while (rows.length < height) rows.push("");
  return rows;
}

/** Result of the dashboard overlay: the task to inspect, or null to close. */
export type DashboardResult = string | null;

export class TaskDashboard implements Component {
  // Explicit fields rather than constructor parameter properties: Node strips
  // types without transforming, and Pi loads extensions the same way.
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private store: TaskStore;
  private state: DashboardState;
  private notify: (message: string) => void;
  private done: (result: DashboardResult) => void;
  private ticker: ReturnType<typeof setInterval>;
  private unsubscribe: () => void;
  private closed = false;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    store: TaskStore,
    state: DashboardState,
    notify: (message: string) => void,
    done: (result: DashboardResult) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.store = store;
    this.state = state;
    this.notify = notify;
    this.done = done;
    this.ticker = setInterval(() => this.tui.requestRender(), 1000);
    this.unsubscribe = store.subscribe(() => this.tui.requestRender());
  }

  private toKey(data: string): DashboardKey | undefined {
    if (this.keybindings.matches(data, "tui.select.cancel")) return "cancel";
    if (this.keybindings.matches(data, "tui.select.confirm")) return "confirm";
    if (this.keybindings.matches(data, "tui.select.up") || data === "k") return "up";
    if (this.keybindings.matches(data, "tui.select.down") || data === "j") return "down";
    if (data === "x") return "kill";
    if (data === "f") return "filter";
    return undefined;
  }

  handleInput(data: string): void {
    const key = this.toKey(data);
    if (!key) return;
    const action = handleDashboardKey(key, this.state, this.store.list());
    switch (action.type) {
      case "close":
        this.close(null);
        return;
      case "inspect":
        this.close(action.id);
        return;
      case "kill":
        this.store.requestKill(action.id);
        return;
      case "notify":
        this.notify(action.message);
        return;
      case "render":
        this.tui.requestRender();
        return;
      case "ignore":
        return;
    }
  }

  render(width: number): string[] {
    const rows = this.tui.terminal.rows || 30;
    return renderDashboardLines(this.store.list(), this.state, {
      width,
      // Leave Pi's own footer row visible beneath the overlay.
      height: Math.max(8, rows - 4),
      theme: this.theme,
      now: Date.now(),
    });
  }

  private close(result: DashboardResult) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.ticker);
    this.unsubscribe();
    this.done(result);
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.ticker);
    this.unsubscribe();
  }

  invalidate(): void {}
}

/** Open the dashboard overlay and resolve with the task to inspect. */
export function openDashboard(
  ctx: ExtensionCommandContext,
  store: TaskStore,
  state: DashboardState,
): Promise<DashboardResult> {
  return ctx.ui.custom<DashboardResult>(
    (tui, theme, keybindings, done) =>
      new TaskDashboard(
        tui,
        theme,
        keybindings,
        store,
        state,
        (message) => ctx.ui.notify(message, "info"),
        done,
      ),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
    },
  );
}
