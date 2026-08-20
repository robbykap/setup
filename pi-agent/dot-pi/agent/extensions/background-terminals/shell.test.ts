/**
 * pi wraps a tool's transcript lines in a colored Box unless the tool sets
 * `renderShell: "self"` (tool-execution.js:50). bg_status sets it, then
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

/** The tools as pi sees them: the extension only registers on session_start,
 * and print mode keeps it off the UI. Its top-level result-message renderer
 * needs a no-op registerMessageRenderer, unlike a tool-only extension. */
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
    registerMessageRenderer() {},
    sendMessage() {},
    events: { on: () => () => {}, emit: () => {} },
  };
  extension(pi as never);
  start!({}, { mode: "print", cwd: CWD, hasUI: false });
  return tools;
}

const tools = registeredTools();

function statusComponent(args: unknown) {
  const component = new ToolExecutionComponent(
    "bg_status",
    "call-bg-status",
    args,
    {},
    tools.get("bg_status") as never,
    { requestRender() {} } as never,
    CWD,
  );
  component.setArgsComplete();
  return component;
}

test("a settled collapsed failure has no box and carries the error mark", () => {
  const component = statusComponent({ id: "term-1" });
  component.updateResult(
    { content: [{ type: "text", text: 'Unknown terminal id "term-1".' }], isError: true },
    false,
  );
  const lines = component.render(60);
  const flat = lines.join("\n");
  for (const line of lines) {
    assert.ok(!line.includes("\x1b[48"), JSON.stringify(line));
  }
  assert.ok(flat.includes("bg_status"));
  assert.ok(flat.includes("✗"));
});

test("a long collapsed success is capped and hints at more lines", () => {
  const body = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
  const component = statusComponent({ id: "term-1" });
  component.updateResult({ content: [{ type: "text", text: body }], isError: false }, false);
  const lines = component.render(60);
  assert.ok(lines.length <= 13, `too many rows: ${lines.length}`);
  const flat = lines.join("\n");
  assert.ok(flat.includes("more lines"));
});
