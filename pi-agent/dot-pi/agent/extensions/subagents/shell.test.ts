/**
 * pi wraps a tool's transcript lines in a colored Box unless the tool sets
 * `renderShell: "self"` (tool-execution.js:50). subagent_check sets it, then
 * plainResultText re-adds the box's error marker without the box, and caps
 * collapsed output the way pi's default fallback used to. These tests drive
 * the real ToolExecutionComponent over the tool the extension registers,
 * which is the only place any of this is visible.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import extension from "./index.ts";

// The component renders through the global theme singleton, not one we hand
// it, and that singleton throws until it has been initialized.
initTheme();

const CWD = "/tmp";

/** The tools as pi sees them: this extension registers tools at load time,
 * not on session_start, so no session lifecycle event is needed here. */
function registeredTools() {
  const tools = new Map<string, unknown>();
  const pi = {
    on() {},
    registerTool(tool: { name: string }) {
      tools.set(tool.name, tool);
    },
    registerCommand() {},
    registerMessageRenderer() {},
    registerEntryRenderer() {},
    sendMessage() {},
    appendEntry() {},
    getThinkingLevel() {},
    events: { on: () => () => {}, emit: () => {} },
  };
  extension(pi as never);
  return tools;
}

const tools = registeredTools();

function checkComponent(args: unknown) {
  const component = new ToolExecutionComponent(
    "subagent_check",
    "call-subagent-check",
    args,
    {},
    tools.get("subagent_check") as never,
    { requestRender() {} } as never,
    CWD,
  );
  component.setArgsComplete();
  return component;
}

test("a settled collapsed failure has no box and carries the error mark", () => {
  const component = checkComponent({ id: "sub-1" });
  component.updateResult(
    { content: [{ type: "text", text: 'Unknown subagent id "sub-1".' }], isError: true },
    false,
  );
  const lines = component.render(60);
  const flat = lines.join("\n");
  for (const line of lines) {
    assert.ok(!line.includes("\x1b[48"), JSON.stringify(line));
  }
  assert.ok(flat.includes("subagent_check"));
  assert.ok(flat.includes("✗"));
});

test("a long collapsed success is capped and hints at more lines", () => {
  const body = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
  const component = checkComponent({ id: "sub-1" });
  component.updateResult({ content: [{ type: "text", text: body }], isError: false }, false);
  const lines = component.render(60);
  assert.ok(lines.length <= 13, `too many rows: ${lines.length}`);
  const flat = lines.join("\n");
  assert.ok(flat.includes("more lines"));
});
