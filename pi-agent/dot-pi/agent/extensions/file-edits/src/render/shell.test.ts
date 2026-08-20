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

function readRow(callId: string, args: unknown) {
  return new ToolExecutionComponent(
    "read",
    callId,
    args,
    {},
    tools.get("read") as never,
    { requestRender() {} } as never,
    CWD,
  );
}

test("read: a settled collapsed call has no box around it", () => {
  const component = readRow("call-read", { path: "a.ts" });
  component.setArgsComplete();
  component.updateResult(
    { content: [{ type: "text", text: "hello\nworld" }], isError: false },
    false,
  );
  const lines = component.render(60);
  for (const line of lines) {
    assert.ok(!line.includes("\x1b[48"), JSON.stringify(line));
  }
  assert.ok(lines.join("\n").includes("a.ts"));
});

test("read: an expanded call delegates to the built-in and still renders", () => {
  const component = readRow("call-read-expanded", { path: "a.ts" });
  component.setArgsComplete();
  component.setExpanded(true);
  component.updateResult(
    { content: [{ type: "text", text: "hello\nworld" }], isError: false },
    false,
  );
  const lines = component.render(60);
  assert.ok(lines.join("\n").includes("hello"));
});

test("read: expanded gets the box back, matching write", () => {
  // "self" took pi's shell Box away so collapsed rows stay plain; expanded
  // restores it the same way write's does.
  const component = readRow("call-read-expanded-box", { path: "a.ts" });
  component.setArgsComplete();
  component.setExpanded(true);
  component.updateResult(
    { content: [{ type: "text", text: "hello\nworld" }], isError: false },
    false,
  );
  const lines = component.render(60);
  assert.ok(
    lines.some((line) => line.includes("\x1b[48")),
    JSON.stringify(lines),
  );
});

test("read: a settled collapsed error has no box and shows the reason", () => {
  const component = readRow("call-read-error", { path: "missing.ts" });
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

test("read: a failure reason with escape codes renders sanitized", () => {
  const component = readRow("call-read-error-ansi", { path: "missing.ts" });
  component.setArgsComplete();
  component.updateResult(
    {
      content: [{ type: "text", text: "\x1b[31mENOENT\x1b[0m: no such file" }],
      isError: true,
    },
    false,
  );
  const lines = component.render(60);
  const joined = lines.join("\n");
  assert.ok(joined.includes("ENOENT: no such file"), joined);
  assert.ok(!joined.includes("\x1b[31m"), joined);
});

test("read: a collapsed call row carries an icon glyph", () => {
  const component = readRow("call-read-icon", { path: "a.ts" });
  component.setArgsComplete();
  component.updateResult(
    { content: [{ type: "text", text: "hello\n" }], isError: false },
    false,
  );
  const lines = component.render(60);
  // The icon is painted with a 24-bit foreground escape (paintIcon).
  assert.ok(
    lines.some((line) => line.includes("\x1b[38;2;")),
    JSON.stringify(lines),
  );
});

test("read: the line count is honest, not off by the split() trailing empty", () => {
  const component = readRow("call-read-count", { path: "a.ts" });
  component.setArgsComplete();
  component.updateResult(
    { content: [{ type: "text", text: "a\nb\nc\n" }], isError: false },
    false,
  );
  const lines = component.render(60);
  assert.ok(lines.join("\n").includes("read 3 lines"), JSON.stringify(lines));
});

test("read: a single line is singular", () => {
  const component = readRow("call-read-singular", { path: "a.ts" });
  component.setArgsComplete();
  component.updateResult(
    { content: [{ type: "text", text: "only line\n" }], isError: false },
    false,
  );
  const lines = component.render(60);
  assert.ok(lines.join("\n").includes("read 1 line"), JSON.stringify(lines));
  assert.ok(!lines.join("\n").includes("read 1 lines"), JSON.stringify(lines));
});

test("read: a truncated result counts from details.truncation, not the text", () => {
  const component = readRow("call-read-truncated", { path: "big.ts" });
  component.setArgsComplete();
  component.updateResult(
    {
      content: [
        {
          type: "text",
          text: "a\nb\n\n[Showing lines 1-2 of 500. Use offset=3 to continue.]",
        },
      ],
      isError: false,
      details: {
        truncation: {
          content: "a\nb",
          truncated: true,
          truncatedBy: "lines",
          totalLines: 500,
          totalBytes: 1000,
          outputLines: 2,
          outputBytes: 3,
          lastLinePartial: false,
          firstLineExceedsLimit: false,
          maxLines: 2,
          maxBytes: 1000,
        },
      },
    },
    false,
  );
  const lines = component.render(60);
  const joined = lines.join("\n");
  assert.ok(joined.includes("read 2 lines of 500 (truncated)"), joined);
});

test("read: a user-limited read counts only the lines read, not the continuation notice", () => {
  const component = readRow("call-read-limited", { path: "big.ts", limit: 5 });
  component.setArgsComplete();
  component.updateResult(
    {
      content: [
        {
          type: "text",
          text: "line1\nline2\nline3\nline4\nline5\n\n[95 more lines in file. Use offset=6 to continue.]",
        },
      ],
      isError: false,
    },
    false,
  );
  const lines = component.render(60);
  const joined = lines.join("\n");
  assert.ok(joined.includes("read 5 lines of 100 (truncated)"), joined);
  assert.ok(!joined.includes("read 7 lines"), joined);
});

test("read: an image result says so and does not crash", () => {
  const component = readRow("call-read-image", { path: "a.png" });
  component.setArgsComplete();
  component.updateResult(
    {
      content: [
        { type: "text", text: "Read image file [image/png]" },
        { type: "image", data: "AAAA", mimeType: "image/png" },
      ],
      isError: false,
    },
    false,
  );
  const lines = component.render(60);
  assert.ok(lines.join("\n").includes("read image"), JSON.stringify(lines));
});
