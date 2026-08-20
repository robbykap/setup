# Plain Tool Rows Everywhere — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove pi's filled green/red shell Box from every tool's transcript row and give each tool the file-edits look: colored nerd-font icon + bold title + right-aligned outcome + dim `│` peek lines.

**Architecture:** pi wraps a tool's rendered lines in a colored Box unless the tool declares `renderShell: "self"` (tool-execution.js:50; only built-in `edit` sets it — verified in `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/tools`). A new shared `tui-kit/row.ts` renders the one row layout everyone uses; `BoxedDelegate`/`boxedDelegation`/`shellBg` move from file-edits into a new `tui-kit/boxed.ts` so bash's expanded (ctrl+o) view can restore the shell the same way write does. Then each extension adds `renderShell: "self"` and renders through the kit.

**Tech Stack:** TypeScript (type-stripped, run with `node --test --experimental-strip-types`), `@earendil-works/pi-coding-agent` extension API, `@earendil-works/pi-tui` components. Repo root for all paths below: `pi-agent/dot-pi/agent/extensions/`.

**Conventions:** Every extension verifies with `npm run check && npm test` from its own directory. The kit suite runs from `pi-agent/dot-pi/agent`: `node --test --experimental-strip-types extensions/shared/tui-kit/*.test.ts`. Nerd-font glyphs are declared as numeric codepoints (see `shared/tui-kit/icons.ts` header comment). Background fill in a rendered line is detectable as the substring `\x1b[48`.

---

### Task 1: Kit row renderer (`shared/tui-kit/row.ts`)

**Files:**
- Create: `shared/tui-kit/row.ts`
- Test: `shared/tui-kit/row.test.ts`

- [ ] **Step 1: Write the failing test.** Mirror the fake-theme style of the existing kit tests (see `shared/tui-kit/status.test.ts` for how they stub `Theme`).

```ts
/**
 * The shared tool row: icon + painted title + right-aligned outcome + dim
 * peek lines. The layout every transcript surface uses, so it is tested
 * once, here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { UI_ICONS } from "./icons.ts";
import { peekLine, renderToolRow, toolCallTitle } from "./row.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

test("header carries the icon, title left, outcome right", () => {
  const lines = renderToolRow(
    { icon: UI_ICONS.terminal, title: "npm test", right: "✓ ok" },
    40,
    theme,
  );
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.includes(UI_ICONS.terminal.glyph));
  assert.ok(lines[0]!.includes("npm test"));
  assert.ok(lines[0]!.includes("✓ ok"));
  // Right-aligned: outcome ends at the row edge.
  assert.equal(visibleWidth(lines[0]!), 40);
});

test("peek lines render dim gutters and skip blanks", () => {
  const lines = renderToolRow(
    { icon: UI_ICONS.terminal, title: "ls", peek: ["a.ts", "   ", "b.ts"] },
    40,
    theme,
  );
  assert.equal(lines.length, 3);
  assert.ok(lines[1]!.includes("│"));
  assert.ok(lines[1]!.includes("a.ts"));
  assert.ok(lines[2]!.includes("b.ts"));
});

test("no line carries a background fill", () => {
  const lines = renderToolRow(
    { icon: UI_ICONS.terminal, title: "npm test", right: "✓", peek: ["done"] },
    40,
    theme,
  );
  for (const line of lines) assert.ok(!line.includes("\x1b[48"));
});

test("a too-long header truncates instead of wrapping", () => {
  const lines = renderToolRow(
    { icon: UI_ICONS.terminal, title: "x".repeat(100), right: "✓" },
    30,
    theme,
  );
  assert.ok(visibleWidth(lines[0]!) <= 30);
});

test("toolCallTitle paints icon, bold name, and detail", () => {
  const title = toolCallTitle(UI_ICONS.agent, "subagent_spawn", "fix tests", theme);
  assert.ok(title.includes(UI_ICONS.agent.glyph));
  assert.ok(title.includes("subagent_spawn"));
  assert.ok(title.includes("fix tests"));
});

test("peekLine fits the width", () => {
  assert.ok(visibleWidth(peekLine("hello", 20, theme)) <= 20);
});
```

- [ ] **Step 2: Run it, expect failure.** From `pi-agent/dot-pi/agent`: `node --test --experimental-strip-types extensions/shared/tui-kit/row.test.ts` — FAIL (module not found).

- [ ] **Step 3: Implement `shared/tui-kit/row.ts`.**

```ts
/**
 * The one tool-row look every transcript surface shares: a colored icon, a
 * pre-painted title, a right-aligned outcome, and dim `│` peek lines.
 * Lifted out of file-edits and commands so a bash row, an edit row and an
 * ask_user row cannot drift apart. Callers paint their own title (bold
 * command, dim-directory/bold-basename path) before handing it in.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { paintIcon, type FileIcon } from "./icons.ts";

export interface ToolRowParts {
  readonly icon: FileIcon;
  /** Already painted by the caller. */
  readonly title: string;
  /** Right-aligned outcome, already painted. */
  readonly right?: string;
  /** Dim peek lines under the header; blank entries are dropped. */
  readonly peek?: readonly string[];
}

export function renderToolRow(
  parts: ToolRowParts,
  width: number,
  theme: Theme,
): string[] {
  const left = `${paintIcon(parts.icon)} ${parts.title}`;
  const right = parts.right ?? "";
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  const header = truncateToWidth(
    right ? `${left}${" ".repeat(gap)}${right}` : left,
    width,
    theme.fg("dim", "…"),
  );
  const peek = (parts.peek ?? []).filter((line) => line.trim().length > 0);
  return [header, ...peek.map((line) => peekLine(line, width, theme))];
}

/** A dim `   │ text` line under a row header. */
export function peekLine(text: string, width: number, theme: Theme): string {
  return truncateToWidth(
    `   ${theme.fg("dim", "│")} ${theme.fg("dim", text)}`,
    width,
    theme.fg("dim", "…"),
  );
}

/** A one-line call header for tools without richer rows: icon, bold tool
 * name, and a muted detail (a title, an id list, a pattern). */
export function toolCallTitle(
  icon: FileIcon,
  name: string,
  detail: string | undefined,
  theme: Theme,
): string {
  let text = `${paintIcon(icon)} ${theme.bold(theme.fg("text", name))}`;
  if (detail) text += ` ${theme.fg("muted", detail)}`;
  return text;
}
```

- [ ] **Step 4: Run the kit suite.** From `pi-agent/dot-pi/agent`: `node --test --experimental-strip-types extensions/shared/tui-kit/*.test.ts` — all PASS.

- [ ] **Step 5: Commit.** `git add pi-agent/dot-pi/agent/extensions/shared/tui-kit/row.ts pi-agent/dot-pi/agent/extensions/shared/tui-kit/row.test.ts && git commit -m "feat: add the shared tool row to tui-kit"`

---

### Task 2: Move the shell-restoring Box into the kit (`shared/tui-kit/boxed.ts`)

**Files:**
- Create: `shared/tui-kit/boxed.ts`
- Modify: `file-edits/src/render/row.ts` (delete `BoxedDelegate`/`boxedDelegation`, re-export from kit)
- Modify: `file-edits/index.ts` (delete local `shellBg`, import from kit; pass the unwrap argument)

The kit version cannot call file-edits' `delegationContext` (it checks extension-local classes), so `boxedDelegation` grows an `unwrap` parameter that each extension supplies.

- [ ] **Step 1: Create `shared/tui-kit/boxed.ts`.**

```ts
/**
 * The shell put back by hand, for expanded (ctrl+o) rows whose built-in
 * renderers depend on the Box that `renderShell: "self"` took away
 * (tool-execution.js:213-219). The built-in write renderers emit
 * `Text(output, 0, 0)` and count on that Box for padding and background
 * (write.js:170,187); the built-in bash output block is the same shape.
 * Lifted out of file-edits so commands can restore the shell the same way.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Box, type Component } from "@earendil-works/pi-tui";

export class BoxedDelegate extends Box {
  /** What the built-in returned last time. The Box is what the slot sees,
   * so the built-in's own component — write caches syntax highlighting on
   * it (write.js:175-179) — has to be remembered here to be handed back. */
  inner: Component | undefined;

  constructor(paddingY: number) {
    super(1, paddingY, (text) => text);
  }
}

/** The background pi's default shell would have painted for this state
 * (tool-execution.js:213-219). Ours to paint now that the tool frames
 * itself. */
export function shellBg(
  theme: Theme,
  context: { isPartial: boolean; isError: boolean },
): (text: string) => string {
  if (context.isPartial) return (text) => theme.bg("toolPendingBg", text);
  if (context.isError) return (text) => theme.bg("toolErrorBg", text);
  return (text) => theme.bg("toolSuccessBg", text);
}

/**
 * Delegate to a built-in renderer and wrap what it returns in that Box.
 * `unwrap` is the extension's delegationContext: it hides the extension's
 * own components from the built-in while handing its own back.
 */
export function boxedDelegation<T extends { lastComponent: unknown }>(
  context: T,
  paddingY: number,
  bgFn: ((text: string) => string) | undefined,
  unwrap: (context: T) => T,
  render: (context: T) => Component,
): BoxedDelegate {
  let box: BoxedDelegate;
  if (context.lastComponent instanceof BoxedDelegate) {
    box = context.lastComponent;
  } else {
    box = new BoxedDelegate(paddingY);
    // Not ours yet: whatever the built-in last made is still worth handing
    // back, and `unwrap` is what knows one from the other.
    box.inner = unwrap(context).lastComponent as Component | undefined;
  }
  const inner = render({ ...context, lastComponent: box.inner });
  box.inner = inner;
  box.setBgFn(bgFn);
  box.clear();
  box.addChild(inner);
  return box;
}
```

- [ ] **Step 2: Slim `file-edits/src/render/row.ts`.** Delete the `BoxedDelegate` class and `boxedDelegation` function (and the now-unused `Box`/`Component` imports). Add at the top:

```ts
import { BoxedDelegate, boxedDelegation } from "../../../shared/tui-kit/boxed.ts";

export { BoxedDelegate, boxedDelegation };
```

Keep `delegationContext` unchanged — its `instanceof BoxedDelegate` check now hits the kit class. The re-export keeps `file-edits/index.ts` imports working, but update the two `boxedDelegation` call sites in `file-edits/index.ts` (write's `renderCall` and `renderResult`) to the new signature — the unwrap argument goes fourth:

```ts
return boxedDelegation(context, 1, shellBg(theme, context), delegationContext, (ctx) =>
  baseWrite.renderCall!(args, theme, ctx),
);
// …and in renderResult:
return boxedDelegation(context, 0, undefined, delegationContext, (ctx) =>
  baseWrite.renderResult!(result, options, theme, ctx),
);
```

- [ ] **Step 3: Delete the local `shellBg` in `file-edits/index.ts`** and import it: `import { shellBg } from "../shared/tui-kit/boxed.ts";`

- [ ] **Step 4: Verify.** From `file-edits/`: `npm run check && npm test` — all green (shell.test.ts proves the expanded box still comes back).

- [ ] **Step 5: Commit.** `git add -A pi-agent/dot-pi/agent/extensions && git commit -m "refactor: lift the shell-restoring box into tui-kit"`

---

### Task 3: file-edits rows render through the kit

**Files:**
- Modify: `file-edits/src/render/row.ts` (`renderCollapsedRow`, `renderNote`, delete the local `peekLine`)

- [ ] **Step 1: Rewrite the drawing functions to call the kit.** Imports: add `renderToolRow, peekLine` from `../../../shared/tui-kit/row.ts`. Replace `renderCollapsedRow` and `renderNote`:

```ts
export function renderCollapsedRow(
  change: FileChange,
  width: number,
  theme: Theme,
  failed = false,
): string[] {
  const parts = {
    icon: iconFor(change.path),
    title: paintPath(change.path, theme),
    right: failed ? theme.fg("error", FAILED_MARKER) : counts(change, theme),
  };
  // Nothing was applied, so there is no diff to peek at: the reason comes
  // from the result slot (NoteRow) instead.
  if (failed) return renderToolRow(parts, width, theme);

  const hunk = largestHunk(change.hunks);
  const changed = hunk?.lines.filter((line) => line.kind !== "context") ?? [];
  const peek =
    changed.length === 0
      ? []
      : [
          changed
            .slice(0, PEEK_LINES)
            .map((line) => line.text.trim())
            .join(theme.fg("dim", " · ")),
        ];
  return renderToolRow({ ...parts, peek }, width, theme);
}

/** The reason line under a failed header. Empty text renders no line at all:
 * a bare `│` says less than nothing. */
export function renderNote(text: string, width: number, theme: Theme): string[] {
  const line = text.replace(/\s+/g, " ").trim();
  return line ? [peekLine(line, width, theme)] : [];
}
```

Delete the local `peekLine` and the now-unused `paintIcon`/`truncateToWidth`/`visibleWidth` imports if nothing else uses them.

- [ ] **Step 2: Verify.** From `file-edits/`: `npm run check && npm test` — green. `row.test.ts` asserts the same rendered lines, so any layout drift fails here.

- [ ] **Step 3: Commit.** `git add -A pi-agent/dot-pi/agent/extensions/file-edits && git commit -m "refactor: file-edits rows draw through the kit row"`

---

### Task 4: bash — icon row, live peek, no box

**Files:**
- Modify: `commands/src/render/row.ts` (icon header, `LiveCallRow`, `LivePeekRow`, wider `delegationContext`)
- Modify: `commands/index.ts` (`renderShell: "self"`, live wiring, boxed expanded delegation)
- Modify: `commands/src/render/row.test.ts` (expectations move from ` $ ` to the icon)
- Create: `commands/src/render/shell.test.ts`
- Modify: `commands/package.json` (add shell.test.ts to the test list if tests are enumerated there)

- [ ] **Step 1: Update `row.test.ts` first.** Change the header expectations: the row starts with `UI_ICONS.terminal.glyph` instead of ` $ `; add tests for the two live rows:

```ts
import { UI_ICONS } from "../../../shared/tui-kit/icons.ts";
import { LiveCallRow, LivePeekRow } from "./row.ts";

test("running call row shows icon, command, and running marker", () => {
  const row = new LiveCallRow();
  row.update("npm test", theme);
  const lines = row.render(60);
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.includes(UI_ICONS.terminal.glyph));
  assert.ok(lines[0]!.includes("npm test"));
  assert.ok(lines[0]!.includes("running"));
});

test("live peek row shows the last output line, dim, no box", () => {
  const row = new LivePeekRow();
  row.update("compiling…\nlinking…\n", theme);
  const lines = row.render(60);
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.includes("linking…"));
  assert.ok(!lines[0]!.includes("\x1b[48"));
});
```

Run from `commands/`: `npm test` — FAIL (classes missing, icon absent).

- [ ] **Step 2: Rework `commands/src/render/row.ts`.** Add imports and the new pieces; `renderCollapsedRow` goes through the kit:

```ts
import { UI_ICONS } from "../../../shared/tui-kit/icons.ts";
import { peekLine, renderToolRow } from "../../../shared/tui-kit/row.ts";
import { BoxedDelegate } from "../../../shared/tui-kit/boxed.ts";
```

```ts
/** The command painted the way every bash row titles itself. */
function paintCommand(command: string, theme: Theme): string {
  const summary = summarizeCommand(command);
  return (
    theme.bold(theme.fg("text", oneLine(summary.text))) +
    (summary.more > 0 ? theme.fg("dim", ` +${summary.more} more`) : "")
  );
}

export function renderCollapsedRow(
  record: CommandRecord,
  width: number,
  theme: Theme,
): string[] {
  return renderToolRow(
    {
      icon: UI_ICONS.terminal,
      title: paintCommand(record.command, theme),
      right: outcome(record, theme),
      peek: tailLines(
        record.output,
        isFailure(record) ? FAILURE_PEEK_LINES : PEEK_LINES,
      ),
    },
    width,
    theme,
  );
}

/** The call slot while the command is still running: icon, command, and a
 * running marker — the boxed built-in live line replaced. */
export class LiveCallRow extends Container {
  private command = "";
  private theme: Theme | undefined;

  update(command: string, theme: Theme): void {
    this.command = command;
    this.theme = theme;
  }

  override render(width: number): string[] {
    if (!this.theme) return [];
    return renderToolRow(
      {
        icon: UI_ICONS.terminal,
        title: paintCommand(this.command, this.theme),
        right: this.theme.fg("warning", "… running"),
      },
      width,
      this.theme,
    );
  }
}

/** The result slot while output is still streaming: a dim peek at the last
 * line so far. Re-rendered every time a new chunk arrives. */
export class LivePeekRow extends Container {
  private output = "";
  private theme: Theme | undefined;

  update(output: string, theme: Theme): void {
    this.output = output;
    this.theme = theme;
  }

  override render(width: number): string[] {
    if (!this.theme) return [];
    const theme = this.theme;
    return tailLines(this.output, PEEK_LINES).map((line) =>
      peekLine(line, width, theme),
    );
  }
}
```

Widen `delegationContext`:

```ts
const ours =
  context.lastComponent instanceof CollapsedRow ||
  context.lastComponent instanceof EmptyRow ||
  context.lastComponent instanceof LiveCallRow ||
  context.lastComponent instanceof LivePeekRow ||
  context.lastComponent instanceof BoxedDelegate;
```

Delete the now-dead ` $ ` header assembly and unused `truncateToWidth`/`visibleWidth` imports if nothing else needs them (`outcome` and `tailLines` stay).

- [ ] **Step 3: Rewire `commands/index.ts`.** Add imports (`LiveCallRow`, `LivePeekRow` from the row module; `boxedDelegation`, `shellBg` from `../shared/tui-kit/boxed.ts`; `resultText` from `./src/record.ts`). Add reuse helpers next to `collapsedRow`:

```ts
const liveCall = (lastComponent: unknown, command: string, theme: Theme) => {
  const row =
    lastComponent instanceof LiveCallRow ? lastComponent : new LiveCallRow();
  row.update(command, theme);
  return row;
};

const livePeek = (lastComponent: unknown, output: string, theme: Theme) => {
  const row =
    lastComponent instanceof LivePeekRow ? lastComponent : new LivePeekRow();
  row.update(output, theme);
  return row;
};
```

Replace the tool's render config:

```ts
renderShell: "self",
renderCall(args, theme, context) {
  // Expanded is the built-in's view, and the built-in expects the shell
  // Box that "self" took away — so it gets one of ours.
  if (context.expanded) {
    return boxedDelegation(context, 1, shellBg(theme, context), delegationContext, (ctx) =>
      baseBash.renderCall!(args, theme, ctx),
    );
  }
  const record = calls.get(context.toolCallId);
  // Settled: the result slot draws the whole row.
  if (record) return noCall();
  // Still running: our own live header instead of the boxed built-in line.
  return liveCall(
    context.lastComponent,
    typeof args.command === "string" ? args.command : "",
    theme,
  );
},
renderResult(result, options, theme, context) {
  const expanded = options.expanded || context.expanded;
  if (expanded) {
    return boxedDelegation(
      context,
      0,
      shellBg(theme, { isPartial: options.isPartial, isError: context.isError }),
      delegationContext,
      (ctx) => baseBash.renderResult!(result, options, theme, ctx),
    );
  }
  const record = calls.get(context.toolCallId);
  // Streaming: a dim peek at the tail of what has arrived so far.
  if (options.isPartial || !record) {
    return livePeek(context.lastComponent, resultText(result), theme);
  }
  // Not a rendering call: while the command streamed AND was expanded, the
  // built-in may have started its 1Hz elapsed-time interval
  // (bash.js:369-380), and the final call is where it clears it. Run it for
  // the cleanup, then throw the component it returns away.
  baseBash.renderResult!(result, options, theme, delegationContext(context));
  return collapsedRow(context.lastComponent, record, theme);
},
```

Note: `resultText` accepts `{ content?, details? }` (`commands/src/record.ts:78`); the render slot's `result` satisfies it — cast with `resultText(result as never)` only if `npm run check` complains about readonly variance.

- [ ] **Step 4: Add `commands/src/render/shell.test.ts`.** Copy the structure of `file-edits/src/render/shell.test.ts` (it registers the extension in print mode and drives the real `ToolExecutionComponent`), adapted to one tool. Note bash needs `calls` to have a record for the collapsed path, which only `execute` writes — so the no-box assertions run against the live and expanded paths, which need no record:

```ts
/**
 * pi wraps a tool's lines in a colored Box unless the tool sets
 * `renderShell: "self"` (tool-execution.js:50). These tests drive the real
 * ToolExecutionComponent over the bash tool the extension registers — the
 * only place that decision is visible.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import extension from "../../index.ts";

initTheme();
const CWD = "/tmp";

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

function bashComponent() {
  const component = new ToolExecutionComponent(
    "bash",
    "call-bash",
    { command: "npm test" },
    {},
    tools.get("bash") as never,
    { requestRender() {} } as never,
    CWD,
  );
  component.setArgsComplete();
  return component;
}

test("a running bash call has no box around it", () => {
  const component = bashComponent();
  component.updateResult(
    { content: [{ type: "text", text: "compiling…\nlinking…" }], isError: false },
    true, // still partial
  );
  const lines = component.render(60);
  for (const line of lines) {
    assert.ok(!line.includes("\x1b[48"), JSON.stringify(line));
  }
  // The live row: our header with the command, and a peek at the tail.
  const flat = lines.join("\n");
  assert.ok(flat.includes("npm test"));
  assert.ok(flat.includes("linking…"));
});

test("expanded bash gets the box back", () => {
  const component = bashComponent();
  component.setExpanded(true);
  component.updateResult(
    { content: [{ type: "text", text: "ok\n" }], isError: false },
    false,
  );
  const lines = component.render(60);
  assert.ok(lines.some((line) => line.includes("\x1b[48")), JSON.stringify(lines));
});
```

- [ ] **Step 5: Register the test.** If `commands/package.json` lists test files explicitly (check its `"test"` script), add `src/render/shell.test.ts`.

- [ ] **Step 6: Verify.** From `commands/`: `npm run check && npm test` — all green.

- [ ] **Step 7: Manual sanity check** if a pi session is available: run a slow command (`sleep 2 && echo done`); while running the row is icon + command + `… running` with a dim tail peek and no green box; settled it keeps the tail peek; ctrl+o restores the boxed full output. Skip silently if no interactive session is possible.

- [ ] **Step 8: Commit.** `git add -A pi-agent/dot-pi/agent/extensions/commands && git commit -m "feat: bash rows drop the shell box for the icon row"`

---

### Task 5: ask_user — question icon, no box

**Files:**
- Modify: `shared/tui-kit/icons.ts` (add `question` to `UI_ICONS`)
- Modify: `ask-user/index.ts` (`renderShell: "self"`, icon in `renderCall`)

- [ ] **Step 1: Add the glyph.** In `UI_ICONS` (`shared/tui-kit/icons.ts`):

```ts
  question: glyph(0xf128, BLUE), // nf-fa-question
```

Run the kit suite from `pi-agent/dot-pi/agent`: `node --test --experimental-strip-types extensions/shared/tui-kit/*.test.ts` — the `ALL_ICONS` width-invariant test covers the new entry automatically.

- [ ] **Step 2: Update `ask-user/index.ts`.** Add to the tool object (next to `name: "ask_user"`): `renderShell: "self",`. Add the import `import { UI_ICONS, paintIcon } from "../shared/tui-kit/icons.ts";` and replace the first line of `renderCall` (`ask-user/index.ts:378`):

```ts
renderCall(args, theme, _context) {
  let text = `${paintIcon(UI_ICONS.question)} `;
  text += theme.bold(
    theme.fg("text", typeof args.question === "string" ? args.question : ""),
  );
```

(The numbered-options block below it stays as is; `renderResult` stays as is — its ✓/✗ lines are already plain.)

- [ ] **Step 3: Verify.** From `ask-user/`: `npm run check` (this extension has no test suite; check is the gate).

- [ ] **Step 4: Commit.** `git add -A pi-agent/dot-pi/agent/extensions && git commit -m "feat: ask_user asks with a question icon, unboxed"`

---

### Task 6: fd / rg — magnifier icon, no box

**Files:**
- Modify: `shared/tui-kit/icons.ts` (add `search` to `UI_ICONS`)
- Modify: `file-search/index.ts` (both tools)

- [ ] **Step 1: Add the glyph.** In `UI_ICONS`: `search: glyph(0xf002, SKY), // nf-fa-search`. Kit suite still green.

- [ ] **Step 2: Update both tools in `file-search/index.ts`.** Add the import `import { UI_ICONS, paintIcon } from "../shared/tui-kit/icons.ts";`. In each `registerTool` object add `renderShell: "self",` and change the first line of each `renderCall` (`file-search/index.ts:316` and `:389`):

```ts
// fd:
let text = `${paintIcon(UI_ICONS.search)} ${theme.bold(theme.fg("text", "fd"))} `;
// rg:
let text = `${paintIcon(UI_ICONS.search)} ${theme.bold(theme.fg("text", "rg"))} `;
```

(`renderResult` in both stays — the summary lines are already plain text.)

- [ ] **Step 3: Verify.** From `file-search/`: `npm run check && npm test`.

- [ ] **Step 4: Commit.** `git add -A pi-agent/dot-pi/agent/extensions && git commit -m "feat: file search rows get the magnifier, lose the box"`

---

### Task 7: workflow — agent icon, no box

**Files:**
- Modify: `workflows/index.ts`

- [ ] **Step 1: Update the tool.** Add `import { UI_ICONS, paintIcon } from "../shared/tui-kit/icons.ts";`. In the `registerTool` object (`workflows/index.ts:370`) add `renderShell: "self",`. In `renderCall` (`:734`) prefix the header:

```ts
let text =
  `${paintIcon(UI_ICONS.agent)} ` +
  theme.fg("toolTitle", theme.bold("workflow ")) +
  theme.fg("accent", (meta as WorkflowMeta).name ?? "(script)");
```

In `renderResult` (`:753`) prefix the same icon before the status square in `header`:

```ts
let header =
  `${paintIcon(UI_ICONS.agent)} ${theme.fg(statusColor(details.status), SQUARE)} ` +
  // …rest unchanged
```

- [ ] **Step 2: Verify.** From `workflows/`: `npm run check && npm test`.

- [ ] **Step 3: Commit.** `git add -A pi-agent/dot-pi/agent/extensions/workflows && git commit -m "feat: workflow rows carry the agent icon, unboxed"`

---

### Task 8: bg_* and subagent_* — icon call headers, no box

These nine tools have no renderers at all today, so pi draws its default boxed view. Each gets `renderShell: "self"` and a one-line `renderCall` via the kit's `toolCallTitle`; results keep pi's default text rendering, now unboxed.

**Files:**
- Modify: `background-terminals/index.ts` (4 tools: `bg_start`, `bg_status`, `bg_list`, `bg_kill`)
- Modify: `subagents/index.ts` (5 tools: `subagent_spawn`, `subagent_wait`, `subagent_cancel`, `subagent_check`, `subagent_list`)

- [ ] **Step 1: background-terminals.** Add imports:

```ts
import { Text } from "@earendil-works/pi-tui";
import { UI_ICONS } from "../shared/tui-kit/icons.ts";
import { toolCallTitle } from "../shared/tui-kit/row.ts";
```

(If `Text` is already imported, keep the existing import.) In each of the four `registerTool` objects add `renderShell: "self",` and a `renderCall`; details per tool:

```ts
// bg_start — the title names the terminal, the command says what runs:
renderCall(args, theme) {
  const detail = [args.title, args.command].filter(Boolean).join(" · ");
  return new Text(toolCallTitle(UI_ICONS.terminal, "bg_start", detail, theme), 0, 0);
},
// bg_status:
renderCall(args, theme) {
  return new Text(toolCallTitle(UI_ICONS.terminal, "bg_status", typeof args.id === "string" ? args.id : undefined, theme), 0, 0);
},
// bg_list:
renderCall(_args, theme) {
  return new Text(toolCallTitle(UI_ICONS.terminal, "bg_list", undefined, theme), 0, 0);
},
// bg_kill:
renderCall(args, theme) {
  const detail = Array.isArray(args.ids) ? args.ids.join(", ") : undefined;
  return new Text(toolCallTitle(UI_ICONS.terminal, "bg_kill", detail, theme), 0, 0);
},
```

- [ ] **Step 2: subagents.** Same imports (from `../shared/…`). Per tool:

```ts
// subagent_spawn — the name is the story:
renderCall(args, theme) {
  return new Text(toolCallTitle(UI_ICONS.agent, "subagent_spawn", typeof args.name === "string" ? args.name : undefined, theme), 0, 0);
},
// subagent_wait — the ids:
renderCall(args, theme) {
  const detail = Array.isArray(args.ids) ? args.ids.join(", ") : undefined;
  return new Text(toolCallTitle(UI_ICONS.agent, "subagent_wait", detail, theme), 0, 0);
},
// subagent_cancel:
renderCall(args, theme) {
  const detail = Array.isArray(args.ids) ? args.ids.join(", ") : undefined;
  return new Text(toolCallTitle(UI_ICONS.agent, "subagent_cancel", detail, theme), 0, 0);
},
// subagent_check:
renderCall(args, theme) {
  return new Text(toolCallTitle(UI_ICONS.agent, "subagent_check", typeof args.id === "string" ? args.id : undefined, theme), 0, 0);
},
// subagent_list:
renderCall(_args, theme) {
  return new Text(toolCallTitle(UI_ICONS.agent, "subagent_list", undefined, theme), 0, 0);
},
```

- [ ] **Step 3: Verify.** From `background-terminals/`: `npm run check && npm test`. From `subagents/`: `npm run check && npm test`.

- [ ] **Step 4: Commit.** `git add -A pi-agent/dot-pi/agent/extensions && git commit -m "feat: terminal and subagent tools get plain icon headers"`

---

### Task 9: built-in read — re-register with a file icon row

Verified: `dist/core/tools/read.js` sets no `renderShell`, so read rows are boxed today, and `createReadToolDefinition` is exported. Read is a file surface, so it lives in file-edits next to edit and write — render-only, nothing recorded in the store.

**Files:**
- Modify: `file-edits/index.ts`
- Modify: `file-edits/src/render/shell.test.ts` (cover read)

- [ ] **Step 1: Register the read wrapper.** In `file-edits/index.ts` add `createReadToolDefinition` to the existing pi-coding-agent import, and inside `session_start` (after `pi.registerTool(writeTool);`):

```ts
const baseRead = createReadToolDefinition(ctx.cwd);
const readTool: typeof baseRead = {
  ...baseRead,
  // Collapsed read rows are ours (icon + path + line count); expanded and
  // streaming views delegate to the built-in, which renders plain Text and
  // needs no shell back.
  renderShell: "self",
  renderCall(args, theme, context) {
    if (context.expanded) {
      return baseRead.renderCall!(args, theme, readDelegation(context));
    }
    const path = typeof args.path === "string" ? args.path : "";
    return new Text(
      `${paintIcon(iconFor(path))} ${paintReadPath(path, theme)}`,
      0,
      0,
    );
  },
  renderResult(result, options, theme, context) {
    if (options.expanded || context.expanded || options.isPartial) {
      return baseRead.renderResult!(result, options, theme, readDelegation(context));
    }
    if (context.isError) {
      const first = result.content[0];
      const reason = first?.type === "text" ? first.text : "failed";
      return new Text(peekLine(reason, 76, theme), 0, 0);
    }
    const first = result.content[0];
    const lines =
      first?.type === "text" ? first.text.split("\n").length : 0;
    return new Text(theme.fg("dim", `   │ read ${lines} lines`), 0, 0);
  },
};
pi.registerTool(readTool);
```

Supporting pieces (module level, next to `shellBg`'s old spot): the built-in read caches a `Text` on `lastComponent` and calls `setText` on it, so delegation must hide our components from it:

```ts
/** Hide our read components from the built-in, which calls setText on
 * whatever the slot returned last (read.js:265,274). */
const readDelegation = <T extends { lastComponent: unknown }>(context: T): T =>
  context.lastComponent instanceof Text
    ? context
    : { ...context, lastComponent: undefined };

/** Dim directory, bold basename — the same split every file row uses. */
const paintReadPath = (path: string, theme: Theme) => {
  const cut = path.lastIndexOf("/");
  if (cut < 0) return theme.bold(theme.fg("text", path));
  return (
    theme.fg("dim", path.slice(0, cut + 1)) +
    theme.bold(theme.fg("text", path.slice(cut + 1)))
  );
};
```

Add `Text` to the pi-tui import in `file-edits/index.ts` (`import { Text } from "@earendil-works/pi-tui";`). Note `paintReadPath` duplicates the private `paintPath` in `src/render/row.ts` — export `paintPath` from there instead and delete the duplicate if `npm run check` shows no cycle; both files already import from each other's direction safely.

Width caveat: the `peekLine(reason, 76, theme)` fixed width is a compromise — a `Text` wraps rather than truncates. If it looks wrong in practice, replace with `new Text(theme.fg("dim", \`   │ ${reason}\`), 0, 0)`.

- [ ] **Step 2: Extend `file-edits/src/render/shell.test.ts`.** Add read to the driven tools:

```ts
test("read: a settled collapsed call has no box around it", () => {
  const component = new ToolExecutionComponent(
    "read",
    "call-read",
    { path: "a.ts" },
    {},
    tools.get("read") as never,
    { requestRender() {} } as never,
    CWD,
  );
  component.setArgsComplete();
  component.updateResult(
    { content: [{ type: "text", text: "1: hello\n2: world" }], isError: false },
    false,
  );
  const lines = component.render(60);
  for (const line of lines) {
    assert.ok(!line.includes("\x1b[48"), JSON.stringify(line));
  }
  assert.ok(lines.join("\n").includes("a.ts"));
});
```

- [ ] **Step 3: Verify.** From `file-edits/`: `npm run check && npm test` — green.

- [ ] **Step 4: Commit.** `git add -A pi-agent/dot-pi/agent/extensions/file-edits && git commit -m "feat: read rows join the plain icon look"`

---

### Task 10: Full verification

- [ ] **Step 1: Kit suite.** From `pi-agent/dot-pi/agent`: `node --test --experimental-strip-types extensions/shared/tui-kit/*.test.ts` — green.
- [ ] **Step 2: Every touched extension**, from its directory: `npm run check && npm test` (`file-edits`, `commands`, `file-search`, `subagents`, `background-terminals`, `workflows`; `ask-user` is `npm run check` only) — green.
- [ ] **Step 3: Agent root check.** From `pi-agent/dot-pi/agent`: `npm run check` — clean.
- [ ] **Step 4: Manual pass** if a pi session is available: run a command, ask a question, spawn a subagent, read a file — no filled green/red boxes anywhere; ctrl+o still expands bash and write into their boxed built-in views. Skip silently if no interactive session is possible.
- [ ] **Step 5: Commit anything outstanding.** `git status` should be clean; if not, commit with a message describing what changed.
