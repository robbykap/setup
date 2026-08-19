/**
 * The shell, not the row: row.test.ts proves our lines carry no background
 * fill, but the lines a tool returns are only half the picture. pi wraps them
 * in a colored Box unless the tool sets `renderShell: "self"`
 * (tool-execution.js:50), so a plain row can still end up inside a red block.
 * These tests drive the real ToolExecutionComponent over the tools the
 * extension registers, which is the only place that decision is visible.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import extension from "../../index.ts";

// The component renders through the global theme singleton, not one we hand
// it, and that singleton throws until it has been initialized.
initTheme();

const CWD = "/tmp";

/** The tools as pi sees them: the extension only registers on session_start,
 * and print mode keeps it off the UI. */
function registeredTools() {
  const tools = new Map<string, unknown>();
  let start: ((event: unknown, ctx: unknown) => void) | undefined;
  const pi = {
    on(event: string, handler: (event: unknown, ctx: unknown) => void) {
      if (event === "session_start") start = handler;
    },
    registerTool(tool: { name: string }) {
      tools.set(tool.name, tool);
    },
    registerCommand() {},
    registerShortcut() {},
    events: { on: () => () => {} },
  };
  extension(pi as never);
  start!({}, { mode: "print", cwd: CWD });
  return tools;
}

const tools = registeredTools();

/** A settled failure: args complete, a result that is an error, not partial. */
function renderSettledError(name: "edit" | "write", args: unknown): string[] {
  const component = new ToolExecutionComponent(
    name,
    `call-${name}`,
    args,
    {},
    tools.get(name) as never,
    { requestRender() {} } as never,
    CWD,
  );
  component.setArgsComplete();
  component.updateResult(
    { content: [{ type: "text", text: "Could not edit file: a.ts." }], isError: true },
    false,
  );
  return component.render(60);
}

const ARGS = {
  edit: { path: "a.ts", edits: [{ oldText: "a", newText: "b" }] },
  write: { file_path: "a.ts", content: "hello\n" },
} as const;

for (const name of ["edit", "write"] as const) {
  test(`${name}: a settled collapsed failure has no box around it`, () => {
    // `\x1b[48` is the Box painting toolErrorBg across the full width.
    const lines = renderSettledError(name, ARGS[name]);
    for (const line of lines) {
      assert.ok(!line.includes("\x1b[48"), `${name}: ${JSON.stringify(line)}`);
    }
  });
}

test("edit and write collapse to the same lines", () => {
  // Same rows, same shell: the only difference left is the path each one
  // names, and both name a.ts.
  assert.deepEqual(renderSettledError("write", ARGS.write), renderSettledError("edit", ARGS.edit));
});
