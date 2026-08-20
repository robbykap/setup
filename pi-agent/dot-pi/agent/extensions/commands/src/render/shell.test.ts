/**
 * pi wraps a tool's transcript lines in a colored Box unless the tool sets
 * `renderShell: "self"` (tool-execution.js:50). These tests drive the real
 * ToolExecutionComponent over the bash tool the extension registers — the
 * only place that decision is visible.
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

function bashComponent() {
  const component = new ToolExecutionComponent(
    "bash",
    "call-bash",
    { command: "npm test" },
    {},
    tools.get("bash") as never,
    { requestRender() {} } as never,
    CWD,
  );
  component.setArgsComplete();
  return component;
}

test("a running bash call has no box around it", () => {
  const component = bashComponent();
  component.updateResult(
    { content: [{ type: "text", text: "compiling…\nlinking…" }], isError: false },
    true, // still partial
  );
  const lines = component.render(60);
  for (const line of lines) {
    assert.ok(!line.includes("\x1b[48"), JSON.stringify(line));
  }
  // The live row: our header with the command, and a peek at the tail.
  const flat = lines.join("\n");
  assert.ok(flat.includes("npm test"));
  assert.ok(flat.includes("linking…"));
});

test("expanded bash gets the box back", () => {
  const component = bashComponent();
  component.setExpanded(true);
  component.updateResult(
    { content: [{ type: "text", text: "ok\n" }], isError: false },
    false,
  );
  const lines = component.render(60);
  assert.ok(lines.some((line) => line.includes("\x1b[48")), JSON.stringify(lines));
});
