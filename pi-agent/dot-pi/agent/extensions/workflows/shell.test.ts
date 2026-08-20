/**
 * pi wraps a tool's transcript lines in a colored Box unless the tool sets
 * `renderShell: "self"` (tool-execution.js:50). These tests drive the real
 * ToolExecutionComponent over the `workflow` tool the extension registers —
 * the only place that decision is visible.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import extension from "./index.ts";

// The component renders through the global theme singleton, not one we hand
// it, and that singleton throws until it has been initialized.
initTheme();

const CWD = "/tmp";

/** registerTool runs unconditionally at load, unlike session_start-gated
 * extensions, so the stub only needs to swallow the calls the module makes
 * while registering. */
function registeredTools() {
  const tools = new Map<string, unknown>();
  const pi = {
    on() {},
    registerTool(tool: { name: string }) {
      tools.set(tool.name, tool);
    },
    registerCommand() {},
    events: { on: () => () => {}, emit: () => {} },
  };
  extension(pi as never);
  return tools;
}

const tools = registeredTools();

function workflowComponent() {
  const component = new ToolExecutionComponent(
    "workflow",
    "call-workflow",
    { script: "export const meta = { name: 'w', phases: [] };" },
    {},
    tools.get("workflow") as never,
    { requestRender() {} } as never,
    CWD,
  );
  component.setArgsComplete();
  return component;
}

test("a settled success has no box around it", () => {
  const component = workflowComponent();
  component.updateResult(
    { content: [{ type: "text", text: "done" }], isError: false },
    false,
  );
  const lines = component.render(60);
  for (const line of lines) {
    assert.ok(!line.includes("\x1b[48"), JSON.stringify(line));
  }
});

test("a settled failure has no box and carries the error mark", () => {
  const component = workflowComponent();
  component.updateResult(
    { content: [{ type: "text", text: "workflow script failed to parse" }], isError: true },
    false,
  );
  const lines = component.render(60);
  const flat = lines.join("\n");
  for (const line of lines) {
    assert.ok(!line.includes("\x1b[48"), JSON.stringify(line));
  }
  assert.ok(flat.includes("✗"));
});
