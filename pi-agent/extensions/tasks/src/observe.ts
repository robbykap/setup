/**
 * Mirrors shell work that Pi runs itself into the task store.
 *
 * Two sources:
 * - The agent's `bash` tool, observed through tool_execution_* events. Updates
 *   carry the full accumulated output, so they replace the buffer; appending
 *   would duplicate everything seen so far.
 * - The user's `!command`, captured by wrapping the BashOperations Pi uses to
 *   execute it. There is no "user bash finished" event, so the wrapper is the
 *   only place the outcome is observable.
 *
 * Neither kind is killable here: Pi owns those processes.
 */

import type { TaskStore } from "./store.ts";

export interface ToolStartLike {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolUpdateLike {
  toolCallId: string;
  partialResult: unknown;
}

export interface ToolEndLike {
  toolCallId: string;
  result: unknown;
  isError: boolean;
}

/** Structural subset of Pi's BashOperations. */
export interface BashOperationsLike {
  exec(
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void;
      signal?: AbortSignal;
      timeout?: number;
      env?: NodeJS.ProcessEnv;
    },
  ): Promise<{ exitCode: number | null }>;
}

export interface Observer {
  toolStart(event: ToolStartLike, cwd: string): void;
  toolUpdate(event: ToolUpdateLike): void;
  toolEnd(event: ToolEndLike): void;
  userBash(
    event: { command: string; cwd: string },
    operations: BashOperationsLike,
  ): BashOperationsLike;
  reset(): void;
}

/** Pull the text out of a tool result shaped { content: [{ type, text }] }. */
function resultText(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const item of content) {
    if (
      typeof item === "object" &&
      item !== null &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string"
    ) {
      parts.push((item as { text: string }).text);
    }
  }
  return parts.length > 0 ? parts.join("") : undefined;
}

function commandOf(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const command = (args as { command?: unknown }).command;
  return typeof command === "string" ? command : undefined;
}

export function createObserver(store: TaskStore): Observer {
  /** Pi's toolCallId to our task id. Entries are removed on settle so a
   * duplicate or late end event cannot touch a finished task. */
  const active = new Map<string, string>();

  return {
    toolStart(event, cwd) {
      if (event.toolName !== "bash") return;
      const command = commandOf(event.args);
      if (!command) return;
      const task = store.add({ kind: "foreground", command, cwd });
      active.set(event.toolCallId, task.id);
    },
    toolUpdate(event) {
      const id = active.get(event.toolCallId);
      if (!id) return;
      const text = resultText(event.partialResult);
      if (text !== undefined) store.replaceOutput(id, text);
    },
    toolEnd(event) {
      const id = active.get(event.toolCallId);
      if (!id) return;
      active.delete(event.toolCallId);
      const text = resultText(event.result);
      if (text !== undefined) store.replaceOutput(id, text);
      store.settle(id, {
        status: event.isError ? "failed" : "done",
        exitCode: event.isError ? undefined : 0,
      });
    },
    userBash(event, operations) {
      const task = store.add({
        kind: "user",
        command: event.command,
        cwd: event.cwd,
      });
      return {
        async exec(command, cwd, options) {
          try {
            const result = await operations.exec(command, cwd, {
              ...options,
              onData: (data) => {
                store.appendOutput(task.id, "stdout", data);
                options.onData(data);
              },
            });
            store.settle(task.id, {
              status: result.exitCode === 0 ? "done" : "failed",
              exitCode: result.exitCode ?? undefined,
            });
            return result;
          } catch (error) {
            store.settle(task.id, {
              status: "failed",
              errorText: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
      };
    },
    reset() {
      active.clear();
    },
  };
}
