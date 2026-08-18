# File-edit TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse file-editing tool calls to a two-line Catppuccin Mocha row with a file-type icon, add a picker and a stacked/split diff viewer, and move every extension's status onto one themed line above the prompt.

**Architecture:** A new `file-edits` extension overrides the built-in `edit` and `write` tools — delegating `execute` to the SDK's own implementation and replacing only the renderers — and feeds a synchronous store that the transcript row, picker, viewer, and status segment all read. Separately, `shared/status-bar.ts` composes every extension's `setStatus` text into one widget above the editor, rendered by `ui-customization`.

**Tech Stack:** TypeScript on Node (type-stripped at load, no build step), `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`. Tests are `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-08-17-file-edits-tui-design.md`

**Verified baseline** (branch `feature/file-edits-tui`): `subagents` 60 tests
pass, `background-terminals` 44 tests pass. `workflows` and `shared` have no
`package.json` and are covered only by the agent-root `tsc` project, which
already reports pre-existing errors in `ask-user`, `file-search`, `git-info`
and `summaries`. Those are out of scope — leave them alone.

---

## Before you start

Everything lives under `pi-agent/dot-pi/agent/extensions/`, which mirrors
`~/.pi/agent/extensions/`. Pi strips types at load, so there is no build step —
but each extension is type-checked with `npm run check` and tested with
`npm test` from inside its own directory.

Existing conventions you must follow, with files to read first:

- Overlay component: `background-terminals/src/ui/ps.ts` — a class implementing
  `Component` with `render(width): string[]`, `handleInput(data): void`,
  `invalidate()`, `dispose()`, a `cleanup()`/`close()` pair, and box drawing
  built from `theme.fg("border", …)` plus `truncateToWidth`/`visibleWidth`.
- Read model: `background-terminals/src/manager.ts:107-166` — a synchronous
  interface with `list()`, `get(id)`, `size()`, `subscribe(listener)`.
- Extension entry: `export default function (pi: ExtensionAPI) { … }` holding
  session-scoped closures, with `pi.on("session_start" | "session_shutdown", …)`.

Key API facts, already verified — do not re-derive them:

- `ToolDefinition.renderCall?: (args, theme, context: ToolRenderContext) => Component`
  and `renderResult?: (result, options: ToolRenderResultOptions, theme, context) => Component`
  (`dist/core/extensions/types.d.ts:341-379`).
- `createEditToolDefinition(cwd, options?)` returns
  `ToolDefinition<typeof editSchema, EditToolDetails | undefined, EditRenderState>`;
  `EditToolDetails = { diff: string; patch: string; firstChangedLine?: number }`
  (`dist/core/tools/edit.d.ts`).
- `createWriteToolDefinition(cwd, options?)` returns
  `ToolDefinition<typeof writeSchema, undefined>` — **the write tool has no
  details**, so its row is derived from `params.content`
  (`dist/core/tools/write.d.ts`).
- Registering a tool named `edit` or `write` replaces the built-in
  (`docs/extensions.md:2052`), and renderer inheritance is per slot.
- `pi.registerShortcut(shortcut: KeyId, { description, handler })`
  (`types.d.ts:906`). `KeyId` is a string union like `"ctrl+f"` (`pi-tui/dist/keys.d.ts:42`).
- `ctx.ui.custom<T>(factory, { overlay: true, overlayOptions })` where the
  factory is `(tui, theme, keybindings, done) => Component`.
- `ctx.ui.setWidget(key, content, options?)` renders **above the editor** by
  default (`docs/extensions.md:168`).
- `ReadonlyFooterDataProvider` is a **live** object: one `FooterDataProvider` is
  created at `interactive-mode.js:383`, mutated in place by `setStatus`, and
  that same reference is handed to `setFooter` factories at
  `interactive-mode.js:1783`. Capturing it and reading `getExtensionStatuses()`
  later is therefore safe.

---

## File structure

**Phase 1 — status bar** (existing extensions)

| File | Responsibility |
|---|---|
| Create `shared/status-bar.ts` | Segment model, fixed ordering, priority-based overflow |
| Create `shared/status-bar.test.ts` | Tests for ordering and overflow |
| Rewrite `shared/activity-status.ts` | Compact segments instead of sentences |
| Modify `ui-customization/index.ts` | Render the bar as a widget; drop statuses from the footer |
| Modify `background-terminals/index.ts` | `setWidget` → `setStatus` |

**Phase 2-5 — new extension** `pi-agent/dot-pi/agent/extensions/file-edits/`

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json` | Node test runner + type-check config |
| `index.ts` | Wiring: tool overrides, `ctrl+f`, `/files`, status segment |
| `src/domain.ts` | `FileChange`, `Hunk`, `DiffLine`, `ChangeOrigin` |
| `src/diff.ts` | Unified-patch parsing, split-row pairing, git baseline |
| `src/store.ts` | Read model over file changes |
| `src/icons.ts` | extension → (glyph, Mocha RGB) |
| `src/render/row.ts` | The two-line collapsed transcript row |
| `src/ui/picker.ts` | Picker overlay |
| `src/ui/viewer.ts` | Stacked / split diff overlay |
| `src/observe.ts` | Child-session edits → store |

---

# Phase 1 — Status bar

## Task 1: Status bar composition

**Files:**
- Create: `pi-agent/dot-pi/agent/extensions/shared/status-bar.ts`
- Test: `pi-agent/dot-pi/agent/extensions/shared/status-bar.test.ts`

- [ ] **Step 1: Write the failing test**

Create `pi-agent/dot-pi/agent/extensions/shared/status-bar.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { composeStatusBar, SEGMENT_ORDER } from "./status-bar.ts";

// A theme stub: every helper is identity, so tests assert on plain text.
const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as never;

test("returns undefined when there are no segments", () => {
  assert.equal(composeStatusBar(new Map(), 80, theme), undefined);
});

test("joins segments with diamonds in fixed order", () => {
  const statuses = new Map([
    ["workflows", "wf 2/4"],
    ["file-edits", "7 files"],
    ["subagents", "2 running"],
  ]);
  assert.equal(
    composeStatusBar(statuses, 80, theme),
    "7 files ◆ 2 running ◆ wf 2/4",
  );
});

test("unknown keys sort after known ones, alphabetically", () => {
  const statuses = new Map([
    ["zebra", "z"],
    ["alpha", "a"],
    ["file-edits", "7 files"],
  ]);
  assert.equal(
    composeStatusBar(statuses, 80, theme),
    "7 files ◆ a ◆ z",
  );
});

test("drops lowest-priority segments whole when the line does not fit", () => {
  const statuses = new Map([
    ["file-edits", "7 files"],
    ["subagents", "2 running"],
    ["summaries", "summarizing"],
  ]);
  // "7 files ◆ 2 running" is 19 cells; adding summaries needs 35.
  assert.equal(composeStatusBar(statuses, 20, theme), "7 files ◆ 2 running");
});

test("truncates the last survivor rather than returning nothing", () => {
  const statuses = new Map([["file-edits", "a very long files segment"]]);
  const line = composeStatusBar(statuses, 10, theme);
  assert.equal(line, "a very lo…");
});

test("multi-line status text is flattened to one line", () => {
  const statuses = new Map([["subagents", "2 running\n1 done"]]);
  assert.equal(composeStatusBar(statuses, 80, theme), "2 running 1 done");
});

test("segment order is the documented one", () => {
  assert.deepEqual(SEGMENT_ORDER, [
    "file-edits",
    "subagents",
    "background-terminals",
    "workflows",
    "summaries",
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd pi-agent/dot-pi/agent/extensions/shared && node --test --experimental-strip-types status-bar.test.ts
```

Expected: FAIL — `Cannot find module './status-bar.ts'`.

- [ ] **Step 3: Write the implementation**

Create `pi-agent/dot-pi/agent/extensions/shared/status-bar.ts`:

```ts
/**
 * One line of status furniture above the editor, shared by every extension.
 *
 * Extensions keep publishing through ctx.ui.setStatus(); this module only
 * decides how the collected strings are ordered, joined, and trimmed to fit.
 * Nothing here touches the UI, so it is testable with a stub theme.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type Theme = ExtensionContext["ui"]["theme"];

/** Same separator the footer uses, so the two rows read as one system. */
const SEPARATOR = " ◆ ";

/**
 * Fixed left-to-right order. A segment never moves under the reader, and
 * anything not listed here sorts after these, alphabetically.
 */
export const SEGMENT_ORDER = [
  "file-edits",
  "subagents",
  "background-terminals",
  "workflows",
  "summaries",
] as const;

function rank(key: string) {
  const index = SEGMENT_ORDER.indexOf(key as (typeof SEGMENT_ORDER)[number]);
  return index === -1 ? SEGMENT_ORDER.length : index;
}

/** Status text may contain newlines; the bar is strictly one line. */
function flatten(text: string) {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

function order(statuses: ReadonlyMap<string, string>) {
  return [...statuses.entries()]
    .map(([key, text]) => ({ key, text: flatten(text) }))
    .filter((segment) => segment.text.length > 0)
    .sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
}

/**
 * Compose the status line, or undefined when there is nothing to say (the
 * caller then clears the widget so the row disappears entirely).
 *
 * Overflow drops whole segments from the right rather than truncating every
 * segment into mush; the last survivor is truncated only if it alone is too
 * wide.
 */
export function composeStatusBar(
  statuses: ReadonlyMap<string, string>,
  width: number,
  theme: Theme,
): string | undefined {
  const segments = order(statuses);
  if (segments.length === 0) return undefined;

  const separator = theme.fg("dim", SEPARATOR);
  const separatorWidth = visibleWidth(SEPARATOR);

  const kept: string[] = [];
  let used = 0;
  for (const segment of segments) {
    const cost =
      visibleWidth(segment.text) + (kept.length === 0 ? 0 : separatorWidth);
    if (kept.length > 0 && used + cost > width) break;
    kept.push(segment.text);
    used += cost;
  }

  if (kept.length === 0) kept.push(segments[0]!.text);

  return truncateToWidth(kept.join(separator), width, theme.fg("dim", "…"));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd pi-agent/dot-pi/agent/extensions/shared && node --test --experimental-strip-types status-bar.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/shared/status-bar.ts pi-agent/dot-pi/agent/extensions/shared/status-bar.test.ts
git commit -m "feat: compose extension statuses into one line"
```

---

## Task 2: Compact activity segments

`shared/activity-status.ts` currently returns a sentence
(`subagents: ■ 2 running · /subagents to view`). On a shared line that is
mostly furniture, so it becomes `⌘ 2 running · 1 done`.

**Files:**
- Modify: `pi-agent/dot-pi/agent/extensions/shared/activity-status.ts` (whole file)
- Test: `pi-agent/dot-pi/agent/extensions/shared/activity-status.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `pi-agent/dot-pi/agent/extensions/shared/activity-status.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatActivityStatus } from "./activity-status.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as never;

test("subagents get their own glyph and compact counts", () => {
  assert.equal(
    formatActivityStatus(theme, "subagents", { running: 2, done: 1, failed: 0 }),
    "⌘ 2 running · 1 done",
  );
});

test("workflows get their own glyph", () => {
  assert.equal(
    formatActivityStatus(theme, "workflows", { running: 1, done: 0, failed: 0 }),
    "⚙ 1 running",
  );
});

test("failures are reported", () => {
  assert.equal(
    formatActivityStatus(theme, "subagents", { running: 0, done: 2, failed: 1 }),
    "⌘ 2 done · 1 failed",
  );
});

test("all-zero counts produce no segment at all", () => {
  assert.equal(
    formatActivityStatus(theme, "subagents", { running: 0, done: 0, failed: 0 }),
    undefined,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd pi-agent/dot-pi/agent/extensions/shared && node --test --experimental-strip-types activity-status.test.ts
```

Expected: FAIL — the current implementation returns a `subagents: …` sentence.

- [ ] **Step 3: Rewrite the implementation**

Replace the whole contents of
`pi-agent/dot-pi/agent/extensions/shared/activity-status.ts`:

```ts
/**
 * One compact segment for the shared status bar above the editor.
 *
 * The "how to open it" hint that used to live here is gone: on a single shared
 * line it is noise once the command is known, and /subagents and /workflows
 * are both discoverable from the command palette.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type Theme = ExtensionContext["ui"]["theme"];

interface ActivityCounts {
  running: number;
  done: number;
  failed: number;
}

const GLYPHS = {
  subagents: "⌘",
  workflows: "⚙",
} as const;

export function formatActivityStatus(
  theme: Theme,
  label: keyof typeof GLYPHS,
  counts: ActivityCounts,
): string | undefined {
  const parts: string[] = [];
  if (counts.running > 0) {
    parts.push(theme.fg("warning", `${counts.running} running`));
  }
  if (counts.done > 0) parts.push(theme.fg("success", `${counts.done} done`));
  if (counts.failed > 0) {
    parts.push(theme.fg("error", `${counts.failed} failed`));
  }
  if (parts.length === 0) return undefined;

  return `${theme.fg("accent", GLYPHS[label])} ${parts.join(theme.fg("dim", " · "))}`;
}
```

- [ ] **Step 4: Update both call sites for the new `undefined` return**

In `pi-agent/dot-pi/agent/extensions/subagents/index.ts` around line 318, the
call currently passes the result straight to `setStatus`. Change the block so
an empty segment clears the status instead:

```ts
    const segment = formatActivityStatus(ui.theme, "subagents", counts);
    ui.setStatus("subagents", segment);
```

Apply the identical change in
`pi-agent/dot-pi/agent/extensions/workflows/index.ts` around line 272:

```ts
      const segment = formatActivityStatus(ui.theme, "workflows", counts);
      ui.setStatus("workflows", segment);
```

Read ~15 lines of context around each call site before editing; keep the
surrounding early-return logic exactly as it is.

- [ ] **Step 5: Run the tests and type-check**

```bash
cd pi-agent/dot-pi/agent/extensions/shared && node --test --experimental-strip-types activity-status.test.ts status-bar.test.ts
cd ../subagents && npm run check
```

Expected: tests PASS (11 total), `npm run check` exits 0.

`workflows` and `shared` have **no `package.json`** — they are type-checked only
by the agent-root project (`pi-agent/dot-pi/agent/tsconfig.json`). Do not run
`npm run check` or `npm test` inside them; from inside `workflows`, npm walks up
and runs the *root* check, which reports pre-existing errors in unrelated
extensions. To check those two, run from `pi-agent/dot-pi/agent`:

```bash
npx tsc --noEmit -p . 2>&1 | grep -E "extensions/(workflows|shared)/"
```

Expected: no output. **Baseline note:** that same root check already reports
pre-existing errors in `ask-user`, `file-search`, `git-info` and `summaries`.
Those are not yours — do not fix them, and do not treat them as a regression.

- [ ] **Step 6: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/shared pi-agent/dot-pi/agent/extensions/subagents/index.ts pi-agent/dot-pi/agent/extensions/workflows/index.ts
git commit -m "feat: shrink activity statuses to one compact segment"
```

---

## Task 3: Render the bar above the editor

**Files:**
- Modify: `pi-agent/dot-pi/agent/extensions/ui-customization/index.ts`

- [ ] **Step 1: Capture the footer data provider and add the widget**

In `ui-customization/index.ts`, add to the imports:

```ts
import { composeStatusBar } from "../shared/status-bar.ts";
```

Add a module-scope constant beside `GAUGE_WIDTH`:

```ts
const STATUS_WIDGET_KEY = "shared-status-bar";
```

Inside `uiCustomization`, beside the other closures, add:

```ts
  let footerData: ReadonlyFooterDataProvider | undefined;
  let statusContext: ExtensionContext | undefined;
```

- [ ] **Step 2: Remove the status lines from the footer**

In the `ctx.ui.setFooter` callback, capture the provider as the first statement
of the factory:

```ts
    ctx.ui.setFooter((tui, theme, footer: ReadonlyFooterDataProvider) => {
      requestRender = () => tui.requestRender();
      footerData = footer;
```

Then delete the trailing block that appends extension statuses — everything
from the `// Extension statuses render after the two dashboard lines` comment
through the closing `}` of the `for (const statusLine of statusLines)` loop —
so the footer's `render` ends with `return lines;` immediately after the
`columns(...)` push.

- [ ] **Step 3: Add the widget that draws the bar**

Add this function inside `uiCustomization`, above `install`:

```ts
  /** One shared line above the editor. Cleared entirely when nothing is
   * active, so the row does not sit there empty. */
  function refreshStatusBar() {
    const ctx = statusContext;
    if (!ctx || ctx.mode !== "tui" || !footerData) return;
    const statuses = footerData.getExtensionStatuses();
    if (statuses.size === 0) {
      ctx.ui.setWidget(STATUS_WIDGET_KEY, undefined);
      return;
    }
    ctx.ui.setWidget(STATUS_WIDGET_KEY, (_tui, theme) => ({
      render(width: number) {
        const line = composeStatusBar(statuses, width, theme);
        return line ? [line] : [];
      },
      invalidate() {},
    }));
  }
```

Call `statusContext = ctx;` at the top of `install(ctx)`, and call
`refreshStatusBar()` at the end of `install`. Also call `refreshStatusBar()`
inside both existing `pi.events.on(...)` listeners, right after
`requestRender?.()`, so the bar keeps up with model and git updates. Finally,
in the `session_shutdown` handler, add `ctx.ui.setWidget(STATUS_WIDGET_KEY, undefined);`
next to the existing `setHeader`/`setFooter` teardown.

- [ ] **Step 4: Verify manually**

```bash
cd pi-agent && cp -R dot-pi/agent/. ~/.pi/agent/
```

Start `pi` in any directory, run `/subagents`-producing work or simply
`bg_start` a `sleep 30` command, and confirm: a single line appears directly
above the prompt, the main footer no longer shows status text, and the line
disappears when the work settles.

**If the line never appears**, the provider was a snapshot rather than a live
view. Fall back to the bus: add `STATUS_CHANNEL = "dashboard:status"` to
`shared/dashboard-state.ts`, have each extension `pi.events.emit(STATUS_CHANNEL, { key, text })`
alongside its `setStatus` call, and have `refreshStatusBar` read from a Map
maintained by a listener instead of `footerData`.

- [ ] **Step 5: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/ui-customization/index.ts
git commit -m "feat: move extension statuses above the prompt"
```

---

## Task 4: Background terminals join the shared line

**Files:**
- Modify: `pi-agent/dot-pi/agent/extensions/background-terminals/index.ts:86-116`

- [ ] **Step 1: Replace the private widget with a status segment**

Replace the body of `updateWidget` (keeping its name and call sites) with:

```ts
  let widgetRunning = 0;
  const updateWidget = (manager: TerminalManagerShape) => {
    if (!ui) return;
    try {
      const running = manager.view
        .list()
        .filter((snap) => snap.status === "running").length;
      if (running === widgetRunning) return;
      widgetRunning = running;
      if (running === 0) {
        ui.setStatus(WIDGET_KEY, undefined);
        return;
      }
      // Joins the shared line above the editor rather than owning a row.
      ui.setStatus(
        WIDGET_KEY,
        `${ui.theme.fg("accent", "▶")} ${ui.theme.fg("warning", String(running))} ${ui.theme.fg("text", `terminal${running === 1 ? "" : "s"}`)}`,
      );
    } catch {
      // UI may be unavailable (print/RPC modes or teardown).
    }
  };
```

- [ ] **Step 2: Update teardown**

At `background-terminals/index.ts:192`, change
`ui?.setWidget(WIDGET_KEY, undefined);` to
`ui?.setStatus(WIDGET_KEY, undefined);`.

- [ ] **Step 3: Type-check and run the suite**

```bash
cd pi-agent/dot-pi/agent/extensions/background-terminals && npm run check && npm test
```

Expected: check exits 0; existing tests PASS unchanged.

- [ ] **Step 4: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/background-terminals/index.ts
git commit -m "feat: publish terminal count to the shared status bar"
```

---

# Phase 2 — Store, diff, and the collapsed row

## Task 5: Scaffold the extension

**Files:**
- Create: `pi-agent/dot-pi/agent/extensions/file-edits/package.json`
- Create: `pi-agent/dot-pi/agent/extensions/file-edits/tsconfig.json`
- Create: `pi-agent/dot-pi/agent/extensions/file-edits/src/domain.ts`

- [ ] **Step 1: Create `package.json`**

No `effect` dependency — this extension is plain callbacks, unlike `subagents`.

```json
{
  "name": "file-edits",
  "private": true,
  "type": "module",
  "scripts": {
    "check": "tsc --noEmit -p .",
    "test": "node --test --experimental-strip-types src/diff.test.ts src/store.test.ts src/icons.test.ts src/render/row.test.ts"
  },
  "devDependencies": {
    "typescript": "^7.0.2"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "include": ["index.ts", "src/**/*.ts"]
}
```

- [ ] **Step 3: Create `src/domain.ts`**

```ts
/**
 * The vocabulary of a file change. Everything else in this extension reads
 * and writes these shapes; nothing here imports the TUI.
 */

/** Who made the change. Child-session edits are tagged so the picker can
 * show them without pretending this session made them. */
export type ChangeOrigin =
  | { readonly kind: "self" }
  | { readonly kind: "subagent"; readonly id: string; readonly name: string }
  | { readonly kind: "workflow"; readonly label: string };

export type DiffLineKind = "context" | "add" | "remove";

export interface DiffLine {
  readonly kind: DiffLineKind;
  /** 1-based line number in the old file; absent for added lines. */
  readonly oldLine?: number;
  /** 1-based line number in the new file; absent for removed lines. */
  readonly newLine?: number;
  readonly text: string;
}

export interface Hunk {
  readonly oldStart: number;
  readonly newStart: number;
  readonly lines: ReadonlyArray<DiffLine>;
}

export interface FileChange {
  /** Path relative to the session cwd. Also the store key. */
  readonly path: string;
  readonly hunks: ReadonlyArray<Hunk>;
  readonly added: number;
  readonly removed: number;
  /** Number of tool calls that touched this file this session. */
  readonly edits: number;
  readonly isNew: boolean;
  /** Epoch ms of the most recent change. */
  readonly updatedAt: number;
  readonly origin: ChangeOrigin;
  /**
   * True when hunks are not known yet: either the patch failed to parse, or
   * this is a child-session edit whose diff is computed lazily against HEAD.
   */
  readonly hunksPending: boolean;
}

export function describeOrigin(origin: ChangeOrigin): string | undefined {
  switch (origin.kind) {
    case "self":
      return undefined;
    case "subagent":
      return `⌘ ${origin.name}`;
    case "workflow":
      return `⚙ ${origin.label}`;
  }
}
```

- [ ] **Step 4: Verify the scaffold type-checks**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && npm install --ignore-scripts && npm run check
```

Expected: exit 0. (`npm test` will fail until Task 6 — that is expected.)

- [ ] **Step 5: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/file-edits
git commit -m "feat: scaffold the file-edits extension"
```

---

## Task 6: Parse unified patches

**Files:**
- Create: `pi-agent/dot-pi/agent/extensions/file-edits/src/diff.ts`
- Test: `pi-agent/dot-pi/agent/extensions/file-edits/src/diff.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUnifiedPatch, largestHunk } from "./diff.ts";

const PATCH = `--- a/src/router.ts
+++ b/src/router.ts
@@ -37,3 +37,4 @@
 const ranked = rank(candidates)
-return ranked[0]
+const model = pickModel(ranked, effort)
+if (!model) throw new NoModelError(effort)
`;

test("parses hunks with old and new line numbers", () => {
  const parsed = parseUnifiedPatch(PATCH);
  assert.ok(parsed);
  assert.equal(parsed.hunks.length, 1);
  const hunk = parsed.hunks[0]!;
  assert.equal(hunk.oldStart, 37);
  assert.equal(hunk.newStart, 37);
  assert.deepEqual(
    hunk.lines.map((line) => [line.kind, line.oldLine, line.newLine]),
    [
      ["context", 37, 37],
      ["remove", 38, undefined],
      ["add", undefined, 38],
      ["add", undefined, 39],
    ],
  );
});

test("counts additions and removals", () => {
  const parsed = parseUnifiedPatch(PATCH);
  assert.equal(parsed?.added, 2);
  assert.equal(parsed?.removed, 1);
});

test("handles multiple hunks", () => {
  const parsed = parseUnifiedPatch(
    `@@ -1,1 +1,1 @@\n-a\n+b\n@@ -10,1 +10,2 @@\n c\n+d\n`,
  );
  assert.equal(parsed?.hunks.length, 2);
  assert.equal(parsed?.hunks[1]?.oldStart, 10);
  assert.equal(parsed?.added, 2);
});

test("ignores the no-newline marker", () => {
  const parsed = parseUnifiedPatch(`@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+b\n`);
  assert.equal(parsed?.removed, 1);
  assert.equal(parsed?.added, 1);
  assert.equal(parsed?.hunks[0]?.lines.length, 2);
});

test("returns null for text that is not a patch", () => {
  assert.equal(parseUnifiedPatch("not a patch at all"), null);
  assert.equal(parseUnifiedPatch(""), null);
});

test("single-line hunk headers without counts are accepted", () => {
  const parsed = parseUnifiedPatch(`@@ -5 +5 @@\n-a\n+b\n`);
  assert.equal(parsed?.hunks[0]?.oldStart, 5);
});

test("largestHunk picks the hunk with the most changed lines", () => {
  const parsed = parseUnifiedPatch(
    `@@ -1,1 +1,1 @@\n-a\n+b\n@@ -10,1 +10,3 @@\n c\n+d\n+e\n+f\n`,
  )!;
  assert.equal(largestHunk(parsed.hunks)?.oldStart, 10);
});

test("largestHunk returns undefined for no hunks", () => {
  assert.equal(largestHunk([]), undefined);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && node --test --experimental-strip-types src/diff.test.ts
```

Expected: FAIL — `Cannot find module './diff.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/diff.ts`:

```ts
/**
 * Unified-patch parsing. Pure: no filesystem, no TUI. The edit tool already
 * hands us a standard patch in `details.patch`, so this only has to read it.
 */

import type { DiffLine, Hunk } from "./domain.ts";

export interface ParsedPatch {
  readonly hunks: ReadonlyArray<Hunk>;
  readonly added: number;
  readonly removed: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedPatch(patch: string): ParsedPatch | null {
  if (!patch) return null;

  const hunks: Hunk[] = [];
  let added = 0;
  let removed = 0;

  let lines: DiffLine[] = [];
  let oldStart = 0;
  let newStart = 0;
  let oldLine = 0;
  let newLine = 0;
  let open = false;

  const flush = () => {
    if (open) hunks.push({ oldStart, newStart, lines });
    open = false;
    lines = [];
  };

  for (const raw of patch.split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      flush();
      oldStart = Number(header[1]);
      newStart = Number(header[3]);
      oldLine = oldStart;
      newLine = newStart;
      open = true;
      continue;
    }
    if (!open) continue;
    // File headers and the no-newline marker carry no diff content.
    if (raw.startsWith("---") || raw.startsWith("+++") || raw.startsWith("\\")) {
      continue;
    }

    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === "+") {
      lines.push({ kind: "add", newLine, text });
      newLine += 1;
      added += 1;
    } else if (marker === "-") {
      lines.push({ kind: "remove", oldLine, text });
      oldLine += 1;
      removed += 1;
    } else if (marker === " ") {
      lines.push({ kind: "context", oldLine, newLine, text });
      oldLine += 1;
      newLine += 1;
    }
    // Anything else (including a trailing empty line) is not diff content.
  }
  flush();

  return hunks.length === 0 ? null : { hunks, added, removed };
}

/** The hunk with the most changed lines — the one worth previewing. */
export function largestHunk(hunks: ReadonlyArray<Hunk>): Hunk | undefined {
  let best: Hunk | undefined;
  let bestScore = -1;
  for (const hunk of hunks) {
    const score = hunk.lines.filter((line) => line.kind !== "context").length;
    if (score > bestScore) {
      best = hunk;
      bestScore = score;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && node --test --experimental-strip-types src/diff.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/file-edits/src/diff.ts pi-agent/dot-pi/agent/extensions/file-edits/src/diff.test.ts
git commit -m "feat: parse unified patches into hunks"
```

---

## Task 7: The file-change store

**Files:**
- Create: `pi-agent/dot-pi/agent/extensions/file-edits/src/store.ts`
- Test: `pi-agent/dot-pi/agent/extensions/file-edits/src/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createFileEditStore } from "./store.ts";

const SELF = { kind: "self" } as const;

function hunk(added: number) {
  return {
    oldStart: 1,
    newStart: 1,
    lines: Array.from({ length: added }, (_, index) => ({
      kind: "add" as const,
      newLine: index + 1,
      text: "x",
    })),
  };
}

test("records a change and lists it", () => {
  const store = createFileEditStore();
  store.record({
    path: "src/a.ts",
    hunks: [hunk(2)],
    added: 2,
    removed: 1,
    isNew: false,
    origin: SELF,
    at: 1000,
  });
  const change = store.get("src/a.ts");
  assert.equal(change?.added, 2);
  assert.equal(change?.removed, 1);
  assert.equal(change?.edits, 1);
  assert.equal(store.size(), 1);
});

test("a second edit to the same file merges counts and bumps edits", () => {
  const store = createFileEditStore();
  store.record({ path: "a.ts", hunks: [hunk(2)], added: 2, removed: 1, isNew: false, origin: SELF, at: 1 });
  store.record({ path: "a.ts", hunks: [hunk(3)], added: 3, removed: 0, isNew: false, origin: SELF, at: 2 });
  const change = store.get("a.ts")!;
  assert.equal(change.added, 5);
  assert.equal(change.removed, 1);
  assert.equal(change.edits, 2);
  assert.equal(change.updatedAt, 2);
  // Hunks come from the most recent edit, not the accumulated history.
  assert.equal(change.hunks[0]!.lines.length, 3);
});

test("isNew sticks once a file has been created this session", () => {
  const store = createFileEditStore();
  store.record({ path: "a.ts", hunks: [], added: 4, removed: 0, isNew: true, origin: SELF, at: 1 });
  store.record({ path: "a.ts", hunks: [hunk(1)], added: 1, removed: 0, isNew: false, origin: SELF, at: 2 });
  assert.equal(store.get("a.ts")?.isNew, true);
});

test("list is ordered most-recently-changed first", () => {
  const store = createFileEditStore();
  store.record({ path: "a.ts", hunks: [], added: 1, removed: 0, isNew: false, origin: SELF, at: 1 });
  store.record({ path: "b.ts", hunks: [], added: 1, removed: 0, isNew: false, origin: SELF, at: 2 });
  store.record({ path: "a.ts", hunks: [], added: 1, removed: 0, isNew: false, origin: SELF, at: 3 });
  assert.deepEqual(store.list().map((change) => change.path), ["a.ts", "b.ts"]);
});

test("external records mark hunks as pending", () => {
  const store = createFileEditStore();
  store.recordExternal({
    path: "a.ts",
    origin: { kind: "subagent", id: "sa-2", name: "sa-2" },
    at: 5,
  });
  const change = store.get("a.ts")!;
  assert.equal(change.hunksPending, true);
  assert.equal(change.origin.kind, "subagent");
});

test("a real edit supersedes a pending external record", () => {
  const store = createFileEditStore();
  store.recordExternal({ path: "a.ts", origin: { kind: "subagent", id: "sa-2", name: "sa-2" }, at: 1 });
  store.record({ path: "a.ts", hunks: [hunk(2)], added: 2, removed: 0, isNew: false, origin: SELF, at: 2 });
  assert.equal(store.get("a.ts")?.hunksPending, false);
});

test("resolveHunks fills in a pending record", () => {
  const store = createFileEditStore();
  store.recordExternal({ path: "a.ts", origin: { kind: "subagent", id: "sa-2", name: "sa-2" }, at: 1 });
  store.resolveHunks("a.ts", { hunks: [hunk(3)], added: 3, removed: 1 });
  const change = store.get("a.ts")!;
  assert.equal(change.hunksPending, false);
  assert.equal(change.added, 3);
  assert.equal(change.removed, 1);
});

test("the store is capped, dropping the oldest entries", () => {
  const store = createFileEditStore({ cap: 2 });
  store.record({ path: "a.ts", hunks: [], added: 1, removed: 0, isNew: false, origin: SELF, at: 1 });
  store.record({ path: "b.ts", hunks: [], added: 1, removed: 0, isNew: false, origin: SELF, at: 2 });
  store.record({ path: "c.ts", hunks: [], added: 1, removed: 0, isNew: false, origin: SELF, at: 3 });
  assert.equal(store.size(), 2);
  assert.equal(store.get("a.ts"), undefined);
});

test("totals sum across files", () => {
  const store = createFileEditStore();
  store.record({ path: "a.ts", hunks: [], added: 2, removed: 1, isNew: false, origin: SELF, at: 1 });
  store.record({ path: "b.ts", hunks: [], added: 3, removed: 0, isNew: false, origin: SELF, at: 2 });
  assert.deepEqual(store.totals(), { files: 2, added: 5, removed: 1 });
});

test("subscribers are notified on every write and can unsubscribe", () => {
  const store = createFileEditStore();
  let calls = 0;
  const stop = store.subscribe(() => { calls += 1; });
  store.record({ path: "a.ts", hunks: [], added: 1, removed: 0, isNew: false, origin: SELF, at: 1 });
  stop();
  store.record({ path: "b.ts", hunks: [], added: 1, removed: 0, isNew: false, origin: SELF, at: 2 });
  assert.equal(calls, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && node --test --experimental-strip-types src/store.test.ts
```

Expected: FAIL — `Cannot find module './store.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/store.ts`:

```ts
/**
 * The read model every consumer shares: the transcript row, the picker, the
 * viewer, and the status segment. Synchronous, with subscriptions — the same
 * shape background-terminals uses for its terminal list.
 */

import type { ChangeOrigin, FileChange, Hunk } from "./domain.ts";

export interface RecordInput {
  readonly path: string;
  readonly hunks: ReadonlyArray<Hunk>;
  readonly added: number;
  readonly removed: number;
  readonly isNew: boolean;
  readonly origin: ChangeOrigin;
  /** Epoch ms. Injected so tests do not depend on the clock. */
  readonly at: number;
}

export interface ExternalInput {
  readonly path: string;
  readonly origin: ChangeOrigin;
  readonly at: number;
}

export interface ResolvedHunks {
  readonly hunks: ReadonlyArray<Hunk>;
  readonly added: number;
  readonly removed: number;
}

export interface FileEditStore {
  record(input: RecordInput): void;
  /** A change we know happened but cannot diff yet (child sessions). */
  recordExternal(input: ExternalInput): void;
  /** Fill in hunks computed later, e.g. against git HEAD. */
  resolveHunks(path: string, resolved: ResolvedHunks): void;
  get(path: string): FileChange | undefined;
  /** Most recently changed first. */
  list(): ReadonlyArray<FileChange>;
  size(): number;
  totals(): { files: number; added: number; removed: number };
  subscribe(listener: () => void): () => void;
}

const DEFAULT_CAP = 200;

export function createFileEditStore(
  options: { cap?: number } = {},
): FileEditStore {
  const cap = options.cap ?? DEFAULT_CAP;
  const changes = new Map<string, FileChange>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  /** Oldest-first eviction keeps the map bounded without touching order of
   * the rest, since list() sorts on read anyway. */
  const evict = () => {
    while (changes.size > cap) {
      let oldestPath: string | undefined;
      let oldestAt = Infinity;
      for (const [path, change] of changes) {
        if (change.updatedAt < oldestAt) {
          oldestAt = change.updatedAt;
          oldestPath = path;
        }
      }
      if (!oldestPath) return;
      changes.delete(oldestPath);
    }
  };

  return {
    record(input) {
      const previous = changes.get(input.path);
      changes.set(input.path, {
        path: input.path,
        hunks: input.hunks,
        added: (previous?.added ?? 0) + input.added,
        removed: (previous?.removed ?? 0) + input.removed,
        edits: (previous?.edits ?? 0) + 1,
        isNew: previous?.isNew || input.isNew,
        updatedAt: input.at,
        origin: input.origin,
        hunksPending: false,
      });
      evict();
      notify();
    },

    recordExternal(input) {
      const previous = changes.get(input.path);
      changes.set(input.path, {
        path: input.path,
        hunks: previous?.hunks ?? [],
        added: previous?.added ?? 0,
        removed: previous?.removed ?? 0,
        edits: (previous?.edits ?? 0) + 1,
        isNew: previous?.isNew ?? false,
        updatedAt: input.at,
        origin: input.origin,
        hunksPending: true,
      });
      evict();
      notify();
    },

    resolveHunks(path, resolved) {
      const previous = changes.get(path);
      if (!previous) return;
      changes.set(path, {
        ...previous,
        hunks: resolved.hunks,
        added: resolved.added,
        removed: resolved.removed,
        hunksPending: false,
      });
      notify();
    },

    get(path) {
      return changes.get(path);
    },

    list() {
      return [...changes.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    },

    size() {
      return changes.size;
    },

    totals() {
      let added = 0;
      let removed = 0;
      for (const change of changes.values()) {
        added += change.added;
        removed += change.removed;
      }
      return { files: changes.size, added, removed };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && node --test --experimental-strip-types src/store.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/file-edits/src/store.ts pi-agent/dot-pi/agent/extensions/file-edits/src/store.test.ts
git commit -m "feat: add the file-change read model"
```

---

## Task 8: File-type icons

Colors are literal RGB from `themes/catppuccin-mocha.json`, because
`ThemeColor` is a fixed union with no per-language entries.

**Files:**
- Create: `pi-agent/dot-pi/agent/extensions/file-edits/src/icons.ts`
- Test: `pi-agent/dot-pi/agent/extensions/file-edits/src/icons.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { iconFor, paintIcon } from "./icons.ts";

test("known extensions get their own glyph and color", () => {
  const ts = iconFor("src/router.ts");
  assert.equal(ts.glyph, "");
  assert.deepEqual(ts.rgb, [137, 180, 250]);
  assert.equal(iconFor("a/b/main.py").glyph, "");
  assert.equal(iconFor("theme.json").glyph, "");
  assert.equal(iconFor("README.md").glyph, "");
});

test("matching is case-insensitive", () => {
  assert.equal(iconFor("A.TS").glyph, iconFor("a.ts").glyph);
});

test("exact filenames win over extensions", () => {
  assert.equal(iconFor("Dockerfile").glyph, "");
  assert.equal(iconFor("some/dir/Dockerfile").glyph, "");
});

test("unknown extensions fall back to a generic document", () => {
  const unknown = iconFor("data.xyzzy");
  assert.equal(unknown.glyph, "");
  assert.deepEqual(unknown.rgb, [166, 173, 200]);
});

test("files with no extension fall back too", () => {
  assert.equal(iconFor("LICENSE").glyph, "");
});

test("paintIcon wraps the glyph in a truecolor escape", () => {
  assert.equal(paintIcon(iconFor("a.ts")), "\x1b[38;2;137;180;250m\x1b[0m");
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && node --test --experimental-strip-types src/icons.test.ts
```

Expected: FAIL — `Cannot find module './icons.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/icons.ts`:

```ts
/**
 * Nerd-font file-type glyphs in Catppuccin Mocha.
 *
 * These are literal RGB rather than ThemeColor because ThemeColor is a fixed
 * 43-name union with no per-language entries. Every value below is a Mocha
 * accent taken from themes/catppuccin-mocha.json, so the icons cannot drift
 * from the rest of the TUI.
 */

export type Rgb = [number, number, number];

export interface FileIcon {
  readonly glyph: string;
  readonly rgb: Rgb;
}

const BLUE: Rgb = [137, 180, 250];
const YELLOW: Rgb = [249, 226, 175];
const GREEN: Rgb = [166, 227, 161];
const PEACH: Rgb = [250, 179, 135];
const MAUVE: Rgb = [203, 166, 247];
const RED: Rgb = [243, 139, 168];
const SKY: Rgb = [137, 220, 235];
const SUBTEXT: Rgb = [166, 173, 200];

const FALLBACK: FileIcon = { glyph: "", rgb: SUBTEXT };

/** Exact filenames take precedence over extensions. */
const BY_NAME: Record<string, FileIcon> = {
  dockerfile: { glyph: "", rgb: BLUE },
  makefile: { glyph: "", rgb: PEACH },
  ".gitignore": { glyph: "", rgb: PEACH },
};

const BY_EXTENSION: Record<string, FileIcon> = {
  ts: { glyph: "", rgb: BLUE },
  tsx: { glyph: "", rgb: BLUE },
  js: { glyph: "", rgb: YELLOW },
  jsx: { glyph: "", rgb: YELLOW },
  json: { glyph: "", rgb: YELLOW },
  py: { glyph: "", rgb: YELLOW },
  rs: { glyph: "", rgb: PEACH },
  go: { glyph: "", rgb: SKY },
  sh: { glyph: "", rgb: GREEN },
  bash: { glyph: "", rgb: GREEN },
  zsh: { glyph: "", rgb: GREEN },
  nu: { glyph: "", rgb: GREEN },
  md: { glyph: "", rgb: SUBTEXT },
  toml: { glyph: "", rgb: PEACH },
  yaml: { glyph: "", rgb: PEACH },
  yml: { glyph: "", rgb: PEACH },
  css: { glyph: "", rgb: MAUVE },
  html: { glyph: "", rgb: RED },
  lock: { glyph: "", rgb: SUBTEXT },
};

export function iconFor(path: string): FileIcon {
  const name = (path.split("/").pop() ?? path).toLowerCase();
  const byName = BY_NAME[name];
  if (byName) return byName;

  const dot = name.lastIndexOf(".");
  if (dot <= 0) return FALLBACK;
  return BY_EXTENSION[name.slice(dot + 1)] ?? FALLBACK;
}

export function paintIcon({ glyph, rgb: [r, g, b] }: FileIcon): string {
  return `\x1b[38;2;${r};${g};${b}m${glyph}\x1b[0m`;
}
```

> **Note for the implementer:** the glyphs above are literal nerd-font
> codepoints. Copy them verbatim from this plan — do not retype them, and do
> not substitute emoji. If your editor mangles them, take the codepoints from
> the [nerd-fonts cheat sheet](https://www.nerdfonts.com/cheat-sheet)
> (`nf-seti-typescript` etc.) and keep the test's expected values in sync with
> whatever you actually write.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && node --test --experimental-strip-types src/icons.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/file-edits/src/icons.ts pi-agent/dot-pi/agent/extensions/file-edits/src/icons.test.ts
git commit -m "feat: map file types to mocha nerd-font icons"
```

---

## Task 9: The collapsed row

**Files:**
- Create: `pi-agent/dot-pi/agent/extensions/file-edits/src/render/row.ts`
- Test: `pi-agent/dot-pi/agent/extensions/file-edits/src/render/row.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderCollapsedRow, PEEK_LINES } from "./row.ts";
import { parseUnifiedPatch } from "../diff.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as never;

const parsed = parseUnifiedPatch(
  `@@ -37,3 +37,4 @@\n const ranked = rank(candidates)\n-return ranked[0]\n+const model = pickModel(ranked, effort)\n+if (!model) throw new NoModelError(effort)\n`,
)!;

const change = {
  path: "src/router.ts",
  hunks: parsed.hunks,
  added: 12,
  removed: 4,
  edits: 1,
  isNew: false,
  updatedAt: 0,
  origin: { kind: "self" } as const,
  hunksPending: false,
};

test("renders exactly two lines", () => {
  assert.equal(renderCollapsedRow(change, 80, theme).length, 2);
});

test("the header carries the path and the counts", () => {
  const [header] = renderCollapsedRow(change, 80, theme);
  assert.match(header!, /src\/router\.ts/);
  assert.match(header!, /\+12/);
  assert.match(header!, /−4/);
});

test("the peek shows changed lines, not context", () => {
  const [, peek] = renderCollapsedRow(change, 80, theme);
  assert.match(peek!, /pickModel/);
  assert.doesNotMatch(peek!, /const ranked/);
});

test("the peek is capped", () => {
  const many = parseUnifiedPatch(
    `@@ -1,1 +1,6 @@\n+a\n+b\n+c\n+d\n+e\n`,
  )!;
  const [, peek] = renderCollapsedRow({ ...change, hunks: many.hunks }, 80, theme);
  assert.equal(peek!.split("\n").length, 1);
  assert.equal(PEEK_LINES, 3);
});

test("every line fits the width", () => {
  for (const line of renderCollapsedRow(change, 30, theme)) {
    assert.ok(line.length <= 30, `too wide: ${line}`);
  }
});

test("a file with no hunks renders a single header line", () => {
  const lines = renderCollapsedRow({ ...change, hunks: [], hunksPending: true }, 80, theme);
  assert.equal(lines.length, 1);
});

test("new files are labelled", () => {
  const [header] = renderCollapsedRow({ ...change, isNew: true, removed: 0 }, 80, theme);
  assert.match(header!, /new/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && node --test --experimental-strip-types src/render/row.test.ts
```

Expected: FAIL — `Cannot find module './row.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/render/row.ts`:

```ts
/**
 * The two-line collapsed row: what an edit looks like in the transcript when
 * you are not reading the diff. Header plus a peek at the largest hunk.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { largestHunk } from "../diff.ts";
import type { FileChange } from "../domain.ts";
import { iconFor, paintIcon } from "../icons.ts";

type Theme = ExtensionContext["ui"]["theme"];

export const PEEK_LINES = 3;

/** The directory tells you where; the basename tells you what. Only the
 * second one earns full contrast — the same split the footer uses. */
function paintPath(path: string, theme: Theme) {
  const cut = path.lastIndexOf("/");
  if (cut < 0) return theme.bold(theme.fg("text", path));
  return (
    theme.fg("dim", path.slice(0, cut + 1)) +
    theme.bold(theme.fg("text", path.slice(cut + 1)))
  );
}

function counts(change: FileChange, theme: Theme) {
  const parts: string[] = [];
  if (change.isNew) parts.push(theme.fg("success", "new"));
  if (change.added > 0) parts.push(theme.fg("toolDiffAdded", `+${change.added}`));
  if (change.removed > 0) {
    parts.push(theme.fg("toolDiffRemoved", `−${change.removed}`));
  }
  return parts.join(" ");
}

export function renderCollapsedRow(
  change: FileChange,
  width: number,
  theme: Theme,
): string[] {
  const left = `${paintIcon(iconFor(change.path))} ${paintPath(change.path, theme)}`;
  const right = counts(change, theme);
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  const header = truncateToWidth(
    `${left}${" ".repeat(gap)}${right}`,
    width,
    theme.fg("dim", "…"),
  );

  const hunk = largestHunk(change.hunks);
  if (!hunk) return [header];

  const changed = hunk.lines.filter((line) => line.kind !== "context");
  if (changed.length === 0) return [header];

  const peek = changed
    .slice(0, PEEK_LINES)
    .map((line) => line.text.trim())
    .join(theme.fg("dim", " · "));

  return [
    header,
    truncateToWidth(
      `   ${theme.fg("dim", "│")} ${theme.fg("dim", peek)}`,
      width,
      theme.fg("dim", "…"),
    ),
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && node --test --experimental-strip-types src/render/row.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/file-edits/src/render
git commit -m "feat: render the collapsed file-edit row"
```

---

## Task 10: Override the edit and write tools

**Files:**
- Modify: `pi-agent/dot-pi/agent/extensions/file-edits/index.ts` (create)

- [ ] **Step 1: Write the extension entry point**

Create `pi-agent/dot-pi/agent/extensions/file-edits/index.ts`:

```ts
/**
 * file-edits — file changes as a first-class surface.
 *
 * The built-in edit and write tools are re-registered with the same names so
 * their transcript rows collapse to two lines: an icon, the path, and the
 * counts, plus a peek at the largest hunk. Execution is delegated to the SDK's
 * own implementation, so edit semantics are untouched; only the renderers and
 * a store subscription are ours.
 *
 * ctrl+f (or /files) opens the picker; Enter there opens the diff viewer,
 * which toggles between a unified and a side-by-side layout.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import {
  createEditToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { parseUnifiedPatch } from "./src/diff.ts";
import { createFileEditStore } from "./src/store.ts";
import { renderCollapsedRow } from "./src/render/row.ts";

const STATUS_KEY = "file-edits";
const SELF = { kind: "self" } as const;

export default function (pi: ExtensionAPI) {
  const store = createFileEditStore();
  let ui: ExtensionUIContext | undefined;

  /** Store keys are cwd-relative: that is what the user reads and types. */
  const relative = (cwd: string, target: string) => {
    const absolute = path.isAbsolute(target) ? target : path.join(cwd, target);
    const rel = path.relative(cwd, absolute);
    return rel.startsWith("..") ? absolute : rel;
  };

  const updateStatus = () => {
    if (!ui) return;
    try {
      const { files } = store.totals();
      if (files === 0) {
        ui.setStatus(STATUS_KEY, undefined);
        return;
      }
      ui.setStatus(
        STATUS_KEY,
        `${ui.theme.fg("accent", "󰈔")} ${ui.theme.fg("text", `${files} file${files === 1 ? "" : "s"}`)}`,
      );
    } catch {
      // UI unavailable in print/RPC modes or during teardown.
    }
  };

  store.subscribe(updateStatus);

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    ui = ctx.mode === "tui" ? ctx.ui : undefined;

    const baseEdit = createEditToolDefinition(ctx.cwd);
    const baseWrite = createWriteToolDefinition(ctx.cwd);

    pi.registerTool({
      ...baseEdit,
      async execute(toolCallId, params, signal, onUpdate, executeCtx) {
        const result = await baseEdit.execute(
          toolCallId,
          params,
          signal,
          onUpdate,
          executeCtx,
        );
        const patch = result.details?.patch;
        const parsed = patch ? parseUnifiedPatch(patch) : null;
        store.record({
          path: relative(ctx.cwd, params.path),
          hunks: parsed?.hunks ?? [],
          added: parsed?.added ?? 0,
          removed: parsed?.removed ?? 0,
          isNew: false,
          origin: SELF,
          at: Date.now(),
        });
        return result;
      },
      renderResult(result, options, theme, context) {
        // A failure must never be collapsed: that is exactly the output the
        // user needs. Same for the expanded view — ctrl+o still works.
        if (context.isError || options.expanded) {
          return baseEdit.renderResult!(result, options, theme, context);
        }
        const change = store.get(relative(context.cwd, context.args.path));
        if (!change) {
          return baseEdit.renderResult!(result, options, theme, context);
        }
        return {
          render: (width: number) => renderCollapsedRow(change, width, theme),
          invalidate: () => {},
        };
      },
    });

    pi.registerTool({
      ...baseWrite,
      async execute(toolCallId, params, signal, onUpdate, executeCtx) {
        const target = path.isAbsolute(params.path)
          ? params.path
          : path.join(ctx.cwd, params.path);
        const isNew = !fs.existsSync(target);
        const result = await baseWrite.execute(
          toolCallId,
          params,
          signal,
          onUpdate,
          executeCtx,
        );
        // write has no details, so the counts come from the content itself.
        store.record({
          path: relative(ctx.cwd, params.path),
          hunks: [],
          added: params.content.split("\n").length,
          removed: 0,
          isNew,
          origin: SELF,
          at: Date.now(),
        });
        return result;
      },
      renderResult(result, options, theme, context) {
        if (context.isError || options.expanded) {
          return baseWrite.renderResult!(result, options, theme, context);
        }
        const change = store.get(relative(context.cwd, context.args.path));
        if (!change) {
          return baseWrite.renderResult!(result, options, theme, context);
        }
        return {
          render: (width: number) => renderCollapsedRow(change, width, theme),
          invalidate: () => {},
        };
      },
    });

    updateStatus();
  });

  pi.on("session_shutdown", () => {
    try {
      ui?.setStatus(STATUS_KEY, undefined);
    } catch {
      // Teardown races are not worth reporting.
    }
    ui = undefined;
  });
}
```

> **If `baseWrite.renderResult` is undefined** (the write tool may rely purely
> on the default shell renderer), guard both fallbacks with
> `baseWrite.renderResult?.(…) ?? { render: () => [], invalidate: () => {} }`
> — check the value at runtime before assuming the `!`.

- [ ] **Step 2: Type-check**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && npm run check
```

Expected: exit 0. If `result.details` is typed `EditToolDetails | undefined`,
the optional chaining above already handles it.

- [ ] **Step 3: Verify in a real session**

```bash
cd pi-agent && cp -R dot-pi/agent/. ~/.pi/agent/
```

Start `pi` in a scratch git repo, ask it to edit a file, and confirm: the
transcript shows the two-line row with an icon and counts, `ctrl+o` still
expands to the full built-in diff, the status bar above the prompt shows
`󰈔 1 file`, and a deliberately failing edit (bad `oldText`) still shows the
full error.

- [ ] **Step 4: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/file-edits/index.ts
git commit -m "feat: collapse edit and write rows in the transcript"
```

---

# Phase 3 — The picker

## Task 11: Picker rows and filtering

**Files:**
- Create: `pi-agent/dot-pi/agent/extensions/file-edits/src/ui/picker-rows.ts`
- Test: `pi-agent/dot-pi/agent/extensions/file-edits/src/ui/picker-rows.test.ts`

Separating row formatting from the component keeps the layout testable without
a terminal.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { filterChanges, formatAge, renderPickerRow } from "./picker-rows.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as never;

const change = {
  path: "src/router.ts",
  hunks: [],
  added: 12,
  removed: 4,
  edits: 2,
  isNew: false,
  updatedAt: 1_000_000,
  origin: { kind: "self" } as const,
  hunksPending: false,
};

test("a row carries path, counts, edit count and age", () => {
  const row = renderPickerRow(change, 80, theme, 1_031_000);
  assert.match(row, /src\/router\.ts/);
  assert.match(row, /\+12/);
  assert.match(row, /−4/);
  assert.match(row, /2 edits/);
  assert.match(row, /0:31 ago/);
});

test("one edit is singular", () => {
  const row = renderPickerRow({ ...change, edits: 1 }, 80, theme, 1_000_000);
  assert.match(row, /1 edit\b/);
});

test("new files say so instead of counting edits", () => {
  const row = renderPickerRow({ ...change, isNew: true }, 80, theme, 1_000_000);
  assert.match(row, /new file/);
});

test("child-session origins are tagged", () => {
  const row = renderPickerRow(
    { ...change, origin: { kind: "subagent", id: "sa-2", name: "sa-2" } },
    80,
    theme,
    1_000_000,
  );
  assert.match(row, /sa-2/);
});

test("rows never exceed the width", () => {
  assert.ok(renderPickerRow(change, 40, theme, 1_000_000).length <= 40);
});

test("formatAge counts up in mm:ss then minutes", () => {
  assert.equal(formatAge(0), "0:00 ago");
  assert.equal(formatAge(31_000), "0:31 ago");
  assert.equal(formatAge(3_600_000), "60:00 ago");
});

test("filtering is fuzzy and case-insensitive", () => {
  const changes = [change, { ...change, path: "docs/design.md" }];
  assert.deepEqual(
    filterChanges(changes, "rtr").map((item) => item.path),
    ["src/router.ts"],
  );
  assert.deepEqual(
    filterChanges(changes, "DESIGN").map((item) => item.path),
    ["docs/design.md"],
  );
  assert.equal(filterChanges(changes, "").length, 2);
  assert.equal(filterChanges(changes, "zzz").length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && node --test --experimental-strip-types src/ui/picker-rows.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/ui/picker-rows.ts`:

```ts
/**
 * Row layout and filtering for the picker, kept apart from the component so
 * both are testable without a terminal.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fuzzyFilter, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { describeOrigin, type FileChange } from "../domain.ts";
import { iconFor, paintIcon } from "../icons.ts";

type Theme = ExtensionContext["ui"]["theme"];

export function formatAge(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")} ago`;
}

export function filterChanges(
  changes: ReadonlyArray<FileChange>,
  query: string,
): ReadonlyArray<FileChange> {
  if (!query.trim()) return changes;
  const matches = fuzzyFilter(
    changes.map((change) => change.path),
    query,
  );
  const ranked = new Set(matches.map((match) => match.text ?? match));
  return changes.filter((change) => ranked.has(change.path));
}

export function renderPickerRow(
  change: FileChange,
  width: number,
  theme: Theme,
  now: number,
): string {
  const left = `${paintIcon(iconFor(change.path))} ${theme.fg("text", change.path)}`;

  const counts = [
    change.added > 0 ? theme.fg("toolDiffAdded", `+${change.added}`) : "",
    change.removed > 0 ? theme.fg("toolDiffRemoved", `−${change.removed}`) : "",
  ]
    .filter(Boolean)
    .join(" ");

  const detail = change.isNew
    ? theme.fg("success", "new file")
    : theme.fg("muted", `${change.edits} edit${change.edits === 1 ? "" : "s"}`);

  const origin = describeOrigin(change.origin);
  const tail = origin
    ? theme.fg("accent", origin)
    : theme.fg("dim", formatAge(now - change.updatedAt));

  const right = `${counts}  ${detail}  ${tail}`;
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  return truncateToWidth(
    `${left}${" ".repeat(gap)}${right}`,
    width,
    theme.fg("dim", "…"),
  );
}
```

> **`fuzzyFilter`'s exact return shape** is `FuzzyMatch[]` from
> `@earendil-works/pi-tui`. Before running the tests, open its declaration
> (`pi-tui/dist/fuzzy.d.ts`) and adjust the `match.text ?? match` line to the
> real property name. Do not guess — read it.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && node --test --experimental-strip-types src/ui/picker-rows.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Add the file to the test script and commit**

Update the `test` script in `package.json` to include
`src/ui/picker-rows.test.ts`, then:

```bash
git add pi-agent/dot-pi/agent/extensions/file-edits
git commit -m "feat: lay out and filter picker rows"
```

---

## Task 12: The picker overlay

**Files:**
- Create: `pi-agent/dot-pi/agent/extensions/file-edits/src/ui/picker.ts`
- Modify: `pi-agent/dot-pi/agent/extensions/file-edits/index.ts`

- [ ] **Step 1: Read the pattern you are copying**

Read `background-terminals/src/ui/ps.ts:124-268` in full. `FilePicker` below
follows the same shape: constructor wires a subscription, `cleanup`/`close`/
`dispose`, `handleInput`, and a `render` that draws its own border.

- [ ] **Step 2: Write the component**

Create `src/ui/picker.ts`:

```ts
/**
 * The picker: every file changed this session, filterable, most recent first.
 *
 * Hand-rolled rather than built on SelectList because the rows need four
 * columns (icon, path, counts, origin/age) and SelectList's item model is a
 * fixed label/description pair.
 */

import type {
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { FileChange } from "../domain.ts";
import type { FileEditStore } from "../store.ts";
import { filterChanges, renderPickerRow } from "./picker-rows.ts";

type Theme = ExtensionContext["ui"]["theme"];
type Keybindings = Parameters<
  Parameters<ExtensionContext["ui"]["custom"]>[0]
>[2];

class FilePicker implements Component {
  private query = "";
  private index = 0;
  private closed = false;
  private unsubscribe: () => void;

  constructor(
    private tui: TUI,
    private theme: Theme,
    private keybindings: Keybindings,
    private store: FileEditStore,
    private done: (value: string | null) => void,
  ) {
    this.unsubscribe = store.subscribe(() => this.tui.requestRender());
  }

  private rows(): ReadonlyArray<FileChange> {
    return filterChanges(this.store.list(), this.query);
  }

  private cleanup() {
    if (this.closed) return false;
    this.closed = true;
    this.unsubscribe();
    return true;
  }

  private close(result: string | null) {
    if (this.cleanup()) this.done(result);
  }

  dispose(): void {
    this.cleanup();
  }

  invalidate(): void {}

  handleInput(data: string): void {
    const rows = this.rows();

    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.close(null);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.confirm")) {
      const picked = rows[this.index];
      if (picked) this.close(picked.path);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.up")) {
      if (rows.length > 0) {
        this.index = (this.index - 1 + rows.length) % rows.length;
        this.tui.requestRender();
      }
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down")) {
      if (rows.length > 0) {
        this.index = (this.index + 1) % rows.length;
        this.tui.requestRender();
      }
      return;
    }
    // Backspace, then any printable character, edit the filter. Arrow keys
    // are already handled above, so this only sees real text.
    if (data === "\x7f" || data === "\b") {
      this.query = this.query.slice(0, -1);
      this.index = 0;
      this.tui.requestRender();
      return;
    }
    if (data.length === 1 && data >= " " && data !== "\x1b") {
      this.query += data;
      this.index = 0;
      this.tui.requestRender();
    }
  }

  render(width: number): string[] {
    const theme = this.theme;
    const rows = this.rows();
    if (this.index >= rows.length) this.index = Math.max(0, rows.length - 1);

    const inner = width - 2;
    const totals = this.store.totals();
    const now = Date.now();

    const title = theme.fg("accent", " files changed ");
    const summary = theme.fg(
      "muted",
      ` ${totals.files} files  ${theme.fg("toolDiffAdded", `+${totals.added}`)} ${theme.fg("toolDiffRemoved", `−${totals.removed}`)} `,
    );
    const fillWidth = Math.max(
      0,
      inner - visibleWidth(title) - visibleWidth(summary),
    );

    const lines: string[] = [
      theme.fg("border", "╭─") +
        title +
        theme.fg("border", "─".repeat(fillWidth)) +
        summary +
        theme.fg("border", "─╮"),
    ];

    const maxVisible = Math.max(3, (this.tui.terminal.rows || 30) - 8);
    const start = Math.max(0, Math.min(this.index - 2, rows.length - maxVisible));
    const visible = rows.slice(start, start + maxVisible);

    if (visible.length === 0) {
      lines.push(
        theme.fg("border", "│ ") +
          truncateToWidth(theme.fg("dim", "no matching files"), inner - 1) +
          theme.fg("border", " │"),
      );
    }

    visible.forEach((change, offset) => {
      const selected = start + offset === this.index;
      const marker = selected ? theme.fg("accent", "› ") : "  ";
      const body = renderPickerRow(change, inner - 3, theme, now);
      const padding = " ".repeat(
        Math.max(0, inner - 3 - visibleWidth(body)),
      );
      lines.push(
        theme.fg("border", "│") +
          marker +
          body +
          padding +
          theme.fg("border", "│"),
      );
    });

    const hint = this.query
      ? theme.fg("accent", `filter: ${this.query}`)
      : theme.fg("dim", "type to filter · enter open · esc close");
    lines.push(
      theme.fg("border", "╰─ ") +
        hint +
        theme.fg(
          "border",
          "─".repeat(Math.max(0, inner - visibleWidth(hint) - 2)),
        ) +
        theme.fg("border", "╯"),
    );

    return lines;
  }
}

/** Returns the chosen path, or null when the user cancelled. */
export async function openFilePicker(
  ctx: ExtensionCommandContext,
  store: FileEditStore,
): Promise<string | null> {
  if (store.size() === 0) {
    ctx.ui.notify("No files changed yet", "info");
    return null;
  }
  return ctx.ui.custom<string | null>(
    (tui, theme, keybindings, done) =>
      new FilePicker(tui, theme, keybindings, store, done),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
    },
  );
}
```

- [ ] **Step 3: Wire the command and the shortcut**

In `file-edits/index.ts`, add the import:

```ts
import { openFilePicker } from "./src/ui/picker.ts";
```

and register both entry points inside the default export, after the tool
registrations:

```ts
  pi.registerCommand("files", {
    description: "Browse files changed in this session",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") return;
      await openFilePicker(ctx, store);
    },
  });

  pi.registerShortcut("ctrl+f", {
    description: "Browse changed files",
    handler: async (ctx) => {
      if (ctx.mode !== "tui") return;
      await openFilePicker(ctx, store);
    },
  });
```

- [ ] **Step 4: Type-check and verify**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && npm run check && npm test
cd ../../../.. && cp -R pi-agent/dot-pi/agent/. ~/.pi/agent/
```

Start `pi`, make two edits, press `ctrl+f`. Confirm: the list appears, typing
filters it, `↑`/`↓` move the cursor, `esc` closes, and Enter closes it
returning a path (nothing opens yet — that is Task 14).

**If `ctrl+f` conflicts with a built-in binding**, pi logs a warning at
startup (`runner.js:334-338`). Switch the shortcut to `ctrl+shift+f` and note
the change in the README table.

- [ ] **Step 5: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/file-edits
git commit -m "feat: browse changed files with ctrl+f"
```

---

# Phase 4 — The diff viewer

## Task 13: Pair rows for the split layout

**Files:**
- Modify: `pi-agent/dot-pi/agent/extensions/file-edits/src/diff.ts`
- Modify: `pi-agent/dot-pi/agent/extensions/file-edits/src/diff.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/diff.test.ts`:

```ts
import { pairRows } from "./diff.ts";

test("context lines appear on both sides of a split", () => {
  const { hunks } = parseUnifiedPatch(`@@ -1,1 +1,1 @@\n a\n`)!;
  assert.deepEqual(
    pairRows(hunks).map((row) => [row.left?.text, row.right?.text]),
    [["a", "a"]],
  );
});

test("a removal and an addition line up on one row", () => {
  const { hunks } = parseUnifiedPatch(`@@ -1,1 +1,1 @@\n-old\n+new\n`)!;
  assert.deepEqual(
    pairRows(hunks).map((row) => [row.left?.text, row.right?.text]),
    [["old", "new"]],
  );
});

test("extra additions get empty left cells", () => {
  const { hunks } = parseUnifiedPatch(`@@ -1,1 +1,3 @@\n-old\n+a\n+b\n+c\n`)!;
  assert.deepEqual(
    pairRows(hunks).map((row) => [row.left?.text, row.right?.text]),
    [
      ["old", "a"],
      [undefined, "b"],
      [undefined, "c"],
    ],
  );
});

test("extra removals get empty right cells", () => {
  const { hunks } = parseUnifiedPatch(`@@ -1,3 +1,1 @@\n-a\n-b\n+c\n`)!;
  assert.deepEqual(
    pairRows(hunks).map((row) => [row.left?.text, row.right?.text]),
    [
      ["a", "c"],
      ["b", undefined],
    ],
  );
});

test("hunks are separated by a gap row", () => {
  const { hunks } = parseUnifiedPatch(
    `@@ -1,1 +1,1 @@\n a\n@@ -9,1 +9,1 @@\n b\n`,
  )!;
  const rows = pairRows(hunks);
  assert.equal(rows.length, 3);
  assert.equal(rows[1]!.separator, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && node --test --experimental-strip-types src/diff.test.ts
```

Expected: FAIL — `pairRows` is not exported.

- [ ] **Step 3: Add the implementation**

Append to `src/diff.ts`:

```ts
/** One screen row of the split view: the old side, the new side, or both. */
export interface SplitRow {
  readonly left?: DiffLine;
  readonly right?: DiffLine;
  /** A gap between hunks, drawn as a divider rather than as content. */
  readonly separator?: true;
}

/**
 * Pair removals with additions so a change occupies the same screen row on
 * both sides. This is why the panes are composed per row rather than built
 * from two independent HStack children.
 */
export function pairRows(hunks: ReadonlyArray<Hunk>): SplitRow[] {
  const rows: SplitRow[] = [];

  hunks.forEach((hunk, index) => {
    if (index > 0) rows.push({ separator: true });

    let removals: DiffLine[] = [];
    let additions: DiffLine[] = [];

    const drain = () => {
      const height = Math.max(removals.length, additions.length);
      for (let offset = 0; offset < height; offset += 1) {
        rows.push({ left: removals[offset], right: additions[offset] });
      }
      removals = [];
      additions = [];
    };

    for (const line of hunk.lines) {
      if (line.kind === "remove") removals.push(line);
      else if (line.kind === "add") additions.push(line);
      else {
        drain();
        rows.push({ left: line, right: line });
      }
    }
    drain();
  });

  return rows;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && node --test --experimental-strip-types src/diff.test.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/file-edits/src/diff.ts pi-agent/dot-pi/agent/extensions/file-edits/src/diff.test.ts
git commit -m "feat: pair diff rows for the split layout"
```

---

## Task 14: The viewer overlay

**Files:**
- Create: `pi-agent/dot-pi/agent/extensions/file-edits/src/ui/viewer.ts`
- Modify: `pi-agent/dot-pi/agent/extensions/file-edits/src/ui/picker.ts` (export a loop)
- Modify: `pi-agent/dot-pi/agent/extensions/file-edits/index.ts`

- [ ] **Step 1: Write the component**

Create `src/ui/viewer.ts`:

```ts
/**
 * The diff viewer: unified by default, side-by-side on `s`.
 *
 * Split falls back to unified below MIN_SPLIT_WIDTH — two 40-column panes of
 * code are unreadable, and silently showing them would be worse than saying
 * why.
 */

import type {
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { pairRows, type SplitRow } from "../diff.ts";
import type { DiffLine, FileChange } from "../domain.ts";
import { iconFor, paintIcon } from "../icons.ts";
import type { FileEditStore } from "../store.ts";

type Theme = ExtensionContext["ui"]["theme"];
type Keybindings = Parameters<
  Parameters<ExtensionContext["ui"]["custom"]>[0]
>[2];

export type ViewMode = "stacked" | "split";

/** Below this, two panes of code are unreadable. */
const MIN_SPLIT_WIDTH = 90;

/** Survives one viewer instance so the choice is made once per session. */
export interface ViewerState {
  mode: ViewMode;
}

/** What the viewer returns: a sibling to open, or null to go back. */
export type ViewerExit = { readonly next: string } | null;

function lineColor(kind: DiffLine["kind"]) {
  if (kind === "add") return "toolDiffAdded" as const;
  if (kind === "remove") return "toolDiffRemoved" as const;
  return "toolDiffContext" as const;
}

function marker(kind: DiffLine["kind"]) {
  if (kind === "add") return "+";
  if (kind === "remove") return "−";
  return " ";
}

class DiffViewer implements Component {
  private offset = 0;
  private closed = false;
  private unsubscribe: () => void;

  constructor(
    private tui: TUI,
    private theme: Theme,
    private keybindings: Keybindings,
    private store: FileEditStore,
    private path: string,
    private state: ViewerState,
    private done: (value: ViewerExit) => void,
  ) {
    this.unsubscribe = store.subscribe(() => this.tui.requestRender());
  }

  private change(): FileChange | undefined {
    return this.store.get(this.path);
  }

  private cleanup() {
    if (this.closed) return false;
    this.closed = true;
    this.unsubscribe();
    return true;
  }

  private close(result: ViewerExit) {
    if (this.cleanup()) this.done(result);
  }

  dispose(): void {
    this.cleanup();
  }

  invalidate(): void {}

  private sibling(step: number): string | undefined {
    const paths = this.store.list().map((change) => change.path);
    const current = paths.indexOf(this.path);
    if (current === -1 || paths.length === 0) return undefined;
    return paths[(current + step + paths.length) % paths.length];
  }

  handleInput(data: string): void {
    if (
      this.keybindings.matches(data, "tui.select.cancel") ||
      data === "q"
    ) {
      this.close(null);
      return;
    }
    if (data === "s") {
      this.state.mode = this.state.mode === "split" ? "stacked" : "split";
      this.tui.requestRender();
      return;
    }
    if (data === "n" || data === "p") {
      const next = this.sibling(data === "n" ? 1 : -1);
      if (next) this.close({ next });
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down") || data === "j") {
      this.offset += 1;
      this.tui.requestRender();
      return;
    }
    if (this.keybindings.matches(data, "tui.select.up") || data === "k") {
      this.offset = Math.max(0, this.offset - 1);
      this.tui.requestRender();
    }
  }

  private stackedLines(change: FileChange, width: number): string[] {
    const lines: string[] = [];
    change.hunks.forEach((hunk, index) => {
      if (index > 0) lines.push(this.theme.fg("dim", "─".repeat(width)));
      for (const line of hunk.lines) {
        const number = line.newLine ?? line.oldLine ?? 0;
        lines.push(
          truncateToWidth(
            this.theme.fg("dim", String(number).padStart(4)) +
              " " +
              this.theme.fg(
                lineColor(line.kind),
                `${marker(line.kind)} ${line.text}`,
              ),
            width,
          ),
        );
      }
    });
    return lines;
  }

  private splitLines(change: FileChange, width: number): string[] {
    const pane = Math.floor((width - 1) / 2);
    const cell = (line: DiffLine | undefined) => {
      if (!line) return " ".repeat(pane);
      const body = truncateToWidth(
        this.theme.fg("dim", String(line.newLine ?? line.oldLine ?? 0).padStart(4)) +
          " " +
          this.theme.fg(lineColor(line.kind), line.text),
        pane,
      );
      return body + " ".repeat(Math.max(0, pane - visibleWidth(body)));
    };

    return pairRows(change.hunks).map((row: SplitRow) =>
      row.separator
        ? this.theme.fg("dim", "─".repeat(width))
        : `${cell(row.left)}${this.theme.fg("border", "│")}${cell(row.right)}`,
    );
  }

  render(width: number): string[] {
    const theme = this.theme;
    const change = this.change();
    const inner = width - 2;

    const narrow = width < MIN_SPLIT_WIDTH;
    const mode: ViewMode = narrow ? "stacked" : this.state.mode;

    const label = (name: ViewMode) =>
      name === mode
        ? theme.bold(theme.fg("accent", `[${name}]`))
        : theme.fg("dim", name);

    const heading =
      `${paintIcon(iconFor(this.path))} ${theme.bold(theme.fg("text", this.path))} ` +
      (change
        ? `${theme.fg("toolDiffAdded", `+${change.added}`)} ${theme.fg("toolDiffRemoved", `−${change.removed}`)} `
        : "") +
      `${label("stacked")} ${label("split")}` +
      (narrow ? theme.fg("dim", "  (too narrow to split)") : "");

    const lines: string[] = [
      theme.fg("border", "╭─ ") +
        truncateToWidth(heading, inner - 2) +
        theme.fg("border", " ─╮"),
    ];

    const body = !change
      ? [theme.fg("dim", "file is no longer tracked")]
      : change.hunksPending
        ? [theme.fg("dim", "no diff available for this file")]
        : mode === "split"
          ? this.splitLines(change, inner - 2)
          : this.stackedLines(change, inner - 2);

    const height = Math.max(4, (this.tui.terminal.rows || 30) - 6);
    this.offset = Math.max(0, Math.min(this.offset, Math.max(0, body.length - height)));

    for (const line of body.slice(this.offset, this.offset + height)) {
      const padding = " ".repeat(Math.max(0, inner - 2 - visibleWidth(line)));
      lines.push(
        theme.fg("border", "│ ") + line + padding + theme.fg("border", " │"),
      );
    }

    const hint = theme.fg(
      "dim",
      "s split · n/p file · j/k scroll · q close",
    );
    lines.push(
      theme.fg("border", "╰─ ") +
        hint +
        theme.fg(
          "border",
          "─".repeat(Math.max(0, inner - visibleWidth(hint) - 2)),
        ) +
        theme.fg("border", "╯"),
    );

    return lines;
  }
}

export function createViewerState(): ViewerState {
  return { mode: "stacked" };
}

export async function openDiffViewer(
  ctx: ExtensionCommandContext,
  store: FileEditStore,
  path: string,
  state: ViewerState,
): Promise<ViewerExit> {
  return ctx.ui.custom<ViewerExit>(
    (tui, theme, keybindings, done) =>
      new DiffViewer(tui, theme, keybindings, store, path, state, done),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
    },
  );
}
```

- [ ] **Step 2: Loop the picker and the viewer together**

Add to `src/ui/picker.ts`:

```ts
import { createViewerState, openDiffViewer, type ViewerState } from "./viewer.ts";

/**
 * Picker → viewer → picker, the same two-stage loop /ps uses. `n`/`p` inside
 * the viewer move between files without returning to the list.
 */
export async function browseChangedFiles(
  ctx: ExtensionCommandContext,
  store: FileEditStore,
  state: ViewerState = createViewerState(),
) {
  while (true) {
    const picked = await openFilePicker(ctx, store);
    if (!picked) return;

    let current: string | null = picked;
    while (current) {
      const exit = await openDiffViewer(ctx, store, current, state);
      current = exit ? exit.next : null;
    }
  }
}
```

- [ ] **Step 3: Point the command and shortcut at the loop**

In `index.ts`, replace the two `openFilePicker(ctx, store)` calls with
`browseChangedFiles(ctx, store, viewerState)`, change the import to
`import { browseChangedFiles } from "./src/ui/picker.ts";`, add
`import { createViewerState } from "./src/ui/viewer.ts";`, and create the
session-scoped state beside `store`:

```ts
  const viewerState = createViewerState();
```

- [ ] **Step 4: Type-check and verify**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && npm run check && npm test
cd ../../../.. && cp -R pi-agent/dot-pi/agent/. ~/.pi/agent/
```

In a real session with several edits: `ctrl+f`, Enter on a file. Confirm the
unified diff renders with correct line numbers and colors, `s` switches to
side-by-side with changes aligned across the divider, `n`/`p` walk between
files, `j`/`k` scroll, `q` returns to the picker, and a terminal narrower than
90 columns shows `(too narrow to split)` and stays unified.

- [ ] **Step 5: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/file-edits
git commit -m "feat: read diffs stacked or split"
```

---

## Task 15: Word-level intra-line highlighting

A replaced line should show *what* changed inside it, not just that it changed.
The built-in renderer uses `diffWords` from the `diff` package; this extension
has no dependencies, so the same effect comes from a small LCS over word
tokens — pure, and testable without a terminal.

**Files:**
- Create: `pi-agent/dot-pi/agent/extensions/file-edits/src/intraline.ts`
- Test: `pi-agent/dot-pi/agent/extensions/file-edits/src/intraline.test.ts`
- Modify: `pi-agent/dot-pi/agent/extensions/file-edits/src/ui/viewer.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { wordSpans } from "./intraline.ts";

test("identical lines have no changed spans", () => {
  assert.deepEqual(
    wordSpans("return ranked[0]", "return ranked[0]").removed.filter((span) => span.changed),
    [],
  );
});

test("a changed tail is marked on both sides", () => {
  const { removed, added } = wordSpans("return ranked[0]", "return pickModel(x)");
  assert.equal(removed.map((span) => span.text).join(""), "return ranked[0]");
  assert.equal(added.map((span) => span.text).join(""), "return pickModel(x)");
  assert.equal(removed.find((span) => span.changed)?.text.includes("ranked"), true);
  assert.equal(added.find((span) => span.changed)?.text.includes("pickModel"), true);
});

test("a shared prefix stays unchanged", () => {
  const { added } = wordSpans("const a = 1", "const a = 2");
  assert.equal(added[0]?.changed, false);
  assert.match(added.filter((span) => span.changed).map((span) => span.text).join(""), /2/);
});

test("wholly different lines are entirely changed", () => {
  const { removed, added } = wordSpans("aaa", "bbb");
  assert.ok(removed.every((span) => span.changed));
  assert.ok(added.every((span) => span.changed));
});

test("spans always reconstruct the original text", () => {
  const before = "  if (!model) throw new Error('x')";
  const after = "  if (!model) throw new NoModelError(effort)";
  const { removed, added } = wordSpans(before, after);
  assert.equal(removed.map((span) => span.text).join(""), before);
  assert.equal(added.map((span) => span.text).join(""), after);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && node --test --experimental-strip-types src/intraline.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/intraline.ts`:

```ts
/**
 * Word-level diff within a replaced line, so the eye lands on the part that
 * actually changed.
 *
 * The built-in renderer uses the `diff` package; this extension carries no
 * dependencies, so this is a plain LCS over word tokens. Lines are short, so
 * the quadratic table costs nothing.
 */

export interface Span {
  readonly text: string;
  readonly changed: boolean;
}

export interface WordSpans {
  readonly removed: ReadonlyArray<Span>;
  readonly added: ReadonlyArray<Span>;
}

/** Split into words and the runs of punctuation/space between them, so
 * rebuilt spans are byte-identical to the input. */
function tokenize(line: string): string[] {
  return line.match(/\w+|\W/g) ?? [];
}

function merge(tokens: string[], changed: boolean[]): Span[] {
  const spans: Span[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const last = spans[spans.length - 1];
    if (last && last.changed === changed[index]) {
      spans[spans.length - 1] = {
        text: last.text + tokens[index]!,
        changed: last.changed,
      };
    } else {
      spans.push({ text: tokens[index]!, changed: changed[index]! });
    }
  }
  return spans;
}

export function wordSpans(before: string, after: string): WordSpans {
  const left = tokenize(before);
  const right = tokenize(after);

  // lengths[i][j] = LCS length of left[i..] and right[j..]
  const lengths: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i]![j] =
        left[i] === right[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }

  const leftChanged = new Array<boolean>(left.length).fill(true);
  const rightChanged = new Array<boolean>(right.length).fill(true);

  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      leftChanged[i] = false;
      rightChanged[j] = false;
      i += 1;
      j += 1;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }

  return {
    removed: merge(left, leftChanged),
    added: merge(right, rightChanged),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && node --test --experimental-strip-types src/intraline.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Use it in the viewer**

In `src/ui/viewer.ts`, import the helper:

```ts
import { wordSpans } from "../intraline.ts";
```

Add a method that paints one line, inverting only the changed spans — the
same emphasis the built-in diff renderer uses:

```ts
  /** Paint a line, inverting the words that differ from its counterpart. */
  private paint(line: DiffLine, counterpart: string | undefined): string {
    const color = lineColor(line.kind);
    if (counterpart === undefined || line.kind === "context") {
      return this.theme.fg(color, line.text);
    }
    const spans =
      line.kind === "remove"
        ? wordSpans(line.text, counterpart).removed
        : wordSpans(counterpart, line.text).added;
    return spans
      .map((span) =>
        span.changed
          ? this.theme.inverse(this.theme.fg(color, span.text))
          : this.theme.fg(color, span.text),
      )
      .join("");
  }
```

In `splitLines`, pass the opposite cell's text as the counterpart:

```ts
    return pairRows(change.hunks).map((row: SplitRow) =>
      row.separator
        ? this.theme.fg("dim", "─".repeat(width))
        : `${cell(row.left, row.right?.text)}${this.theme.fg("border", "│")}${cell(row.right, row.left?.text)}`,
    );
```

and widen `cell` to `(line: DiffLine | undefined, counterpart: string | undefined)`,
replacing its `this.theme.fg(lineColor(line.kind), line.text)` with
`this.paint(line, counterpart)`.

In `stackedLines`, a removal's counterpart is the next `add` line in the same
hunk (and an addition's is the preceding `remove`); when there is no such
neighbour, pass `undefined` and the line paints flat.

- [ ] **Step 6: Verify and commit**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && npm run check && npm test
```

Add `src/intraline.test.ts` to the `test` script first. Then check visually
that a one-word change highlights only that word, in both layouts.

```bash
git add pi-agent/dot-pi/agent/extensions/file-edits
git commit -m "feat: highlight the words that changed inside a line"
```

---

# Phase 5 — Child-session edits

## Task 16: Publish child edits to the parent

`ToolExecutionEndEvent` carries only `result` (`types.d.ts:594-600`), so the
diff cannot be lifted from the stream. The path can: it is in the child's
`tool_execution_start` args.

**Files:**
- Modify: `pi-agent/dot-pi/agent/extensions/shared/dashboard-state.ts`
- Modify: `pi-agent/dot-pi/agent/extensions/subagents/src/backends/pi.ts:452-458`
- Modify: `pi-agent/dot-pi/agent/extensions/workflows/runner.ts` (near line 547)
- Create: `pi-agent/dot-pi/agent/extensions/file-edits/src/observe.ts`
- Test: `pi-agent/dot-pi/agent/extensions/file-edits/src/observe.test.ts`

- [ ] **Step 1: Add the channel**

Append to `shared/dashboard-state.ts`:

```ts
/** A file changed by a child session (subagent or workflow), announced to the
 * parent so its picker can list it. The diff is not carried: tool_execution_end
 * has no details, so the viewer computes it against git HEAD on demand. */
export const CHILD_FILE_CHANNEL = "dashboard:child-file";

export interface ChildFileEvent {
  readonly path: string;
  readonly origin:
    | { readonly kind: "subagent"; readonly id: string; readonly name: string }
    | { readonly kind: "workflow"; readonly label: string };
}

export function isChildFileEvent(value: unknown): value is ChildFileEvent {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ChildFileEvent>;
  return (
    typeof candidate.path === "string" &&
    typeof candidate.origin === "object" &&
    candidate.origin !== null
  );
}
```

- [ ] **Step 2: Write the failing test for the observer**

Create `file-edits/src/observe.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createFileEditStore } from "./store.ts";
import { observeChildFiles } from "./observe.ts";

function bus() {
  const handlers = new Map<string, (value: unknown) => void>();
  return {
    on(channel: string, handler: (value: unknown) => void) {
      handlers.set(channel, handler);
      return () => handlers.delete(channel);
    },
    emit(channel: string, value: unknown) {
      handlers.get(channel)?.(value);
    },
  };
}

test("a child file event lands in the store as pending", () => {
  const store = createFileEditStore();
  const events = bus();
  observeChildFiles(events as never, store, "/repo");
  events.emit("dashboard:child-file", {
    path: "/repo/src/a.ts",
    origin: { kind: "subagent", id: "sa-2", name: "sa-2" },
  });
  const change = store.get("src/a.ts")!;
  assert.equal(change.hunksPending, true);
  assert.equal(change.origin.kind, "subagent");
});

test("malformed events are ignored", () => {
  const store = createFileEditStore();
  const events = bus();
  observeChildFiles(events as never, store, "/repo");
  events.emit("dashboard:child-file", { nope: true });
  assert.equal(store.size(), 0);
});

test("unsubscribing stops recording", () => {
  const store = createFileEditStore();
  const events = bus();
  const stop = observeChildFiles(events as never, store, "/repo");
  stop();
  events.emit("dashboard:child-file", {
    path: "/repo/a.ts",
    origin: { kind: "workflow", label: "run" },
  });
  assert.equal(store.size(), 0);
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && node --test --experimental-strip-types src/observe.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write the observer**

Create `file-edits/src/observe.ts`:

```ts
/**
 * Child-session edits. Subagents and workflows announce the files they touch;
 * we record the path and who changed it. The diff arrives later, computed
 * against git HEAD, because tool_execution_end carries no details.
 */

import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  CHILD_FILE_CHANNEL,
  isChildFileEvent,
} from "../../shared/dashboard-state.ts";
import type { FileEditStore } from "./store.ts";

export function observeChildFiles(
  events: ExtensionAPI["events"],
  store: FileEditStore,
  cwd: string,
): () => void {
  return events.on(CHILD_FILE_CHANNEL, (value) => {
    if (!isChildFileEvent(value)) return;
    const absolute = path.isAbsolute(value.path)
      ? value.path
      : path.join(cwd, value.path);
    const relative = path.relative(cwd, absolute);
    store.recordExternal({
      path: relative.startsWith("..") ? absolute : relative,
      origin: value.origin,
      at: Date.now(),
    });
  });
}
```

- [ ] **Step 5: Emit from the subagents backend**

In `subagents/src/backends/pi.ts`, the `tool_execution_start` case currently
only emits a `ToolStart`. Add the announcement alongside it, using the raw
`event.args` before it is flattened:

```ts
        case "tool_execution_start":
          if (event.toolName === "edit" || event.toolName === "write") {
            const target = (event.args as { path?: unknown } | undefined)?.path;
            if (typeof target === "string") {
              pi.events.emit(CHILD_FILE_CHANNEL, {
                path: target,
                origin: { kind: "subagent", id: meta.id, name: meta.name },
              });
            }
          }
          emit({
            _tag: "ToolStart",
            toolId: event.toolCallId,
            name: event.toolName,
            argsPreview: safeJson(event.args),
          });
          break;
```

Import `CHILD_FILE_CHANNEL` from `../../../shared/dashboard-state.ts`. This
file does not currently hold a `pi` reference — thread the parent's
`ExtensionAPI["events"]` in through the backend's existing construction
options rather than reaching for a global, and read the surrounding code to
find the right seam. Use whatever identifiers the file already has for the
subagent's id and name in place of `meta.id` / `meta.name`.

- [ ] **Step 6: Emit from the workflow runner**

Apply the same treatment in `workflows/runner.ts` near line 547, where
`tool_execution_start` and `tool_execution_end` are already matched. Tag the
origin as `{ kind: "workflow", label: <the run or phase label the file already
tracks> }`.

- [ ] **Step 7: Subscribe in file-edits**

In `file-edits/index.ts`, add the import and wire it in `session_start`,
storing the unsubscribe for `session_shutdown`:

```ts
import { observeChildFiles } from "./src/observe.ts";
```

```ts
  let stopChildFiles: (() => void) | undefined;
  // inside session_start:
  stopChildFiles = observeChildFiles(pi.events, store, ctx.cwd);
  // inside session_shutdown:
  stopChildFiles?.();
  stopChildFiles = undefined;
```

- [ ] **Step 8: Run the tests, add the file to the test script, and commit**

Add `src/observe.test.ts` to the `test` script in `package.json`, then:

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && npm run check && npm test
cd ../subagents && npm run check && npm test
cd ../.. && npx tsc --noEmit -p . 2>&1 | grep -E "extensions/(workflows|shared)/"
```

Expected: both suites PASS; the `grep` prints nothing (`workflows` has no
`package.json`, so it is only checked by the agent-root project).

```bash
git add pi-agent/dot-pi/agent/extensions
git commit -m "feat: list files changed by subagents and workflows"
```

---

## Task 17: Compute child diffs against HEAD

**Files:**
- Create: `pi-agent/dot-pi/agent/extensions/file-edits/src/git-diff.ts`
- Test: `pi-agent/dot-pi/agent/extensions/file-edits/src/git-diff.test.ts`
- Modify: `pi-agent/dot-pi/agent/extensions/file-edits/src/ui/viewer.ts`

- [ ] **Step 1: Write the failing test**

Create `src/git-diff.test.ts`:

```ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { diffAgainstHead } from "./git-diff.ts";

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "file-edits-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
  git("add", "a.txt");
  git("commit", "-qm", "init");
  return { dir, git };
}

test("returns hunks for a file modified since HEAD", () => {
  const { dir } = repo();
  writeFileSync(join(dir, "a.txt"), "one\nTWO\n");
  const result = diffAgainstHead(dir, "a.txt");
  assert.ok(result);
  assert.equal(result.added, 1);
  assert.equal(result.removed, 1);
});

test("returns null for an unchanged file", () => {
  const { dir } = repo();
  assert.equal(diffAgainstHead(dir, "a.txt"), null);
});

test("returns null outside a git repository", () => {
  const dir = mkdtempSync(join(tmpdir(), "file-edits-nogit-"));
  writeFileSync(join(dir, "a.txt"), "x\n");
  assert.equal(diffAgainstHead(dir, "a.txt"), null);
});

test("an untracked file reports every line as added", () => {
  const { dir } = repo();
  writeFileSync(join(dir, "b.txt"), "x\ny\n");
  const result = diffAgainstHead(dir, "b.txt");
  assert.equal(result?.added, 2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && node --test --experimental-strip-types src/git-diff.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/git-diff.ts`:

```ts
/**
 * The fallback diff for changes we did not make ourselves.
 *
 * Child sessions report which file they touched but not how, so the viewer
 * asks git. The baseline is HEAD rather than the pre-edit buffer, which is
 * the honest thing to show for work done elsewhere.
 */

import { execFileSync } from "node:child_process";
import { parseUnifiedPatch, type ParsedPatch } from "./diff.ts";

export function diffAgainstHead(
  cwd: string,
  relativePath: string,
): ParsedPatch | null {
  const run = (args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 8 * 1024 * 1024,
    });

  try {
    // --no-index against /dev/null covers untracked files, which plain
    // `git diff HEAD --` reports as nothing at all.
    const tracked = run([
      "diff",
      "HEAD",
      "--unified=3",
      "--",
      relativePath,
    ]);
    if (tracked.trim()) return parseUnifiedPatch(tracked);

    const untracked = run([
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      relativePath,
    ]);
    if (!untracked.trim()) return null;

    try {
      run(["diff", "--no-index", "--unified=3", "/dev/null", relativePath]);
      return null;
    } catch (error) {
      // git diff --no-index exits 1 when files differ; the patch is on stdout.
      const patch = (error as { stdout?: string }).stdout ?? "";
      return patch ? parseUnifiedPatch(patch) : null;
    }
  } catch {
    // Not a repository, git missing, or a path git will not diff.
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && node --test --experimental-strip-types src/git-diff.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Resolve pending hunks when the viewer opens**

In `src/ui/viewer.ts`, add the imports:

```ts
import { diffAgainstHead } from "../git-diff.ts";
```

and give `openDiffViewer` a `cwd` parameter, resolving before the overlay
opens:

```ts
export async function openDiffViewer(
  ctx: ExtensionCommandContext,
  store: FileEditStore,
  path: string,
  state: ViewerState,
  cwd: string,
): Promise<ViewerExit> {
  const change = store.get(path);
  if (change?.hunksPending) {
    const resolved = diffAgainstHead(cwd, path);
    if (resolved) {
      store.resolveHunks(path, {
        hunks: resolved.hunks,
        added: resolved.added,
        removed: resolved.removed,
      });
    }
  }
  return ctx.ui.custom<ViewerExit>(/* unchanged */);
}
```

Thread `cwd` through `browseChangedFiles` in `src/ui/picker.ts` and pass
`ctx.cwd` from `index.ts`.

- [ ] **Step 6: Verify end to end**

```bash
cd pi-agent/dot-pi/agent/extensions/file-edits && npm run check && npm test
cd ../../../.. && cp -R pi-agent/dot-pi/agent/. ~/.pi/agent/
```

In a git repo, spawn a subagent that edits a file. Confirm the picker lists it
with a `⌘ <name>` tag, and opening it shows a real diff against HEAD.

- [ ] **Step 7: Add the file to the test script and commit**

Add `src/git-diff.test.ts` to the `test` script, then:

```bash
git add pi-agent/dot-pi/agent/extensions/file-edits
git commit -m "feat: diff child-session files against HEAD"
```

---

## Task 18: Document the extension

**Files:**
- Modify: `pi-agent/README.md`

- [ ] **Step 1: Add the row to the extensions table**

Insert into the table in `pi-agent/README.md`, after the `subagents` row:

```markdown
| `file-edits`           | Collapsed edit rows, a file picker, and a diff viewer       |
```

- [ ] **Step 2: Document the status bar and the keys**

Add a short section after the `## Theme` section:

```markdown
## Status bar

Extension statuses (`file-edits`, `subagents`, `background-terminals`,
`workflows`, `summaries`) share one line directly above the prompt, joined
with the same `◆` separator the footer uses. Segments have a fixed order and
drop from the right when the line will not fit. Extensions publish through
`ctx.ui.setStatus`; `ui-customization` renders the line.

`file-edits` collapses every `edit` and `write` to two lines in the
transcript. `ctrl+f` (or `/files`) opens the picker; Enter opens the diff
viewer, `s` toggles stacked and split, `n`/`p` move between files. `ctrl+o`
still expands a row inline.
```

- [ ] **Step 3: Run every affected suite once more**

```bash
cd pi-agent/dot-pi/agent/extensions
for d in file-edits subagents background-terminals; do
  (cd "$d" && npm run check && npm test) || echo "FAILED: $d"
done
(cd shared && node --test --experimental-strip-types status-bar.test.ts activity-status.test.ts)
cd .. && npx tsc --noEmit -p . 2>&1 | grep -E "extensions/(workflows|shared|file-edits|ui-customization)/"
```

Expected: no `FAILED:` lines, all suites PASS, and the final `grep` prints
nothing. Baseline for comparison: `subagents` 60 tests, `background-terminals`
44 tests, both green before this work started.

- [ ] **Step 4: Commit**

```bash
git add pi-agent/README.md
git commit -m "docs: describe file-edits and the shared status bar"
```
