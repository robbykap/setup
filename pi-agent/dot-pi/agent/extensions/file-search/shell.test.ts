/**
 * pi wraps a tool's transcript lines in a colored Box unless the tool sets
 * `renderShell: "self"` (tool-execution.js:50). These tests drive the real
 * ToolExecutionComponent over the fd/rg tools the extension registers — the
 * only place that decision is visible.
 */

import { describe, expect, test } from "vitest";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import extension from "./index.ts";
import type { FdToolDetails, RgToolDetails } from "./index.ts";

// The component renders through the global theme singleton, not one we hand
// it, and that singleton throws until it has been initialized.
initTheme();

const CWD = "/tmp";

/** registerTool runs unconditionally at load; the stub only needs to
 * swallow the session_start handler the module also registers. */
function registeredTools() {
  const tools = new Map<string, unknown>();
  const pi = {
    on() {},
    registerTool(tool: { name: string }) {
      tools.set(tool.name, tool);
    },
  };
  extension(pi as never);
  return tools;
}

const tools = registeredTools();

function component(name: string, args: unknown) {
  const c = new ToolExecutionComponent(
    name,
    `call-${name}`,
    args,
    {},
    tools.get(name) as never,
    { requestRender() {} } as never,
    CWD,
  );
  c.setArgsComplete();
  return c;
}

function assertNoBox(lines: string[]) {
  for (const line of lines) expect(line).not.toContain("\x1b[48");
}

describe.each([
  {
    name: "fd",
    args: { pattern: "*.ts" },
    matchDetails: { binarySource: "system", matchCount: 3, truncated: false } satisfies FdToolDetails,
    noMatchDetails: { binarySource: "system", matchCount: 0, truncated: false } satisfies FdToolDetails,
  },
  {
    name: "rg",
    args: { pattern: "TODO" },
    matchDetails: { binarySource: "system", outputLines: 3, truncated: false } satisfies RgToolDetails,
    noMatchDetails: { binarySource: "system", outputLines: 0, truncated: false } satisfies RgToolDetails,
  },
])("$name renderShell: self", ({ name, args, matchDetails, noMatchDetails }) => {
  test("a settled success has no box around it", () => {
    const c = component(name, args);
    c.updateResult(
      { content: [{ type: "text", text: "ok" }], isError: false, details: matchDetails },
      false,
    );
    assertNoBox(c.render(60));
  });

  test("no matches has no box around it", () => {
    const c = component(name, args);
    c.updateResult(
      { content: [{ type: "text", text: "no matches" }], isError: false, details: noMatchDetails },
      false,
    );
    assertNoBox(c.render(60));
  });

  test("a settled failure has no box and carries the error mark", () => {
    const c = component(name, args);
    c.updateResult(
      { content: [{ type: "text", text: `${name} failed: boom` }], isError: true },
      false,
    );
    const lines = c.render(60);
    assertNoBox(lines);
    expect(lines.join("\n")).toContain("✗");
  });
});
