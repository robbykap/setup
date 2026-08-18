/**
 * Stage 2 of the tasks UI: the read-only inspector.
 *
 * Fixed height: notes and scroll indicators consume rows inside the viewport so
 * streaming output never changes the overlay's size. Pinned to the bottom
 * (offset 0) until the user scrolls.
 */

import type {
  ExtensionCommandContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { formatSize } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import {
  formatElapsed,
  formatExit,
  isKillable,
  type StreamName,
  type Task,
} from "../domain.ts";
import type { TaskStore } from "../store.ts";
import { createLineCache, oneLine, type LineCache } from "./output-lines.ts";
import type { ThemeLike } from "./dashboard.ts";

const SCROLL_STEP = 6;
/** Repaint ceiling for streaming output, so a chatty process cannot starve input. */
const RENDER_THROTTLE_MS = 50;

export interface DetailState {
  stream: StreamName;
  /** Lines from the bottom. 0 pins to the newest output. */
  scrollOffset: number;
}

export function newDetailState(): DetailState {
  return { stream: "stdout", scrollOffset: 0 };
}

export type DetailKey =
  | "up"
  | "down"
  | "pageUp"
  | "pageDown"
  | "top"
  | "bottom"
  | "toggle"
  | "kill"
  | "send"
  | "yank"
  | "cancel";

export type DetailAction =
  | { type: "render" }
  | { type: "close" }
  | { type: "kill"; id: string }
  | { type: "send"; id: string }
  | { type: "yank"; id: string }
  | { type: "notify"; message: string }
  | { type: "ignore" };

export function handleDetailKey(
  key: DetailKey,
  state: DetailState,
  task: Task,
  viewportHeight: number,
): DetailAction {
  switch (key) {
    case "cancel":
      return { type: "close" };
    case "up":
      state.scrollOffset += SCROLL_STEP;
      return { type: "render" };
    case "down":
      state.scrollOffset = Math.max(0, state.scrollOffset - SCROLL_STEP);
      return { type: "render" };
    case "pageUp":
      state.scrollOffset += viewportHeight;
      return { type: "render" };
    case "pageDown":
      state.scrollOffset = Math.max(0, state.scrollOffset - viewportHeight);
      return { type: "render" };
    case "top":
      // Clamped against the real line count during render.
      state.scrollOffset = Number.MAX_SAFE_INTEGER;
      return { type: "render" };
    case "bottom":
      state.scrollOffset = 0;
      return { type: "render" };
    case "toggle":
      if (task.merged) {
        return {
          type: "notify",
          message: "This task has a single merged output stream.",
        };
      }
      state.stream = state.stream === "stdout" ? "stderr" : "stdout";
      state.scrollOffset = 0;
      return { type: "render" };
    case "kill":
      if (!isKillable(task)) {
        return {
          type: "notify",
          message:
            task.status !== "running"
              ? "That task already finished."
              : "Pi owns that command; only background tasks can be killed here.",
        };
      }
      return { type: "kill", id: task.id };
    case "send":
      return { type: "send", id: task.id };
    case "yank":
      return { type: "yank", id: task.id };
  }
}

export interface DetailRenderOptions {
  width: number;
  height: number;
  theme: ThemeLike;
  now: number;
  lineCache?: LineCache;
}

export function renderDetailLines(
  task: Task,
  state: DetailState,
  { width, height, theme, now, lineCache }: DetailRenderOptions,
): string[] {
  const border = theme.fg("border", "─".repeat(Math.max(1, width)));
  const lines: string[] = [];
  const stream = task.merged ? task.stdout : task[state.stream];

  lines.push(border);
  lines.push(
    truncateToWidth(
      theme.fg("accent", theme.bold(`${task.id} · ${oneLine(task.title)}`)) +
        theme.fg(
          "muted",
          ` · ${task.status} · ${formatElapsed(task, now)} · pid ${task.pid ?? "?"}` +
            (task.status === "running" ? "" : ` · ${formatExit(task)}`),
        ),
      width,
    ),
  );
  lines.push(
    truncateToWidth(
      theme.fg("dim", "$ ") + theme.fg("text", oneLine(task.command)),
      width,
    ),
  );
  lines.push(truncateToWidth(theme.fg("dim", task.cwd), width));

  if (!task.merged) {
    const tab = (name: StreamName, bytes: number) =>
      name === state.stream
        ? theme.fg("accent", theme.bold(`${name} (${formatSize(bytes)})`))
        : theme.fg("dim", `${name} (${formatSize(bytes)})`);
    lines.push(
      truncateToWidth(
        ` ${tab("stdout", task.stdout.totalBytes)}${theme.fg("dim", " | ")}${tab("stderr", task.stderr.totalBytes)}${theme.fg("dim", "  — t to switch")}`,
        width,
      ),
    );
  }
  lines.push(border);

  // Rows already pushed, plus the closing border and the hints row.
  const chrome = lines.length + 2;
  const viewport = Math.max(3, height - chrome);
  const body: string[] = [];

  if (task.errorText) {
    body.push(
      truncateToWidth(theme.fg("error", `error: ${oneLine(task.errorText)}`), width),
    );
  }
  if (stream.droppedBytes > 0) {
    body.push(
      truncateToWidth(
        theme.fg("dim", `first ${formatSize(stream.droppedBytes)} dropped from view`),
        width,
      ),
    );
  }

  const cache = lineCache ?? createLineCache();
  const output = cache.get(stream.text, Math.max(1, width - 2));
  const scrollRows = state.scrollOffset > 0 ? 1 : 0;
  const capacity = Math.max(1, viewport - body.length - scrollRows);
  const maxOffset = Math.max(0, output.length - capacity);
  if (state.scrollOffset > maxOffset) state.scrollOffset = maxOffset;

  const end = output.length - state.scrollOffset;
  const visible = output.slice(Math.max(0, end - capacity), end);
  if (visible.length === 0) {
    body.push(theme.fg("dim", `(no ${task.merged ? "output" : state.stream} yet)`));
  } else {
    for (const line of visible) body.push(truncateToWidth(`  ${line}`, width));
  }

  if (state.scrollOffset > 0) {
    body.push(
      truncateToWidth(
        theme.fg("dim", `... ${state.scrollOffset} lines below · ↓/pgdn`),
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
        " esc back · j/k scroll · g/G top/bottom · t stream · x kill · s send to agent · y yank",
      ),
      width,
    ),
  );
  return lines;
}

export class TaskDetail implements Component {
  // Explicit fields rather than constructor parameter properties: Node strips
  // types without transforming, and Pi loads extensions the same way.
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private id: string;
  private store: TaskStore;
  private actions: {
    notify: (message: string) => void;
    send: (task: Task) => void;
    yank: (task: Task) => void;
  };
  private done: (result: null) => void;

  private state = newDetailState();
  private lineCache = createLineCache();
  private ticker: ReturnType<typeof setInterval>;
  private unsubscribe: () => void;
  private renderTimer?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    id: string,
    store: TaskStore,
    actions: {
      notify: (message: string) => void;
      send: (task: Task) => void;
      yank: (task: Task) => void;
    },
    done: (result: null) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.id = id;
    this.store = store;
    this.actions = actions;
    this.done = done;
    this.ticker = setInterval(() => this.tui.requestRender(), 1000);
    this.unsubscribe = store.subscribe(() => this.scheduleRender());
  }

  private scheduleRender() {
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      if (!this.closed) this.tui.requestRender();
    }, RENDER_THROTTLE_MS);
  }

  private viewportHeight(): number {
    return Math.max(3, (this.tui.terminal.rows || 30) - 12);
  }

  private toKey(data: string): DetailKey | undefined {
    if (
      this.keybindings.matches(data, "tui.select.cancel") ||
      this.keybindings.matches(data, "app.interrupt")
    ) {
      return "cancel";
    }
    if (this.keybindings.matches(data, "tui.editor.cursorUp") || data === "k") return "up";
    if (this.keybindings.matches(data, "tui.editor.cursorDown") || data === "j") return "down";
    if (this.keybindings.matches(data, "tui.editor.pageUp")) return "pageUp";
    if (this.keybindings.matches(data, "tui.editor.pageDown")) return "pageDown";
    if (data === "g") return "top";
    if (data === "G") return "bottom";
    if (data === "t") return "toggle";
    if (data === "x") return "kill";
    if (data === "s") return "send";
    if (data === "y") return "yank";
    return undefined;
  }

  handleInput(data: string): void {
    const task = this.store.get(this.id);
    const key = this.toKey(data);
    if (!key || !task) {
      if (key === "cancel") this.close();
      return;
    }
    const action = handleDetailKey(key, this.state, task, this.viewportHeight());
    switch (action.type) {
      case "close":
        this.close();
        return;
      case "kill":
        this.store.requestKill(action.id);
        return;
      case "send":
        this.actions.send(task);
        this.close();
        return;
      case "yank":
        this.actions.yank(task);
        return;
      case "notify":
        this.actions.notify(action.message);
        return;
      case "render":
        this.tui.requestRender();
        return;
      case "ignore":
        return;
    }
  }

  render(width: number): string[] {
    const task = this.store.get(this.id);
    const height = Math.max(8, (this.tui.terminal.rows || 30) - 4);
    if (!task) {
      return [
        this.theme.fg("border", "─".repeat(width)),
        this.theme.fg("dim", `${this.id} is no longer tracked — esc to go back`),
        this.theme.fg("border", "─".repeat(width)),
      ];
    }
    return renderDetailLines(task, this.state, {
      width,
      height,
      theme: this.theme,
      now: Date.now(),
      lineCache: this.lineCache,
    });
  }

  private close() {
    if (this.closed) return;
    this.closed = true;
    this.cleanup();
    this.done(null);
  }

  private cleanup() {
    clearInterval(this.ticker);
    this.unsubscribe();
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = undefined;
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.cleanup();
  }

  invalidate(): void {}
}

export function openDetail(
  ctx: ExtensionCommandContext,
  store: TaskStore,
  id: string,
  actions: {
    send: (task: Task) => void;
    yank: (task: Task) => void;
  },
): Promise<null> {
  return ctx.ui.custom<null>(
    (tui, theme, keybindings, done) =>
      new TaskDetail(
        tui,
        theme,
        keybindings,
        id,
        store,
        {
          notify: (message) => ctx.ui.notify(message, "info"),
          send: actions.send,
          yank: actions.yank,
        },
        done,
      ),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
    },
  );
}
