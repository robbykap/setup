/**
 * pi wraps a tool's transcript lines in a colored Box unless the tool sets
 * `renderShell: "self"` (tool-execution.js:50). These tests drive the real
 * ToolExecutionComponent over the `ask_user` tool the extension registers —
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

/** registerTool runs unconditionally at load; the stub only needs to hold it. */
function registeredTools() {
  const tools = new Map<string, unknown>();
  const pi = {
    registerTool(tool: { name: string }) {
      tools.set(tool.name, tool);
    },
  };
  extension(pi as never);
  return tools;
}

const tools = registeredTools();

function askUserComponent() {
  const component = new ToolExecutionComponent(
    "ask_user",
    "call-ask-user",
    { question: "Continue?", options: [{ label: "Yes" }, { label: "No" }] },
    {},
    tools.get("ask_user") as never,
    { requestRender() {} } as never,
    CWD,
  );
  component.setArgsComplete();
  return component;
}

test("a settled success has no box around it", () => {
  const component = askUserComponent();
  component.updateResult(
    { content: [{ type: "text", text: "Yes" }], isError: false },
    false,
  );
  const lines = component.render(60);
  for (const line of lines) {
    assert.ok(!line.includes("\x1b[48"), JSON.stringify(line));
  }
});

test("a settled failure has no box and carries the error mark", () => {
  const component = askUserComponent();
  component.updateResult(
    { content: [{ type: "text", text: "no UI available" }], isError: true },
    false,
  );
  const lines = component.render(60);
  const flat = lines.join("\n");
  for (const line of lines) {
    assert.ok(!line.includes("\x1b[48"), JSON.stringify(line));
  }
  assert.ok(flat.includes("✗"));
});
