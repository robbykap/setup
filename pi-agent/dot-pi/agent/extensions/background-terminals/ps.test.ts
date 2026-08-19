import assert from "node:assert/strict";
import test from "node:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import { getKeybindings, visibleWidth } from "@earendil-works/pi-tui";
import { openerOf } from "../shared/tui-kit/paint.ts";
import type { OutputView, TerminalSnapshot } from "./src/domain.ts";
import type { TerminalReadModel } from "./src/manager.ts";
import {
  TerminalDashboard,
  TerminalDetailView,
  reconcileDashboardSelection,
  type DashboardSelection,
} from "./src/ui/ps.ts";
import {
  buildOutputLines,
  createOutputLineCache,
  sanitizeText,
} from "./src/ui/output-view.ts";

test("dashboard selection follows its terminal id and falls back by row", () => {
  const selection: DashboardSelection = { id: "bt-7", index: 6 };

  reconcileDashboardSelection(selection, [
    { id: "bt-new" },
    ...Array.from({ length: 8 }, (_, index) => ({ id: `bt-${index + 1}` })),
  ]);
  assert.deepEqual(selection, { id: "bt-7", index: 7 });

  reconcileDashboardSelection(selection, [
    ...Array.from({ length: 6 }, (_, index) => ({ id: `bt-${index + 1}` })),
    { id: "bt-8" },
    { id: "bt-9" },
  ]);
  assert.deepEqual(selection, { id: "bt-9", index: 7 });

  reconcileDashboardSelection(selection, [{ id: "bt-1" }, { id: "bt-2" }]);
  assert.deepEqual(selection, { id: "bt-2", index: 1 });

  reconcileDashboardSelection(selection, []);
  assert.deepEqual(selection, { id: undefined, index: 0 });
});

test("sanitizeText strips ANSI, tabs, and control characters", () => {
  assert.equal(sanitizeText("\u001b[31mred\u001b[0m"), "red");
  assert.equal(sanitizeText("\u001b[12345Cshifted"), "shifted");
  assert.equal(sanitizeText("\u001b]0;window title\u0007output"), "output");
  assert.equal(
    sanitizeText("\u001b]8;;https://example.com\u001b\\link\u001b]8;;\u001b\\"),
    "link",
  );
  assert.equal(sanitizeText("\u001b]0;title\u009coutput"), "output");
  assert.equal(sanitizeText("\u009d0;title\u0007output"), "output");
  assert.equal(sanitizeText("a\u0085b"), "ab");
  assert.equal(sanitizeText("a\tb"), "a  b");
  assert.equal(sanitizeText("a\u0007b\u0000c"), "abc");
});

test("output line cache reuses a version/width key and invalidates either dimension", () => {
  const cache = createOutputLineCache();
  const first = cache.get("first", 1, 80);
  const sameKey = cache.get("different text is intentionally ignored", 1, 80);
  assert.equal(sameKey, first);
  assert.deepEqual(sameKey, ["first"]);

  const newVersion = cache.get("second", 2, 80);
  assert.notEqual(newVersion, first);
  assert.deepEqual(newVersion, ["second"]);

  const newWidth = cache.get("x".repeat(25), 2, 10);
  assert.notEqual(newWidth, newVersion);
  assert.ok(newWidth.length > 1);
});

test("buildOutputLines wraps long lines and keeps only the final CR segment", () => {
  const lines = buildOutputLines("progress 1\rprogress 2\rdone\nnext", 80);
  assert.deepEqual(lines, ["done", "next"]);
  assert.deepEqual(buildOutputLines("progress 1\rprogress 2\r", 80), [
    "progress 2",
  ]);

  const wrapped = buildOutputLines("x".repeat(25), 10);
  assert.ok(wrapped.length > 1);
  assert.equal(wrapped.join(""), "x".repeat(25));
});

test("buildOutputLines drops one trailing empty line from a trailing newline", () => {
  assert.deepEqual(buildOutputLines("a\nb\n", 80), ["a", "b"]);
  assert.deepEqual(buildOutputLines("a\n\n", 80), ["a", ""]);
});

/**
 * A REAL Theme, for the reason subagents/takeover.test.ts spells out: the
 * invariants below are about ANSI escapes (the selection fill), and a stub
 * theme that returns its input would test nothing. The live singleton is not
 * exported, so we build an equivalent.
 */
const FG_COLORS = [
  "accent", "border", "borderAccent", "borderMuted", "success", "error",
  "warning", "muted", "dim", "text", "thinkingText", "searchMatchText",
  "userMessageText", "customMessageText", "customMessageLabel", "toolTitle",
  "toolOutput", "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock",
  "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
  "toolDiffAdded", "toolDiffRemoved", "toolDiffContext", "syntaxComment",
  "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString",
  "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
  "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium",
  "thinkingHigh", "thinkingXhigh", "thinkingMax", "bashMode",
];
const BG_COLORS = [
  "selectedBg", "scrollbarThumb", "searchMatchBg", "userMessageBg",
  "customMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg",
];
const fill = (names: string[], hex: string) =>
  Object.fromEntries(names.map((name) => [name, hex]));

const theme = new Theme(
  fill(FG_COLORS, "#cba6f7") as never,
  fill(BG_COLORS, "#1e1e2e") as never,
  "truecolor",
);

/**
 * A real KeybindingsManager, but cast: pi-tui and pi-coding-agent each expose
 * a KeybindingsManager type, and depending on where the extension is checked
 * from they resolve to two declarations of the same runtime class.
 */
const keybindings = getKeybindings() as never;

function stubTui(rows = 30) {
  return { requestRender() {}, terminal: { rows, columns: 100 } } as never;
}

function outputView(text: string): OutputView {
  return {
    text,
    totalBytes: Buffer.byteLength(text),
    truncatedBytes: 0,
  };
}

function snapshot(
  id: string,
  overrides: Partial<TerminalSnapshot> = {},
): TerminalSnapshot {
  return {
    id,
    command: `echo ${id}`,
    title: `terminal ${id}`,
    cwd: "/repo",
    pid: 1234,
    status: "running",
    createdAt: Date.now() - 5000,
    stdout: outputView(""),
    stderr: outputView(""),
    ...overrides,
  };
}

function readModel(snaps: ReadonlyArray<TerminalSnapshot>): TerminalReadModel {
  return {
    list: () => snaps,
    get: (id) => snaps.find((snap) => snap.id === id),
    size: () => snaps.length,
    subscribe: () => () => {},
    subscribeTo: () => () => {},
    requestKill() {},
    setOnSettled() {},
  };
}

test("the selected dashboard row carries the selection fill, and only it", () => {
  const dashboard = new TerminalDashboard(
    stubTui(),
    theme,
    keybindings,
    readModel([snapshot("bt-1"), snapshot("bt-2"), snapshot("bt-3")]),
    { index: 1 },
    () => {},
  );
  const width = 100;
  const lines = dashboard.render(width);
  dashboard.dispose();

  const opener = openerOf((text) => theme.bg("selectedBg", text));
  assert.ok(opener.length > 0, "the theme produced no selection background");

  const filled = lines.filter((line) => line.includes(opener));
  assert.equal(filled.length, 1, "exactly one row should be highlighted");
  assert.ok(
    filled[0].includes("bt-2"),
    "the highlighted row is the selected one",
  );
  // The marker must sit inside the fill, not in front of it: a ❯ painted
  // before the background opener reads as a row that starts unhighlighted.
  assert.ok(
    filled[0].indexOf(opener) < filled[0].indexOf("❯"),
    "the selection marker sits inside the fill",
  );

  lines.forEach((line, index) => {
    assert.equal(
      visibleWidth(line),
      width,
      `line ${index} is ${visibleWidth(line)} cells, want ${width}\n${JSON.stringify(line)}`,
    );
  });
});

test("the detail view copies the active stream and shows the receipt", async () => {
  const copied: string[] = [];
  const view = new TerminalDetailView(
    stubTui(),
    theme,
    keybindings,
    "bt-1",
    readModel([
      snapshot("bt-1", {
        stdout: outputView("hello\nworld\n"),
        stderr: outputView("boom\n"),
      }),
    ]),
    () => {},
  );
  view.copier = (text) => {
    copied.push(text);
  };

  view.handleInput("y");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(copied, ["hello\nworld\n"]);
  assert.ok(
    view.render(100).some((line) => line.includes("copied stdout")),
    "the copy receipt shows in the legend",
  );

  // `t` switches streams, and `y` follows the stream on screen.
  view.handleInput("t");
  view.handleInput("y");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(copied, ["hello\nworld\n", "boom\n"]);
  assert.ok(
    view.render(100).some((line) => line.includes("copied stderr")),
    "the receipt names the stream that was copied",
  );

  // Any keypress clears the receipt.
  view.handleInput("j");
  assert.ok(
    !view.render(100).some((line) => line.includes("copied")),
    "the receipt is cleared by the next keypress",
  );
  view.dispose();
});

test("the detail view says so when there is nothing to copy", async () => {
  const copied: string[] = [];
  const view = new TerminalDetailView(
    stubTui(),
    theme,
    keybindings,
    "bt-1",
    readModel([snapshot("bt-1")]),
    () => {},
  );
  view.copier = (text) => {
    copied.push(text);
  };

  view.handleInput("y");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(copied, [], "an empty stream never reaches the clipboard");
  assert.ok(view.render(100).some((line) => line.includes("nothing to copy")));
  view.dispose();
});

test("the detail view scrolls with the shared model and clamps at both ends", () => {
  const text = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
  const view = new TerminalDetailView(
    stubTui(),
    theme,
    keybindings,
    "bt-1",
    readModel([snapshot("bt-1", { stdout: outputView(text) })]),
    () => {},
  );
  const width = 100;

  const tail = view.render(width);
  assert.ok(tail.some((line) => line.includes("line 199")), "starts pinned");

  view.handleInput("k"); // one line up
  const up = view.render(width);
  assert.ok(!up.some((line) => line.includes("line 199")));
  assert.ok(up.some((line) => line.includes("line 198")));

  view.handleInput("g"); // top
  const top = view.render(width);
  assert.ok(top.some((line) => line.includes("line 0")), "g reaches the top");
  // The sentinel `g` stores must be clamped by render, so one line down from
  // the top lands on the next row rather than nowhere at all.
  view.handleInput("j");
  const afterTop = view.render(width);
  assert.ok(!afterTop.some((line) => line.includes("line 0")));

  view.handleInput("G"); // bottom
  assert.ok(view.render(width).some((line) => line.includes("line 199")));
  view.dispose();
});
