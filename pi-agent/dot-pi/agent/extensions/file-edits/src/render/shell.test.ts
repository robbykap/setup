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

function toolRow(name: "edit" | "write", args: unknown) {
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
  return component;
}

/** A settled failure: args complete, a result that is an error, not partial. */
function renderSettledError(name: "edit" | "write", args: unknown): string[] {
  const component = toolRow(name, args);
  component.updateResult(
    { content: [{ type: "text", text: "Could not edit file: a.ts." }], isError: true },
    false,
  );
  return component.render(60);
}

/** The same call, settled and successful, with ctrl+o pressed. */
function renderExpandedSuccess(name: "edit" | "write", args: unknown): string[] {
  const component = toolRow(name, args);
  component.setExpanded(true);
  component.updateResult(
    { content: [{ type: "text", text: "Successfully wrote 6 bytes to a.ts" }], isError: false },
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

test("write: expanded gets the box back", () => {
  // "self" took pi's shell Box away so collapsed rows stay plain; expanded is
  // the built-in's own view, which draws flush-left without one.
  const lines = renderExpandedSuccess("write", ARGS.write);
  assert.ok(
    lines.some((line) => line.includes("\x1b[48")),
    JSON.stringify(lines),
  );
});

test("edit and write collapse to the same lines", () => {
  // Same rows, same shell: the only difference left is the path each one
  // names, and both name a.ts.
  assert.deepEqual(renderSettledError("write", ARGS.write), renderSettledError("edit", ARGS.edit));
});

test("read: a settled collapsed call has no box around it", () => {
  const component = new ToolExecutionComponent(
    "read",
    "call-read",
    { path: "a.ts" },
    {},
    tools.get("read") as never,
    { requestRender() {} } as never,
    CWD,
  );
  component.setArgsComplete();
  component.updateResult(
    { content: [{ type: "text", text: "1: hello\n2: world" }], isError: false },
    false,
  );
  const lines = component.render(60);
  for (const line of lines) {
    assert.ok(!line.includes("\x1b[48"), JSON.stringify(line));
  }
  assert.ok(lines.join("\n").includes("a.ts"));
});

test("read: an expanded call delegates to the built-in and still renders", () => {
  const component = new ToolExecutionComponent(
    "read",
    "call-read-expanded",
    { path: "a.ts" },
    {},
    tools.get("read") as never,
    { requestRender() {} } as never,
    CWD,
  );
  component.setArgsComplete();
  component.setExpanded(true);
  component.updateResult(
    { content: [{ type: "text", text: "1: hello\n2: world" }], isError: false },
    false,
  );
  const lines = component.render(60);
  assert.ok(lines.join("\n").includes("hello"));
});

test("read: a settled collapsed error has no box and shows the reason", () => {
  const component = new ToolExecutionComponent(
    "read",
    "call-read-error",
    { path: "missing.ts" },
    {},
    tools.get("read") as never,
    { requestRender() {} } as never,
    CWD,
  );
  component.setArgsComplete();
  component.updateResult(
    { content: [{ type: "text", text: "ENOENT: no such file" }], isError: true },
    false,
  );
  const lines = component.render(60);
  for (const line of lines) {
    assert.ok(!line.includes("\x1b[48"), JSON.stringify(line));
  }
  assert.ok(lines.join("\n").includes("ENOENT"));
});
