import assert from "node:assert/strict";
import { test } from "node:test";
import { Container, visibleWidth } from "@earendil-works/pi-tui";
import type { CommandRecord } from "../domain.ts";
import {
  CollapsedRow,
  EmptyRow,
  delegationContext,
  renderCollapsedRow,
} from "./row.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as never;

function record(overrides: Partial<CommandRecord> = {}): CommandRecord {
  return {
    id: "call-1",
    tool: "bash",
    command: "git status --short",
    cwd: "/repo",
    origin: { kind: "session" },
    startedAt: 0,
    durationMs: 420,
    status: "ok",
    output: "M src/ui/picker.ts\nM src/store.ts",
    outputLines: 2,
    outputBytes: 40,
    ...overrides,
  };
}

test("renders exactly two lines", () => {
  assert.equal(renderCollapsedRow(record(), 80, theme).length, 2);
});

test("the header carries the command and the outcome", () => {
  const [header] = renderCollapsedRow(record(), 80, theme);
  assert.match(header!, /git status --short/);
  assert.match(header!, /420ms/);
  assert.match(header!, /2 lines/);
});

test("the peek is the last output line, not the first", () => {
  const [, peek] = renderCollapsedRow(record(), 80, theme);
  assert.match(peek!, /src\/store\.ts/);
  assert.doesNotMatch(peek!, /picker\.ts/);
});

test("a command that printed nothing is one line", () => {
  const lines = renderCollapsedRow(
    record({ output: "", outputLines: 0 }),
    80,
    theme,
  );
  assert.equal(lines.length, 1);
});

test("a failure shows its exit code", () => {
  const [header] = renderCollapsedRow(
    record({ status: "failed", exitCode: 128, output: "fatal: no repo" }),
    80,
    theme,
  );
  assert.match(header!, /exit 128/);
});

test("a multi-line script shows its first line and how much was folded", () => {
  const [header] = renderCollapsedRow(
    record({ command: "cd /tmp\nmake\nmake install" }),
    80,
    theme,
  );
  assert.match(header!, /cd \/tmp/);
  assert.match(header!, /\+2 more/);
  assert.doesNotMatch(header!, /make/);
});

test("no line is ever wider than the width it was given", () => {
  for (const width of [20, 40, 80, 200]) {
    for (const line of renderCollapsedRow(
      record({ command: "x".repeat(300), output: "y".repeat(300) }),
      width,
      theme,
    )) {
      assert.ok(
        visibleWidth(line) <= width,
        `line of ${visibleWidth(line)} cells at width ${width}`,
      );
    }
  }
});

test("colour codes in the output never reach the row", () => {
  // truncateToWidth adds its own reset codes, so the test is about the
  // output's escapes specifically: the ones that would make a line wider
  // than the cells we claim it occupies.
  const lines = renderCollapsedRow(
    record({ output: "done\r\n\u001b[32mok\u001b[0m", outputLines: 2 }),
    60,
    theme,
  );
  const peek = lines[1]!;
  assert.match(peek, /ok/);
  assert.doesNotMatch(peek, /\[32m/);
  assert.ok(visibleWidth(peek) <= 60);
});

test("the component reuses its record until told otherwise", () => {
  const row = new CollapsedRow();
  assert.deepEqual(row.render(80), []);
  row.update(record(), theme);
  assert.equal(row.render(80).length, 2);
});

test("delegation hides our components from the built-in renderer", () => {
  const ours = delegationContext({ lastComponent: new CollapsedRow() });
  assert.equal(ours.lastComponent, undefined);
  const empty = delegationContext({ lastComponent: new EmptyRow() });
  assert.equal(empty.lastComponent, undefined);

  const theirs = new Container();
  assert.equal(delegationContext({ lastComponent: theirs }).lastComponent, theirs);
});
