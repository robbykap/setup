/**
 * tasks — a dashboard for every shell command in the session.
 *
 * Background tasks (bg_start) are spawned and owned here. The agent's own bash
 * calls and the user's `!` commands are mirrored in read-only. `/tasks` or
 * alt+t opens a two-stage overlay: the list, then a read-only inspector.
 *
 * This file is wiring only. Behaviour lives in src/.
 */

import * as path from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import {
  copyToClipboard,
  createLocalBashOperations,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { toTitle, type Task } from "./src/domain.ts";
import { createObserver } from "./src/observe.ts";
import {
  BG_ID_PARAMETER_DESCRIPTION,
  BG_KILL_TOOL_DESCRIPTION,
  BG_LIST_TOOL_DESCRIPTION,
  BG_START_PARAMETER_DESCRIPTIONS,
  BG_START_PROMPT_SNIPPET,
  BG_START_TOOL_DESCRIPTION,
  BG_STATUS_TOOL_DESCRIPTION,
  buildKillReport,
  buildSendToAgentMessage,
  buildSettledMessage,
  buildStartResult,
  buildStatusResult,
  describeTask,
} from "./src/prompt.ts";
import { createSpawner } from "./src/spawn.ts";
import { createTaskStore } from "./src/store.ts";
import { newDashboardState, openDashboard } from "./src/ui/dashboard.ts";
import { openDetail } from "./src/ui/detail.ts";

const WIDGET_KEY = "tasks";

export default function (pi: ExtensionAPI) {
  const store = createTaskStore();
  const spawner = createSpawner(store);
  const observer = createObserver(store);
  const dashboardState = newDashboardState();

  let ui: ExtensionUIContext | undefined;
  let sessionContext: ExtensionContext | undefined;
  /** Settled background tasks waiting to be reported to the agent. */
  const pending = new Map<string, Task>();

  // --- Agent notifications ------------------------------------------------

  const deliver = (task: Task) => {
    try {
      pi.sendMessage(
        {
          customType: "task-result",
          content: buildSettledMessage(task),
          display: true,
          details: { id: task.id, title: task.title, status: task.status },
        },
        // followUp waits for the current tool batch; triggerTurn wakes the
        // agent only if it is idle. Either way, exactly one delivery.
        { deliverAs: "followUp", triggerTurn: true },
      );
      return true;
    } catch (error) {
      console.error("tasks: failed to deliver result", error);
      return false;
    }
  };

  const flush = () => {
    for (const [id, task] of [...pending]) {
      pending.delete(id);
      if (!deliver(task)) pending.set(id, task);
    }
  };

  store.onSettled((task) => {
    // Only tasks this extension owns are news to the agent: it already sees
    // its own bash results, and user commands are the user's business.
    if (task.kind !== "background") return;
    pending.set(task.id, task);
    if (sessionContext?.isIdle()) flush();
  });

  // --- Widget -------------------------------------------------------------

  let widgetCount = -1;
  const updateWidget = () => {
    if (!ui) return;
    const running = store.runningBackgroundCount();
    if (running === widgetCount) return;
    widgetCount = running;
    try {
      if (running === 0) {
        ui.setWidget(WIDGET_KEY, undefined);
        return;
      }
      ui.setWidget(WIDGET_KEY, (_tui, theme) => {
        const line =
          theme.fg("warning", "■ ") +
          theme.fg(
            "text",
            `${running} background task${running === 1 ? "" : "s"} running`,
          ) +
          theme.fg("dim", " · ") +
          theme.fg("accent", "/tasks") +
          theme.fg("dim", " or alt+t to view");
        return { render: () => [line], invalidate: () => {} };
      });
    } catch {
      // UI may be unavailable (print/RPC modes or teardown).
    }
  };
  store.subscribe(updateWidget);

  // --- Session lifecycle --------------------------------------------------

  pi.on("session_start", (_event, ctx) => {
    sessionContext = ctx;
    if (ctx.hasUI) ui = ctx.ui;
  });

  pi.on("agent_settled", flush);

  pi.on("session_shutdown", async () => {
    sessionContext = undefined;
    pending.clear();
    observer.reset();
    try {
      ui?.setWidget(WIDGET_KEY, undefined);
    } catch {
      // Already gone.
    }
    ui = undefined;
    widgetCount = -1;
    await spawner.killAll();
    store.clear();
  });

  // --- Mirroring pi's own shell work --------------------------------------

  pi.on("tool_execution_start", (event, ctx) => {
    observer.toolStart(event, ctx.cwd);
  });
  pi.on("tool_execution_update", (event) => {
    observer.toolUpdate(event);
  });
  pi.on("tool_execution_end", (event) => {
    observer.toolEnd(event);
  });
  pi.on("user_bash", (event) => ({
    operations: observer.userBash(event, createLocalBashOperations()),
  }));

  // --- Tools --------------------------------------------------------------

  pi.registerTool({
    name: "bg_start",
    label: "Start Background Task",
    description: BG_START_TOOL_DESCRIPTION,
    promptSnippet: BG_START_PROMPT_SNIPPET,
    parameters: Type.Object({
      command: Type.String({ description: BG_START_PARAMETER_DESCRIPTIONS.command }),
      title: Type.String({ description: BG_START_PARAMETER_DESCRIPTIONS.title }),
      working_dir: Type.Optional(
        Type.String({ description: BG_START_PARAMETER_DESCRIPTIONS.workingDir }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const command = params.command.trim();
      if (!command) throw new Error("command must not be empty.");
      const cwd = path.resolve(ctx.cwd, params.working_dir ?? ".");
      const task = spawner.start({ command, cwd, title: toTitle(params.title) });
      return {
        content: [{ type: "text" as const, text: buildStartResult(task) }],
        details: { id: task.id, title: task.title, cwd, pid: task.pid },
      };
    },
  });

  pi.registerTool({
    name: "bg_status",
    label: "Check Background Task",
    description: BG_STATUS_TOOL_DESCRIPTION,
    parameters: Type.Object({
      id: Type.String({ description: BG_ID_PARAMETER_DESCRIPTION }),
    }),
    async execute(_toolCallId, params) {
      const task = store.get(params.id);
      if (!task) {
        const known = store.list().map((entry) => entry.id).join(", ") || "none";
        throw new Error(`Unknown task id "${params.id}". Known: ${known}.`);
      }
      // This result carries the settlement, so the queued follow-up would be a
      // duplicate.
      if (task.status !== "running") pending.delete(task.id);
      return {
        content: [{ type: "text" as const, text: buildStatusResult(task) }],
        details: { id: task.id, status: task.status, exitCode: task.exitCode },
      };
    },
  });

  pi.registerTool({
    name: "bg_list",
    label: "List Background Tasks",
    description: BG_LIST_TOOL_DESCRIPTION,
    parameters: Type.Object({}),
    async execute() {
      const tasks = store.list().filter((task) => task.kind === "background");
      const text =
        tasks.length === 0
          ? "No background tasks."
          : tasks.map((task) => describeTask(task)).join("\n");
      return {
        content: [{ type: "text" as const, text }],
        details: { count: tasks.length },
      };
    },
  });

  pi.registerTool({
    name: "bg_kill",
    label: "Kill Background Tasks",
    description: BG_KILL_TOOL_DESCRIPTION,
    parameters: Type.Object({
      ids: Type.Array(Type.String(), { description: BG_ID_PARAMETER_DESCRIPTION }),
    }),
    async execute(_toolCallId, params) {
      const ids = [...new Set(params.ids)];
      if (ids.length === 0) throw new Error("Provide at least one task id.");
      const unknown = ids.filter((id) => !store.get(id));
      if (unknown.length > 0) {
        throw new Error(`Unknown task id(s): ${unknown.join(", ")}.`);
      }
      await Promise.all(ids.map((id) => spawner.kill(id)));
      const tasks = ids
        .map((id) => store.get(id))
        .filter((task): task is Task => !!task);
      for (const id of ids) pending.delete(id);
      return {
        content: [{ type: "text" as const, text: buildKillReport(tasks) }],
        details: { ids },
      };
    },
  });

  // --- Command and shortcut ----------------------------------------------

  const openDashboardLoop = async (ctx: ExtensionCommandContext) => {
    if (ctx.mode !== "tui") {
      const tasks = store.list();
      if (ctx.hasUI) {
        ctx.ui.notify(
          tasks.length === 0
            ? "No tasks yet."
            : tasks.map((task) => describeTask(task)).join("\n"),
          "info",
        );
      }
      return;
    }
    if (store.size() === 0) {
      ctx.ui.notify("No tasks yet. Shell commands appear here as they run.", "info");
      return;
    }

    while (true) {
      const picked = await openDashboard(ctx, store, dashboardState);
      if (!picked) return;
      if (!store.get(picked)) continue;
      await openDetail(ctx, store, picked, {
        send: (task) => {
          pi.sendMessage(
            {
              customType: "task-attention",
              content: buildSendToAgentMessage(task),
              display: true,
              details: { id: task.id, status: task.status },
            },
            { deliverAs: "followUp", triggerTurn: true },
          );
          ctx.ui.notify(`Sent ${task.id} to the agent.`, "info");
        },
        yank: (task) => {
          const text = task.merged
            ? task.stdout.text
            : task.stdout.text + task.stderr.text;
          void copyToClipboard(text);
          ctx.ui.notify(`Copied ${task.id} output.`, "info");
        },
      });
    }
  };

  pi.registerCommand("tasks", {
    description: "Browse background tasks and shell commands",
    handler: async (_args, ctx) => openDashboardLoop(ctx),
  });

  pi.registerShortcut("alt+t", {
    description: "Open the task dashboard",
    handler: async (ctx) => {
      // Shortcuts receive the plain session context; the dashboard needs the
      // command context's mode/ui guarantees.
      if (!("mode" in ctx)) return;
      await openDashboardLoop(ctx as ExtensionCommandContext);
    },
  });
}
