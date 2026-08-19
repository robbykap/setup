import assert from "node:assert/strict";
import test from "node:test";
import { Theme } from "@earendil-works/pi-coding-agent";
import { getKeybindings, visibleWidth } from "@earendil-works/pi-tui";
import { openerOf } from "../shared/tui-kit/paint.ts";
import type { SubagentSnapshot, TranscriptItem } from "./src/domain.ts";
import type { SubagentReadModel } from "./src/manager.ts";
import {
  SubagentDashboard,
  reconcileDashboardSelection,
  type DashboardSelection,
} from "./src/ui/takeover.ts";
import { buildTranscriptLines } from "./src/ui/transcript.ts";

/**
 * A REAL Theme, for the reason commands/src/ui/picker.test.ts spells out: the
 * invariants here are about ANSI escapes (the selection fill, the rules'
 * colours) and a stub theme that returns its input would test nothing. The
 * live singleton is not exported, so we build an equivalent.
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

function snapshot(
  id: string,
  overrides: Partial<SubagentSnapshot> = {},
): SubagentSnapshot {
  return {
    id,
    origin: "model",
    backend: "pi",
    title: `task ${id}`,
    prompt: "do the thing",
    cwd: "/repo",
    status: "running",
    createdAt: Date.now() - 5000,
    meta: { backend: "pi", modelLabel: "pi/opus" },
    usage: {},
    transcript: [],
    liveTools: [],
    queued: [],
    finalText: "",
    turns: 0,
    ...overrides,
  };
}

function readModel(snaps: ReadonlyArray<SubagentSnapshot>): SubagentReadModel {
  return {
    list: () => snaps,
    get: (id) => snaps.find((snap) => snap.id === id),
    size: () => snaps.length,
    subscribe: () => () => {},
    subscribeTo: () => () => {},
    requestSend() {},
    requestAbort() {},
    setOnSettled() {},
  };
}

function transcriptOf(items: ReadonlyArray<TranscriptItem>, width = 80) {
  const snap = snapshot("sa-1", { transcript: items });
  return buildTranscriptLines(snap, width, theme);
}

function assertWithin(lines: string[], width: number, label: string) {
  lines.forEach((line, index) => {
    assert.ok(
      visibleWidth(line) <= width,
      `${label}: line ${index} is ${visibleWidth(line)} cells, want <= ${width}\n${JSON.stringify(line)}`,
    );
  });
}

test("dashboard selection follows its subagent id and falls back by row", () => {
  const selection: DashboardSelection = { id: "sa-7", index: 6 };

  reconcileDashboardSelection(selection, [
    { id: "sa-new" },
    ...Array.from({ length: 8 }, (_, index) => ({ id: `sa-${index + 1}` })),
  ]);
  assert.deepEqual(selection, { id: "sa-7", index: 7 });

  reconcileDashboardSelection(selection, [
    ...Array.from({ length: 6 }, (_, index) => ({ id: `sa-${index + 1}` })),
    { id: "sa-8" },
    { id: "sa-9" },
  ]);
  assert.deepEqual(selection, { id: "sa-9", index: 7 });

  reconcileDashboardSelection(selection, [{ id: "sa-1" }, { id: "sa-2" }]);
  assert.deepEqual(selection, { id: "sa-2", index: 1 });

  reconcileDashboardSelection(selection, []);
  assert.deepEqual(selection, { id: undefined, index: 0 });
});

test("a shell tool call opens its block with a $-labelled rule", () => {
  const lines = transcriptOf([
    {
      kind: "assistant",
      parts: [
        {
          type: "toolCall",
          toolId: "t1",
          name: "bash",
          argsPreview: '{"command":"npm run check\\nnpm test"}',
        },
      ],
    },
  ]);

  const ruled = lines.filter((line) => line.includes("╌"));
  assert.equal(ruled.length, 1, "one rule opens the block");
  assert.match(ruled[0], /\$ npm run check/);
  // Only the first line of a multi-line command labels the rule.
  assert.ok(!ruled[0].includes("npm test"), "the label stops at line one");
  assertWithin(lines, 80, "bash tool call");
});

test("a non-shell tool call opens with a rule carrying the tool name", () => {
  const lines = transcriptOf([
    {
      kind: "assistant",
      parts: [
        {
          type: "toolCall",
          toolId: "t1",
          name: "read_file",
          argsPreview: '{"path":"src/main.ts"}',
        },
      ],
    },
  ]);

  const ruled = lines.filter((line) => line.includes("╌"));
  assert.equal(ruled.length, 1);
  assert.match(ruled[0], /read_file/);
  assert.ok(!ruled[0].includes("$"), "a non-shell tool gets no command label");
  // The arguments survive as the block's body.
  assert.ok(
    lines.some((line) => line.includes("src/main.ts")),
    "the args preview still renders",
  );
  assertWithin(lines, 80, "non-shell tool call");
});

test("a running shell tool is framed like a settled one", () => {
  const snap = snapshot("sa-1", {
    liveTools: [
      {
        toolId: "t1",
        name: "bash",
        argsPreview: '{"command":"npm test"}',
        outputPreview: "ok 1 - thing",
      },
    ],
  });
  const lines = buildTranscriptLines(snap, 80, theme);

  const ruled = lines.filter((line) => line.includes("╌"));
  assert.equal(ruled.length, 1, "the running call opens a block too");
  assert.match(ruled[0], /\$ npm test/);
  assert.ok(
    lines.some((line) => line.includes("running")),
    "the running marker stays visible",
  );
  assert.ok(
    lines.some((line) => line.includes("ok 1 - thing")),
    "the output preview still renders",
  );
  assertWithin(lines, 80, "live shell tool");
});

test("a shell call with no command still gets the accent $ rule", () => {
  const accentDollar = theme.fg("accent", " $ ");
  const withPreview = transcriptOf([
    {
      kind: "assistant",
      parts: [{ type: "toolCall", toolId: "t1", name: "bash" }],
    },
  ]);

  const ruled = withPreview.filter((line) => line.includes("╌"));
  assert.equal(ruled.length, 1);
  assert.ok(
    ruled[0].includes(accentDollar),
    `a preview-less shell call keeps the accent $ label\n${JSON.stringify(ruled[0])}`,
  );
  assert.ok(!ruled[0].includes("bash"), "and not the muted tool-name rule");
});

test("a long shell command cannot push the rule past the width", () => {
  const lines = transcriptOf(
    [
      {
        kind: "assistant",
        parts: [
          {
            type: "toolCall",
            toolId: "t1",
            name: "bash",
            argsPreview: `{"command":"${"echo hello ".repeat(40)}"}`,
          },
        ],
      },
    ],
    60,
  );
  assertWithin(lines, 60, "long command");
});

test("the selected dashboard row carries the selection fill, and only it", () => {
  const dashboard = new SubagentDashboard(
    stubTui(),
    theme,
    keybindings,
    readModel([snapshot("sa-1"), snapshot("sa-2"), snapshot("sa-3")]),
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
    filled[0].includes("sa-2"),
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
