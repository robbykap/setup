# TUI Polish (shared tui-kit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shared `tui-kit` module (icons, syntax highlight, full-row selection, frames, scroll, copy) applied across the file-edits, commands, subagents, background-terminals, and ask-user extensions.

**Architecture:** New pure-rendering units live in `pi-agent/dot-pi/agent/extensions/shared/tui-kit/`, each with its own `node --test` suite. Extensions then swap their hand-rolled equivalents for the kit. Every overlay line must stay exactly `width` visible cells (`visibleWidth`, never `String.length`) — the repo's history has geometry bugs from violating this.

**Tech Stack:** TypeScript (type-stripped, run directly by node), `@earendil-works/pi-coding-agent` (Theme, `highlightCode`, `getLanguageFromPath`, `copyToClipboard` — all exported from the package root), `@earendil-works/pi-tui` (`visibleWidth`, `truncateToWidth`).

---

## Read this first (guidance for every task's worker)

- **Working directory for all commands:** `pi-agent/dot-pi/agent` unless a step says otherwise. Paths below are relative to the repo root.
- **Before editing, read every file the task lists in full.** The codebase has strong conventions (comment style explains *why*, not *what*; pure logic split from components; tests without a terminal). Match them.
- **Do not invent APIs.** Every pi/pi-tui symbol used below was verified to exist: `Theme.fg(name, text)`, `Theme.bg(name, text)` (ThemeBg names: `selectedBg`, `userMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, …), `Theme.bold`, `Theme.inverse`, `highlightCode(code, lang?): string[]`, `getLanguageFromPath(path): string | undefined`, `copyToClipboard(text): Promise<void>`, `visibleWidth`, `truncateToWidth`, `fuzzyFilter`, `wrapTextWithAnsi`. If you need something else, stop and re-read rather than guessing.
- **Never deep-import from `@earendil-works/pi-coding-agent/dist/...`** — the package's `exports` map blocks it. Import from the package root only.
- **Never edit anything under `node_modules/`.**
- **The geometry invariant:** every rendered overlay line is exactly the declared width in visible cells. Any new painting helper must have a test asserting `visibleWidth(result) === width`.
- **Tests:** shared kit tests run with `node --test --experimental-strip-types extensions/shared/tui-kit/*.test.ts` from `pi-agent/dot-pi/agent`. Extension tests run with `npm test` inside the extension directory. Typecheck with `npm run check` (root covers shared; each extension also has its own `check`).
- **Commit after every task** with the exact message given. Do not batch tasks into one commit.

## File structure

```
pi-agent/dot-pi/agent/extensions/shared/tui-kit/
  frame.ts        borders, padding, body rows, section rules   (lifted from file-edits)
  frame.test.ts
  icons.ts        file-type + UI glyphs, Mocha RGB             (moved from file-edits, expanded)
  icons.test.ts
  paint.ts        background fills: selection + diff tints
  paint.test.ts
  highlight.ts    language resolution + line-preserving highlight
  highlight.test.ts
  scroll.ts       one scroll model: actions + offset math
  scroll.test.ts
  copy.ts         clipboard with footer-note result
  copy.test.ts
```

Extensions modified: `file-edits` (icons/frame deleted locally; viewer highlighted; picker selection; motions; copy), `commands` (frame deleted locally; picker selection; viewer blocks; collapsed errors), `subagents` (list selection; transcript blocks), `background-terminals` (ps selection; output-view scroll/copy), `ask-user` (framed card layout).

---

### Task 1: Lift `frame.ts` into tui-kit and add `sectionRule`

**Files:**
- Create: `pi-agent/dot-pi/agent/extensions/shared/tui-kit/frame.ts`
- Create: `pi-agent/dot-pi/agent/extensions/shared/tui-kit/frame.test.ts`
- Delete: `pi-agent/dot-pi/agent/extensions/file-edits/src/ui/frame.ts`, `frame.test.ts`
- Delete: `pi-agent/dot-pi/agent/extensions/commands/src/ui/frame.ts`
- Modify: import sites in `file-edits/src/ui/picker.ts`, `file-edits/src/ui/viewer.ts`, `commands/src/ui/picker.ts`, `commands/src/ui/viewer.ts`, and both `package.json` test lists.

- [ ] **Step 1: Copy `extensions/file-edits/src/ui/frame.ts` to `extensions/shared/tui-kit/frame.ts` verbatim** (it already documents the geometry rule and is the canonical version — compare with `commands/src/ui/frame.ts` first; if commands' copy has drifted, keep the file-edits version and note any delta in the commit message). Then append this to the new file:

```ts
/**
 * A labeled rule *inside* a panel body, separating sections of one view —
 * a command from its output, a transcript block from the next. Dashed, so it
 * reads as an interior seam rather than a panel edge. Exactly `width` cells.
 */
export function sectionRule(
  theme: Theme,
  width: number,
  label = "",
  labelColor: Parameters<Theme["fg"]>[0] = "accent",
): string {
  const text = label
    ? ` ${truncateToWidth(label, Math.max(0, width - 4))} `
    : "";
  const labelWidth = visibleWidth(text);
  return (
    theme.fg("border", "╌╌") +
    (text ? theme.fg(labelColor, text) : "") +
    theme.fg("border", "╌".repeat(Math.max(0, width - 2 - labelWidth)))
  );
}
```

- [ ] **Step 2: Move `extensions/file-edits/src/ui/frame.test.ts` to `extensions/shared/tui-kit/frame.test.ts`**, fix its imports (`./frame.ts`; theme stub stays as-is), and add a failing test for `sectionRule`:

```ts
test("sectionRule is exactly width cells, label truncated", () => {
  const rule = sectionRule(theme, 20, "a very long label that cannot fit");
  assert.equal(visibleWidth(rule), 20);
  const bare = sectionRule(theme, 20);
  assert.equal(visibleWidth(bare), 20);
});
```

The existing frame tests use a theme stub — reuse it unchanged. Note how existing tests build a fake `Theme`; copy that pattern exactly.

- [ ] **Step 3: Run the kit tests, expect the new test to pass and old ones green:**

Run: `node --test --experimental-strip-types extensions/shared/tui-kit/*.test.ts`
Expected: all pass.

- [ ] **Step 4: Re-point the four import sites.** In `file-edits/src/ui/picker.ts` and `file-edits/src/ui/viewer.ts` replace `from "./frame.ts"` with `from "../../../shared/tui-kit/frame.ts"`. Same change in `commands/src/ui/picker.ts` and `commands/src/ui/viewer.ts`. Delete the two local `frame.ts` files and file-edits' local `frame.test.ts`. Remove `src/ui/frame.test.ts` from `file-edits/package.json`'s test script.

- [ ] **Step 5: Verify both extensions still typecheck and test:**

Run (from `extensions/file-edits`): `npm run check && npm test`
Run (from `extensions/commands`): `npm run check && npm test`
Run (from `pi-agent/dot-pi/agent`): `npm run check`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A pi-agent/dot-pi/agent/extensions
git commit -m "refactor: lift the overlay frame into shared/tui-kit"
```

---

### Task 2: Move icons into tui-kit and expand coverage

**Files:**
- Create: `pi-agent/dot-pi/agent/extensions/shared/tui-kit/icons.ts`
- Create: `pi-agent/dot-pi/agent/extensions/shared/tui-kit/icons.test.ts`
- Delete: `pi-agent/dot-pi/agent/extensions/file-edits/src/icons.ts`, `icons.test.ts`
- Modify: `file-edits/src/render/row.ts`, `file-edits/src/ui/picker-rows.ts`, `file-edits/src/ui/viewer.ts` (imports), `file-edits/package.json` (test list).

- [ ] **Step 1: Create `extensions/shared/tui-kit/icons.ts`** — start from the existing `file-edits/src/icons.ts` (keep its header comment about literal RGB and the codepoint rationale verbatim), then extend the tables to exactly this:

```ts
const BY_NAME: Record<string, FileIcon> = {
  dockerfile: glyph(0xe7b0, BLUE),
  makefile: glyph(0xe673, PEACH),
  justfile: glyph(0xe673, PEACH),
  ".gitignore": glyph(0xe702, PEACH),
  ".gitattributes": glyph(0xe702, PEACH),
  ".env": glyph(0xe615, YELLOW),
};

const BY_EXTENSION: Record<string, FileIcon> = {
  ts: glyph(0xe628, BLUE),
  tsx: glyph(0xe628, BLUE),
  js: glyph(0xe781, YELLOW),
  jsx: glyph(0xe781, YELLOW),
  mjs: glyph(0xe781, YELLOW),
  cjs: glyph(0xe781, YELLOW),
  json: glyph(0xe60b, YELLOW),
  jsonc: glyph(0xe60b, YELLOW),
  py: glyph(0xe73c, YELLOW),
  rs: glyph(0xe7a8, PEACH),
  go: glyph(0xe627, SKY),
  c: glyph(0xe61e, BLUE),
  h: glyph(0xe61e, BLUE),
  cpp: glyph(0xe61d, BLUE),
  hpp: glyph(0xe61d, BLUE),
  java: glyph(0xe738, PEACH),
  kt: glyph(0xe634, MAUVE),
  swift: glyph(0xe755, PEACH),
  rb: glyph(0xe739, RED),
  php: glyph(0xe73d, MAUVE),
  lua: glyph(0xe620, BLUE),
  scala: glyph(0xe737, RED),
  sql: glyph(0xe706, SKY),
  sh: glyph(0xe795, GREEN),
  bash: glyph(0xe795, GREEN),
  zsh: glyph(0xe795, GREEN),
  nu: glyph(0xe795, GREEN),
  fish: glyph(0xe795, GREEN),
  md: glyph(0xe73e, SUBTEXT),
  mdx: glyph(0xe73e, SUBTEXT),
  txt: glyph(0xf016, SUBTEXT),
  toml: glyph(0xe615, PEACH),
  yaml: glyph(0xe615, PEACH),
  yml: glyph(0xe615, PEACH),
  ini: glyph(0xe615, SUBTEXT),
  css: glyph(0xe749, MAUVE),
  scss: glyph(0xe749, MAUVE),
  html: glyph(0xe736, RED),
  vue: glyph(0xe6a0, GREEN),
  svelte: glyph(0xe697, PEACH),
  graphql: glyph(0xe662, MAUVE),
  proto: glyph(0xe61e, SUBTEXT),
  tf: glyph(0xe69a, MAUVE),
  lock: glyph(0xf023, SUBTEXT),
  png: glyph(0xf1c5, MAUVE),
  jpg: glyph(0xf1c5, MAUVE),
  jpeg: glyph(0xf1c5, MAUVE),
  gif: glyph(0xf1c5, MAUVE),
  webp: glyph(0xf1c5, MAUVE),
  svg: glyph(0xf1c5, PEACH),
  pdf: glyph(0xf1c1, RED),
  zip: glyph(0xf1c6, SUBTEXT),
  csv: glyph(0xf1c3, GREEN),
};

/** Non-file glyphs the dashboards share: status, actors, time. */
export const UI_ICONS = {
  terminal: glyph(0xe795, GREEN),
  agent: glyph(0xeb99, MAUVE), // nf-cod-hubot
  clock: glyph(0xf017, SUBTEXT),
  check: glyph(0xf00c, GREEN),
  cross: glyph(0xf00d, RED),
} as const;
```

`iconFor` and `paintIcon` keep their current signatures and behavior exactly; `UI_ICONS` is a new export alongside them.

- [ ] **Step 2: Move `file-edits/src/icons.test.ts` to `extensions/shared/tui-kit/icons.test.ts`**, fix the import path, keep every existing assertion, and add:

```ts
test("expanded coverage maps new extensions off the fallback", () => {
  for (const path of ["a.rb", "b.java", "c.sql", "d.vue", "e.png", "dir/.env"]) {
    assert.notEqual(iconFor(path).glyph, iconFor("unknown.xyz123").glyph);
  }
});

test("ui icons paint without changing visible width", () => {
  for (const icon of Object.values(UI_ICONS)) {
    assert.equal(visibleWidth(paintIcon(icon)), 1);
  }
});
```

- [ ] **Step 3: Run kit tests:** `node --test --experimental-strip-types extensions/shared/tui-kit/*.test.ts` — expect green.

- [ ] **Step 4: Re-point file-edits.** Replace `from "../icons.ts"` with `from "../../../shared/tui-kit/icons.ts"` in `file-edits/src/render/row.ts` and `file-edits/src/ui/viewer.ts`, and `from "../icons.ts"` in `file-edits/src/ui/picker-rows.ts` likewise. Delete `file-edits/src/icons.ts` and `file-edits/src/icons.test.ts`; remove `src/icons.test.ts` from the package.json test list.

- [ ] **Step 5: Verify:** from `extensions/file-edits`: `npm run check && npm test`. From agent root: `npm run check`. Expect green.

- [ ] **Step 6: Commit**

```bash
git add -A pi-agent/dot-pi/agent/extensions
git commit -m "refactor: move file icons into shared/tui-kit and widen coverage"
```

---

### Task 3: `paint.ts` — background fills for selection and diff tints

**Files:**
- Create: `pi-agent/dot-pi/agent/extensions/shared/tui-kit/paint.ts`
- Create: `pi-agent/dot-pi/agent/extensions/shared/tui-kit/paint.test.ts`

This is the fiddliest unit in the plan. The problem: a row already carries `theme.fg(...)` runs, each ending in `\x1b[0m`, and that reset also cancels any background we opened. The fix is mechanical: open the background, and re-open it after every reset inside the padded row.

- [ ] **Step 1: Write failing tests** in `paint.test.ts` (use `visibleWidth` from `@earendil-works/pi-tui`; build the same fake theme the frame tests use):

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fillLine, openerOf, rgbBgOpener, DIFF_ADDED_BG, DIFF_REMOVED_BG } from "./paint.ts";

const RESET = "\x1b[0m";
const bg = (text: string) => `\x1b[48;5;237m${text}${RESET}`;

test("openerOf extracts the escape prefix of a paint function", () => {
  assert.equal(openerOf(bg), "\x1b[48;5;237m");
  assert.equal(openerOf((t) => t), "");
});

test("fillLine pads plain text to width under one background run", () => {
  const line = fillLine("abc", 10, "\x1b[48;5;237m");
  assert.equal(visibleWidth(line), 10);
  assert.ok(line.startsWith("\x1b[48;5;237m"));
  assert.ok(line.endsWith(RESET));
});

test("fillLine re-opens the background after inner resets", () => {
  const colored = `red\x1b[31mhot${RESET}end`;
  const line = fillLine(colored, 12, "\x1b[48;5;237m");
  assert.equal(visibleWidth(line), 12);
  // Every reset inside is chased by the opener, so the fill never drops.
  const inner = line.slice("\x1b[48;5;237m".length, -RESET.length);
  for (const piece of inner.split(RESET).slice(1)) {
    assert.ok(piece.startsWith("\x1b[48;5;237m"));
  }
});

test("fillLine truncates overlong rows to exactly width", () => {
  const line = fillLine("x".repeat(50), 10, rgbBgOpener(DIFF_ADDED_BG));
  assert.equal(visibleWidth(line), 10);
});
```

- [ ] **Step 2: Run to confirm failure:** `node --test --experimental-strip-types extensions/shared/tui-kit/paint.test.ts` — expect "Cannot find module … paint.ts".

- [ ] **Step 3: Implement `paint.ts`:**

```ts
/**
 * Background fills that survive a row's own colours.
 *
 * A row built from theme.fg() runs is a chain of `open…reset` segments; any
 * reset also cancels a background opened around the row. fillLine re-opens
 * the background after every reset, so the fill holds edge to edge, and the
 * visible width never changes — the invariant every overlay line lives by.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { pad } from "./frame.ts";
import type { Rgb } from "./icons.ts";

const RESET = "\x1b[0m";
const PROBE = "\u0000";

/** The opening escape sequence a paint function emits before its text. */
export function openerOf(paint: (text: string) => string): string {
  const painted = paint(PROBE);
  const at = painted.indexOf(PROBE);
  return at > 0 ? painted.slice(0, at) : "";
}

/** A truecolor background opener, for tints ThemeBg has no name for. */
export function rgbBgOpener([r, g, b]: Rgb): string {
  return `\x1b[48;2;${r};${g};${b}m`;
}

/** Pad (or truncate) to `width`, then hold `opener`'s background across the
 * whole row, re-opening after each inner reset. */
export function fillLine(text: string, width: number, opener: string): string {
  const padded = pad(text, width);
  if (!opener) return padded;
  return opener + padded.replaceAll(RESET, RESET + opener) + RESET;
}

/** The selected row in a picker: the theme's own selection background. */
export function paintSelected(text: string, width: number, theme: Theme): string {
  return fillLine(text, width, openerOf((t) => theme.bg("selectedBg", t)));
}

/**
 * Diff-line tints, literal RGB for the same reason the icons are: ThemeBg's
 * eight names have no diff entries. Both are Mocha base (30,30,46) nudged
 * toward the theme's green and red, dark enough that highlighted foreground
 * tokens stay readable on top.
 */
export const DIFF_ADDED_BG: Rgb = [40, 52, 46];
export const DIFF_REMOVED_BG: Rgb = [56, 40, 50];
```

- [ ] **Step 4: Run kit tests:** `node --test --experimental-strip-types extensions/shared/tui-kit/*.test.ts` — expect green. Also `npm run check` at agent root.

- [ ] **Step 5: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/shared/tui-kit
git commit -m "feat: add background fills to tui-kit"
```

---

### Task 4: `highlight.ts` — line-preserving syntax highlighting

**Files:**
- Create: `pi-agent/dot-pi/agent/extensions/shared/tui-kit/highlight.ts`
- Create: `pi-agent/dot-pi/agent/extensions/shared/tui-kit/highlight.test.ts`

pi exports `highlightCode(code, lang?): string[]` and `getLanguageFromPath(path)` from the package root (they use the active theme singleton, so colors always match the running TUI). The kit wraps them with one hard guarantee: **the output has exactly as many lines as the input**, so callers can zip highlighted lines back onto their diff structures. On any doubt — unknown language, mismatched count, thrown error — plain lines come back.

- [ ] **Step 1: Write failing tests** in `highlight.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { highlightBlock, languageForPath } from "./highlight.ts";

test("languageForPath resolves common extensions and swallows failures", () => {
  assert.equal(typeof (languageForPath("a/b/c.ts") ?? ""), "string");
  assert.equal(languageForPath("noext"), undefined);
});

test("highlightBlock preserves line count for real code", () => {
  const code = "const a = 1;\nfunction f() {\n  return a;\n}";
  const lines = highlightBlock(code, "typescript");
  assert.equal(lines.length, 4);
});

test("highlightBlock falls back to plain lines when language is unknown", () => {
  const code = "one\ntwo";
  assert.deepEqual(highlightBlock(code, "not-a-language-xyz"), ["one", "two"]);
  assert.deepEqual(highlightBlock(code, undefined), ["one", "two"]);
});
```

- [ ] **Step 2: Run to confirm failure**, then implement `highlight.ts`:

```ts
/**
 * Syntax highlighting for the kit, guaranteed line-preserving.
 *
 * pi's highlightCode uses the active theme singleton, so the token colours
 * always match the running TUI without any mapping here. What it does not
 * guarantee is shape: callers zip highlighted lines back onto diff hunks, so
 * a mismatched line count would smear code across the wrong rows. On any
 * doubt — no language, unknown language, count mismatch, a throw — the
 * caller gets the plain lines back and the view degrades to what it renders
 * today.
 */

import {
  getLanguageFromPath,
  highlightCode,
} from "@earendil-works/pi-coding-agent";

export function languageForPath(path: string): string | undefined {
  try {
    return getLanguageFromPath(path);
  } catch {
    return undefined;
  }
}

export function highlightBlock(
  code: string,
  language: string | undefined,
): string[] {
  const plain = code.split("\n");
  if (!language) return plain;
  try {
    const lines = highlightCode(code, language);
    return lines.length === plain.length ? lines : plain;
  } catch {
    return plain;
  }
}
```

- [ ] **Step 3: Run kit tests + root `npm run check`** — expect green. If `highlightCode` throws in the bare test environment (theme not initialized), that is exactly what the try/catch is for; the fallback test still must pass. If the "real code" test gets plain lines back in tests, weaken that assertion to line-count only (which is the contract) — do not try to initialize pi's theme in a test.

- [ ] **Step 4: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/shared/tui-kit
git commit -m "feat: add line-preserving syntax highlighting to tui-kit"
```

---

### Task 5: `scroll.ts` — one scroll model

**Files:**
- Create: `pi-agent/dot-pi/agent/extensions/shared/tui-kit/scroll.ts`
- Create: `pi-agent/dot-pi/agent/extensions/shared/tui-kit/scroll.test.ts`

Two kinds of viewers exist: bottom-anchored (commands viewer, subagent takeover — offset counts lines *up from the end*, 0 = pinned to the tail) and top-anchored (diff viewer — offset counts lines *down from the start*). One action vocabulary serves both. Views that also accept typed text (the takeover has a message editor) must pass `vimKeys: false` so `j/k/g/G` still type; they must also not get `ctrl-u`/`ctrl-d`, which editors use for kill/delete.

- [ ] **Step 1: Write failing tests** in `scroll.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyBottomAnchored,
  applyTopAnchored,
  clampOffset,
  scrollActionFor,
} from "./scroll.ts";

const keybindings = {
  matches: (data: string, binding: string) =>
    (binding === "tui.editor.cursorUp" && data === "\x1b[A") ||
    (binding === "tui.editor.cursorDown" && data === "\x1b[B") ||
    (binding === "tui.editor.pageUp" && data === "\x1b[5~") ||
    (binding === "tui.editor.pageDown" && data === "\x1b[6~"),
} as never;

test("vim keys map only when enabled", () => {
  assert.equal(scrollActionFor("j", keybindings, { vimKeys: true }), "line-down");
  assert.equal(scrollActionFor("k", keybindings, { vimKeys: true }), "line-up");
  assert.equal(scrollActionFor("g", keybindings, { vimKeys: true }), "top");
  assert.equal(scrollActionFor("G", keybindings, { vimKeys: true }), "bottom");
  assert.equal(scrollActionFor("\x04", keybindings, { vimKeys: true }), "half-down");
  assert.equal(scrollActionFor("\x15", keybindings, { vimKeys: true }), "half-up");
  assert.equal(scrollActionFor("j", keybindings, { vimKeys: false }), null);
  assert.equal(scrollActionFor("\x04", keybindings, { vimKeys: false }), null);
});

test("arrow and page keys map regardless of vim mode", () => {
  assert.equal(scrollActionFor("\x1b[A", keybindings, { vimKeys: false }), "line-up");
  assert.equal(scrollActionFor("\x1b[6~", keybindings, { vimKeys: false }), "page-down");
});

test("bottom-anchored offsets grow upward and clamp at the tail", () => {
  assert.equal(applyBottomAnchored(0, "line-up", 20), 1);
  assert.equal(applyBottomAnchored(1, "line-down", 20), 0);
  assert.equal(applyBottomAnchored(0, "line-down", 20), 0);
  assert.equal(applyBottomAnchored(0, "half-up", 20), 10);
  assert.equal(applyBottomAnchored(0, "bottom", 20), 0);
  assert.ok(applyBottomAnchored(0, "top", 20) > 1_000_000);
});

test("top-anchored offsets grow downward and floor at zero", () => {
  assert.equal(applyTopAnchored(0, "line-down", 20), 1);
  assert.equal(applyTopAnchored(0, "line-up", 20), 0);
  assert.equal(applyTopAnchored(5, "half-down", 20), 15);
  assert.equal(applyTopAnchored(99, "top", 20), 0);
  assert.ok(applyTopAnchored(0, "bottom", 20) > 1_000_000);
});

test("clampOffset pins into range", () => {
  assert.equal(clampOffset(Number.MAX_SAFE_INTEGER, 42), 42);
  assert.equal(clampOffset(-3, 42), 0);
});
```

- [ ] **Step 2: Run to confirm failure, then implement `scroll.ts`:**

```ts
/**
 * One scroll model for every viewer, so `j` means the same thing in /cmds,
 * /files, and /ps output.
 *
 * Views that also accept typed text (the subagent takeover has a message
 * editor) pass vimKeys: false — printable keys and ctrl-u/ctrl-d belong to
 * the editor there, and only arrows and page keys scroll.
 */

import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";

export type ScrollAction =
  | "line-up"
  | "line-down"
  | "half-up"
  | "half-down"
  | "page-up"
  | "page-down"
  | "top"
  | "bottom";

export interface ScrollKeyOptions {
  readonly vimKeys: boolean;
}

export function scrollActionFor(
  data: string,
  keybindings: KeybindingsManager,
  { vimKeys }: ScrollKeyOptions,
): ScrollAction | null {
  if (keybindings.matches(data, "tui.editor.cursorUp")) return "line-up";
  if (keybindings.matches(data, "tui.editor.cursorDown")) return "line-down";
  if (keybindings.matches(data, "tui.editor.pageUp")) return "page-up";
  if (keybindings.matches(data, "tui.editor.pageDown")) return "page-down";
  if (!vimKeys) return null;
  if (data === "k") return "line-up";
  if (data === "j") return "line-down";
  if (data === "\x15") return "half-up"; // ctrl-u
  if (data === "\x04") return "half-down"; // ctrl-d
  if (data === "g") return "top";
  if (data === "G") return "bottom";
  return null;
}

const FAR = Number.MAX_SAFE_INTEGER;

/** Offset counts lines up from the end; 0 is pinned to the tail. Callers
 * clamp against their own max in render, where content length is known. */
export function applyBottomAnchored(
  offset: number,
  action: ScrollAction,
  viewport: number,
): number {
  const half = Math.max(1, Math.floor(viewport / 2));
  switch (action) {
    case "line-up": return offset + 1;
    case "line-down": return Math.max(0, offset - 1);
    case "half-up": return offset + half;
    case "half-down": return Math.max(0, offset - half);
    case "page-up": return offset + viewport;
    case "page-down": return Math.max(0, offset - viewport);
    case "top": return FAR;
    case "bottom": return 0;
  }
}

/** Offset counts lines down from the start; 0 is the first line. */
export function applyTopAnchored(
  offset: number,
  action: ScrollAction,
  viewport: number,
): number {
  const half = Math.max(1, Math.floor(viewport / 2));
  switch (action) {
    case "line-up": return Math.max(0, offset - 1);
    case "line-down": return offset + 1;
    case "half-up": return Math.max(0, offset - half);
    case "half-down": return offset + half;
    case "page-up": return Math.max(0, offset - viewport);
    case "page-down": return offset + viewport;
    case "top": return 0;
    case "bottom": return FAR;
  }
}

export function clampOffset(offset: number, max: number): number {
  return Math.max(0, Math.min(offset, max));
}
```

- [ ] **Step 3: Run kit tests + root check — green. Commit:**

```bash
git add pi-agent/dot-pi/agent/extensions/shared/tui-kit
git commit -m "feat: add the shared scroll model to tui-kit"
```

---

### Task 6: `copy.ts` — clipboard with a footer note

**Files:**
- Create: `pi-agent/dot-pi/agent/extensions/shared/tui-kit/copy.ts`
- Create: `pi-agent/dot-pi/agent/extensions/shared/tui-kit/copy.test.ts`

- [ ] **Step 1: Failing tests:**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { copyText } from "./copy.ts";

test("reports success with the label", async () => {
  const note = await copyText("hello", "command", async () => {});
  assert.equal(note, "copied command");
});

test("reports failure without throwing", async () => {
  const note = await copyText("hello", "command", async () => {
    throw new Error("no clipboard");
  });
  assert.equal(note, "copy failed");
});
```

- [ ] **Step 2: Implement `copy.ts`:**

```ts
/**
 * Copy with a one-line receipt. Viewers show the returned note in their
 * footer; there is no other error UI, so this never throws.
 */

import { copyToClipboard } from "@earendil-works/pi-coding-agent";

export async function copyText(
  text: string,
  label: string,
  copier: (text: string) => Promise<void> = copyToClipboard,
): Promise<string> {
  try {
    await copier(text);
    return `copied ${label}`;
  } catch {
    return "copy failed";
  }
}
```

- [ ] **Step 3: Kit tests + root check green. Commit:**

```bash
git add pi-agent/dot-pi/agent/extensions/shared/tui-kit
git commit -m "feat: add clipboard copy with receipts to tui-kit"
```

---

### Task 7: file-edits — syntax-highlighted diffs

**Files:**
- Modify: `pi-agent/dot-pi/agent/extensions/file-edits/src/ui/viewer.ts`
- Test: `pi-agent/dot-pi/agent/extensions/file-edits/src/ui/viewer.test.ts`

Read `viewer.ts` fully first — `paint()`, `stackedLines()`, `splitLines()` are the functions changing. The design, exactly:

- **Context lines:** syntax-highlighted (via a per-change cache), no fill.
- **Add/remove lines *without* an intraline counterpart:** syntax-highlighted code over the `DIFF_ADDED_BG` / `DIFF_REMOVED_BG` tint (via `fillLine` + `rgbBgOpener`).
- **Add/remove lines *with* a counterpart:** keep today's intraline painting (fg color + `theme.inverse` on changed spans) but over the same background tint. Syntax highlight is intentionally skipped on these lines — span boundaries cannot be mapped onto an already-ANSI-colored string. Leave a comment saying exactly that.
- The marker (`+`/`−`) and line-number gutter keep their current fg colors, *outside* the fill.

- [ ] **Step 1: Add a failing viewer test.** Look at how `viewer.test.ts` currently constructs changes/hunks and follow that pattern. Assert on the pure pieces you extract (next step), e.g.:

```ts
test("hunk highlighting is line-preserving and cached per change", () => {
  // Build the FileChange exactly the way the existing tests in this file do
  // (copy their fixture helper), with a single hunk of three DiffLines.
  const change = makeChange(/* one 3-line ts hunk */);
  const first = highlightForChange(change, "src/a.ts");
  assert.equal(first.size, 3);
  assert.strictEqual(highlightForChange(change, "src/a.ts"), first); // same map, cached
});

test("tinted diff lines keep exact width", () => {
  const line = paintDiffLine(/* add-line with no counterpart */, 40, theme, highlighted);
  assert.equal(visibleWidth(line), 40);
});
```

- [ ] **Step 2: Implement.** In `viewer.ts`:
  1. Import `languageForPath`, `highlightBlock` from `../../../shared/tui-kit/highlight.ts` and `fillLine`, `rgbBgOpener`, `DIFF_ADDED_BG`, `DIFF_REMOVED_BG` from `../../../shared/tui-kit/paint.ts`.
  2. Add a module-level pure function (exported for tests):

```ts
/** One highlight pass per hunk, zipped back line-for-line. The WeakMap keys
 * on the FileChange object: resolveHunks replaces the object, so a new diff
 * naturally re-highlights and a scroll never does. */
const highlightCache = new WeakMap<FileChange, Map<DiffLine, string>>();

export function highlightForChange(
  change: FileChange,
  path: string,
): Map<DiffLine, string> {
  const cached = highlightCache.get(change);
  if (cached) return cached;
  const language = languageForPath(path);
  const map = new Map<DiffLine, string>();
  for (const hunk of change.hunks) {
    const lines = highlightBlock(
      hunk.lines.map((line) => line.text).join("\n"),
      language,
    );
    hunk.lines.forEach((line, i) => map.set(line, lines[i] ?? line.text));
  }
  highlightCache.set(change, map);
  return map;
}
```

  3. Rework `paint()` so it returns the *code portion only* (highlighted or intraline-painted, per the design above), and have `stackedLines`/`splitLines` compose `gutter + marker + fillLine(code, remainingWidth, tintOpener)` for add/remove lines, and `gutter + marker + code` for context. `remainingWidth` is the pane/body width minus `visibleWidth` of gutter+marker. Both modes must keep their existing width behavior (`truncateToWidth` to the pane, pad in split cells) — run the existing viewer tests to prove nothing regressed.

- [ ] **Step 3: Add the new test files to nothing** (viewer.test.ts is already in the package.json test list). Run from `extensions/file-edits`: `npm run check && npm test`. Expected: green.

- [ ] **Step 4: Manually sanity-check** if a pi session is available: open `/files` on a TS file edit; tokens colored, added lines green-tinted, removed red-tinted, intraline inverse still visible. Skip silently if no interactive session is possible.

- [ ] **Step 5: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/file-edits
git commit -m "feat: syntax-highlight the diff viewer"
```

---

### Task 8: file-edits — vim motions and copy in the diff viewer

**Files:**
- Modify: `pi-agent/dot-pi/agent/extensions/file-edits/src/ui/viewer.ts`

- [ ] **Step 1:** Replace the viewer's hand-rolled `j`/`k` handling in `handleInput` with the kit: on each input compute `scrollActionFor(data, this.keybindings, { vimKeys: true })`; if non-null, `this.offset = applyTopAnchored(this.offset, action, this.lastViewport)` and request a render. Track `lastViewport` in `render()` (it already computes `height`). Existing clamping in `render()` stays (it is `clampOffset` by hand — switch it to the kit's `clampOffset` for uniformity). Keep `s`, `n`, `p`, `q`, cancel exactly as they are; scroll matching must run *after* those.

- [ ] **Step 2:** Add `y` copy: serialize the current change (`hunks` → lines prefixed `+`/`−`/space, hunks separated by blank lines) and:

```ts
if (data === "y") {
  const change = this.change();
  if (change) {
    const text = change.hunks
      .map((hunk) =>
        hunk.lines
          .map((l) => `${l.kind === "add" ? "+" : l.kind === "remove" ? "-" : " "}${l.text}`)
          .join("\n"),
      )
      .join("\n\n");
    void copyText(text, "diff").then((note) => {
      this.copyNote = note;
      this.tui.requestRender();
    });
  }
  return;
}
```

Show `this.copyNote` (a `string | undefined`, cleared on any other keypress) appended dim in the legend line, and add `ctrl-d/u half · g/G top/bottom · y copy` to the legend text.

- [ ] **Step 3:** From `extensions/file-edits`: `npm run check && npm test` — green (add a navigation test only if you extracted new pure logic; the kit already tests the math).

- [ ] **Step 4: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/file-edits
git commit -m "feat: vim motions and copy in the diff viewer"
```

---

### Task 9: Full-row selection in the /files and /cmds pickers

**Files:**
- Modify: `pi-agent/dot-pi/agent/extensions/file-edits/src/ui/picker.ts`
- Modify: `pi-agent/dot-pi/agent/extensions/commands/src/ui/picker.ts`

Both pickers currently render `marker + row` where `marker` is `"› "` or two spaces. The change, identical in both files (shown for file-edits; mirror in commands with its own row variables):

- [ ] **Step 1:** Import `paintSelected` from the kit (`../../../shared/tui-kit/paint.ts`). In the row loop replace:

```ts
const selected = start + index === this.state.index;
const marker = selected ? theme.fg("accent", "› ") : "  ";
const body = renderPickerRow(change, inner - 2, theme, now);
lines.push(bodyRow(theme, width, marker + body));
```

with:

```ts
const selected = start + index === this.state.index;
const marker = selected ? theme.fg("accent", "❯ ") : "  ";
const body = marker + renderPickerRow(change, inner - 2, theme, now);
lines.push(
  bodyRow(theme, width, selected ? paintSelected(body, inner, theme) : body),
);
```

The marker stays (it anchors the eye at the left edge); the background fill is what makes the row unmistakable in a crowded list. `paintSelected` pads to `inner`, and `bodyRow`'s own `pad` then adds nothing — width is unchanged.

- [ ] **Step 2:** From each of `extensions/file-edits` and `extensions/commands`: `npm run check && npm test` — green.

- [ ] **Step 3: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/file-edits pi-agent/dot-pi/agent/extensions/commands
git commit -m "feat: full-row selection highlight in the file and command pickers"
```

---

### Task 10: commands viewer — framed command block, unified scrolling, copy

**Files:**
- Modify: `pi-agent/dot-pi/agent/extensions/commands/src/ui/viewer.ts`
- Test: `pi-agent/dot-pi/agent/extensions/commands/src/ui/viewer.test.ts`

Read `viewer.ts` fully. Today the command is clamped to 3 lines above the border and only the output scrolls. New layout — **one bottom-anchored scroll region containing everything**:

```
──────────────────────────────────────────  border
✓ bash · exit 0 · 1.2s · 42 lines · 3.1 KB  header (fixed)
──────────────────────────────────────────  border
╌╌ $ command ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌  ┐
$ npm test                                  │ scrollable body:
  --workspaces                              │ full command (no clamp),
╌╌ output ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌  │ rule, output lines,
…output lines…                              │ rule with exit status
╌╌ exit 0 · 1.2s ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌  ┘
──────────────────────────────────────────  border
esc back · n/p · f · j/k/ctrl-d/u/g/G · y/Y copy   legend
```

Note: the record's `output` is a single combined stream — stderr is not separable, so there is no per-stream styling (the spec's stderr gutter is dropped for that reason; the exit-status rule carries the failure signal, colored with the existing `statusColor(record)`).

- [ ] **Step 1: Write/adjust failing tests.** `viewer.test.ts` already tests pure pieces (e.g. `stepId`). Add a pure `buildBody` function and test it:

```ts
test("body holds command, rules, output, and status in order", () => {
  const lines = buildBody(record, ["out1", "out2"], theme, 60);
  assert.ok(lines[0].includes("$"));            // command rule
  assert.ok(lines.at(-1)!.includes("exit"));    // status rule
  for (const line of lines) assert.ok(visibleWidth(line) <= 60);
});
```

- [ ] **Step 2: Implement.**
  1. Export a pure `buildBody(record, outputLines, theme, width): string[]` that returns: `sectionRule(theme, width, "$ command")`-style rule (label literally `$ …first 40 chars of the command…`), then every sanitized command line prefixed `$ ` / `  ` (continuations), then `sectionRule(theme, width, "output", "muted")`, then the output lines (already wrapped by the existing `lineCache`), then `sectionRule(theme, width, formatStatus(record) + " · " + formatDuration(record.durationMs), statusColor(record))`.
  2. In `render()`, feed `buildBody(...)` into the existing bottom-anchored viewport logic in place of `output` (the note line handling stays).
  3. Replace the scroll `handleInput` branches with the kit (`vimKeys: true`, bottom-anchored). Keep `n`, `p`, `f`, cancel first, scrolling after. The old `SCROLL_STEP = 6` constant dies; vim `j/k` is one line, `ctrl-d/u` half viewport.
  4. Add `y` (copies `record.command`) and `Y` (copies the currently shown output text) with the `copyNote` footer pattern from Task 8.
  5. Delete the 3-line clamp on the command (the `.slice(0, 3)`) — the command now lives in the scroll body.

- [ ] **Step 3:** From `extensions/commands`: `npm run check && npm test` — green.

- [ ] **Step 4: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/commands
git commit -m "feat: framed command blocks and vim motions in the command viewer"
```

---

### Task 11: commands — plain collapsed rows for failed commands

**Files:**
- Modify: `pi-agent/dot-pi/agent/extensions/commands/index.ts`
- Modify: `pi-agent/dot-pi/agent/extensions/commands/src/render/row.ts`
- Test: `pi-agent/dot-pi/agent/extensions/commands/src/render/row.test.ts`

Today `renderResult` delegates to the built-in when `context.isError` — that is where the colored box comes from in the collapsed transcript. Failed commands should collapse like everything else, but with the failure and a peek of the tail output visible in plain text.

- [ ] **Step 1: Failing test** in `row.test.ts` (follow the file's existing fixtures):

```ts
test("a failed record collapses to header plus a plain output tail", () => {
  const lines = renderCollapsedRow(failedRecord, 80, theme);
  assert.ok(lines.length >= 2 && lines.length <= 4);
  for (const line of lines) assert.ok(!line.includes("\x1b[4")); // no bg fills
});
```

(The `\x1b[4` assertion catches any 48;… background sequence; foreground colors are fine.)

- [ ] **Step 2: Implement.** In `row.ts`'s `renderCollapsedRow` (read it first — it mirrors file-edits' structure): when the record failed, append up to 2 trailing output lines, dim, prefixed `│ `, after the existing header/peek. In `index.ts`, change the delegation condition from

```ts
if (context.isError || expanded || options.isPartial || !record) {
```

to

```ts
if (expanded || options.isPartial || !record) {
```

and update the surrounding comment: failures now collapse too — the tail peek carries the signal, and ctrl+o still expands to the full built-in rendering. **Keep the built-in cleanup call** (the "not a rendering call" block that clears the 1Hz timer) exactly where it is.

- [ ] **Step 3:** From `extensions/commands`: `npm run check && npm test` — green.

- [ ] **Step 4: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/commands
git commit -m "feat: collapse failed commands to a plain row with an output peek"
```

---

### Task 12: file-edits — audit collapsed delegation (no colored boxes)

**Files:**
- Read fully, then modify as found: `pi-agent/dot-pi/agent/extensions/file-edits/index.ts`, `file-edits/src/render/row.ts`
- Test: `pi-agent/dot-pi/agent/extensions/file-edits/src/render/row.test.ts`

- [ ] **Step 1:** Read `file-edits/index.ts` lines 1–200 (the edit/write tool re-registrations). List every branch of `renderCall`/`renderResult` that delegates to the built-in renderer. The rule after this task: **delegation happens only when `expanded` or `options.isPartial` (streaming) or when there is no record** — never for a settled, collapsed call, errored or not.

- [ ] **Step 2:** For any branch that violates the rule (the error path is the likely one, mirroring Task 11), change it the same way: collapsed error rows render `CollapsedRow` with an added dim one-line reason (the tool result's error text, `oneLine`-folded — check how commands' `row.ts` did it in Task 11 and match). Add a `row.test.ts` case asserting the error row has no background sequences (same `\x1b[4` probe as Task 11). If the audit finds nothing to change, add the test anyway (it pins the behavior) and say "audit found delegation already clean" in the commit body.

- [ ] **Step 3:** From `extensions/file-edits`: `npm run check && npm test` — green.

- [ ] **Step 4: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/file-edits
git commit -m "fix: keep collapsed edit rows plain in every settled state"
```

---

### Task 13: subagents — list selection and framed transcript blocks

**Files:**
- Modify: `pi-agent/dot-pi/agent/extensions/subagents/src/ui/takeover.ts` (list rows ~line 319, scroll `handleInput` ~line 451)
- Modify: `pi-agent/dot-pi/agent/extensions/subagents/src/ui/transcript.ts`
- Test: `pi-agent/dot-pi/agent/extensions/subagents/takeover.test.ts`

Constraint to respect: the takeover view owns a message editor — printable keys and ctrl-u/d must keep going to `this.input.handleInput(data)`. So: `scrollActionFor(..., { vimKeys: false })` only; behavior equals today's arrows/page keys, now via the kit.

- [ ] **Step 1: List selection.** At the `❯` marker site (~line 320), apply the same pattern as Task 9: keep the marker, wrap the assembled row in `paintSelected(row, width, theme)` when selected. Import path from `src/ui/`: `../../../shared/tui-kit/paint.ts`.

- [ ] **Step 2: Transcript blocks.** In `transcript.ts`, find the tool-call rendering (read the whole file; it has one function per item kind). For bash-like tool calls (the item carries the tool name and arguments — inspect `TranscriptItem` in `src/domain.ts` first), render:

```
╌╌ $ <first line of command> ╌╌╌╌╌╌╌╌  (sectionRule, accent label)
  <output/result lines as today, unchanged>
```

using `sectionRule` from the kit. Non-bash tool calls get `sectionRule(theme, width, toolName, "muted")`. Every emitted line still goes through the existing `truncateToWidth(..., width)` discipline. Add a takeover.test.ts case following its existing transcript fixtures: the rendered lines for a bash tool call include one rule line containing `$`, and all lines satisfy `visibleWidth(line) <= width`.

- [ ] **Step 3: Scroll via the kit.** Replace the four scroll branches in the takeover's `handleInput` with `scrollActionFor(data, this.keybindings, { vimKeys: false })` + `applyBottomAnchored`, keeping the existing clamp-in-render. Everything unmatched still falls through to `this.input.handleInput(data)`.

- [ ] **Step 4:** From `extensions/subagents`: `npm run check && npm test` — green.

- [ ] **Step 5: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/subagents
git commit -m "feat: selection fill and framed tool blocks in the subagent takeover"
```

---

### Task 14: background-terminals — /ps selection, output-view motions and copy

**Files:**
- Modify: `pi-agent/dot-pi/agent/extensions/background-terminals/src/ui/ps.ts` (marker ~line 323)
- Modify: `pi-agent/dot-pi/agent/extensions/background-terminals/src/ui/output-view.ts`
- Test: `pi-agent/dot-pi/agent/extensions/background-terminals/ps.test.ts`, `output.test.ts`

- [ ] **Step 1:** `/ps` rows: same selection pattern as Task 9 at the `❯` marker site. Import path from `src/ui/`: `../../../shared/tui-kit/paint.ts`.

- [ ] **Step 2:** Read `output-view.ts` fully. If it has its own input handling (it renders a terminal's output): wire `scrollActionFor` with `vimKeys: true` **only if the view accepts no typed input**; if it forwards keys to a terminal or filter, use `vimKeys: false` and say so in a comment. Add `y` copy of the visible buffer (the view's existing source of truth for output text) with the `copyNote` footer pattern. If the view turns out to be render-only (no `handleInput`), skip it entirely and note that in the commit body — do not force input handling onto a component that has none.

- [ ] **Step 3:** From `extensions/background-terminals`: `npm run check && npm test` — green.

- [ ] **Step 4: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/background-terminals
git commit -m "feat: selection fill in /ps and unified scrolling in the output view"
```

---

### Task 15: ask-user — framed question card with selection fill

**Files:**
- Modify: `pi-agent/dot-pi/agent/extensions/ask-user/index.ts` (the `render` function, ~lines 255–320)

The component is inline (not an overlay), so width discipline is `truncateToWidth` per line, as today. New layout, using the kit:

```
╭ Question ────────────────────────────╮
│ Which approach should we take?       │
│                                      │
│ ❯ 1. Option one              ← filled selection row
│      its description         ← inside the fill when selected
│   2. Option two
│   ✎ Write my own answer
│                                      │
│ ↑↓ or 1-3 select · Enter · Esc       │
╰──────────────────────────────────────╯
```

- [ ] **Step 1:** Import `topBorder`, `bottomBorder`, `bodyRow` from `shared/tui-kit/frame.ts` and `paintSelected` from `shared/tui-kit/paint.ts` (relative path from `ask-user/`: `../shared/tui-kit/...`). Rebuild `render(width)`:
  - `topBorder(theme, width, "Question")`, question lines and everything else through `bodyRow(theme, width, ...)`, `bottomBorder(theme, width)` at the end. The existing `wrapText` keeps wrapping the question at `width - 4`.
  - Option rows: build `label = (selected ? "❯ " : "  ") + marker + " " + opt.label` exactly as today, then `bodyRow(theme, width, selected ? paintSelected(label, width - 2, theme) : label)`. A selected option's description line is also filled; unselected descriptions stay dim/indented.
  - Edit mode (custom answer) keeps the current editor embed, wrapped in `bodyRow` lines.
  - Keep the `cachedLines` invalidation behavior exactly as-is.

- [ ] **Step 2:** ask-user has no test script today (check its `package.json`) — do not add a test harness in this task; verify by `npm run check` from `extensions/ask-user` and root `npm run check`.

- [ ] **Step 3: Commit**

```bash
git add pi-agent/dot-pi/agent/extensions/ask-user
git commit -m "feat: frame the ask-user question as a card with selection fill"
```

---

### Task 16: /files completeness audit

**Files:**
- Read: `file-edits/index.ts`, `file-edits/src/record.ts`, `file-edits/src/observe.ts`, `file-edits/src/store.ts` and their tests
- Modify: whatever the audit finds; at minimum add tests to `file-edits/src/record.test.ts` / `store.test.ts`

The user reported /files "felt incomplete" without a reproducible case. Audit these scenarios; for each, either point to an existing test, or write one; fix what fails:

- [ ] **Step 1:** A `write` that creates a brand-new file → store row with `isNew: true`, visible in the picker immediately (not only after opening the viewer).
- [ ] **Step 2:** A `write` over an existing file → recorded with counts from content, `hunksPending` path resolves on viewer open (`needsHunkResolution` covers it — verify with a test if none exists).
- [ ] **Step 3:** An `edit` whose result carries no `details.patch` → still recorded (zero counts) rather than dropped.
- [ ] **Step 4:** A failed `edit`/`write` followed by a successful retry on the same path → exactly one recorded change reflecting the success (and the failure alone records nothing — consistent with commit `cecec22`).
- [ ] **Step 5:** A child-session file event with a relative path and no `cwd` → keyed correctly (see `observe.ts`'s join logic; test the `value.cwd === undefined` branch).
- [ ] **Step 6:** Whatever failed above: fix it minimally in `record.ts`/`observe.ts`/`index.ts`, TDD-style. If everything passes, the deliverable is the new tests plus a commit message body stating "audit: no gap found; scenarios pinned by tests".
- [ ] **Step 7:** From `extensions/file-edits`: `npm run check && npm test` — green. Commit:

```bash
git add pi-agent/dot-pi/agent/extensions/file-edits
git commit -m "test: pin the /files recording scenarios found by the audit"
```

---

### Task 17: Final verification

- [ ] **Step 1:** From `pi-agent/dot-pi/agent`: `npm run check` — clean.
- [ ] **Step 2:** Kit suite: `node --test --experimental-strip-types extensions/shared/tui-kit/*.test.ts` — green.
- [ ] **Step 3:** Every touched extension, from its directory: `npm run check && npm test` (`file-edits`, `commands`, `subagents`, `background-terminals`; `ask-user` check only) — green.
- [ ] **Step 4:** Update `pi-agent/README.md`: add a short "shared/tui-kit" paragraph (what it is, that new extensions should use it) in the same voice as the existing sections.
- [ ] **Step 5: Commit**

```bash
git add pi-agent/README.md
git commit -m "docs: describe the shared tui-kit"
```

---

## Deviations from the spec (agreed during planning)

- The subagent takeover keeps `vimKeys: false` (its message editor owns `j/k/g/G` and `ctrl-u/d`); it scrolls with arrows/page keys through the kit. Full vim motions land in /cmds, /files, and /ps instead.
- No stderr gutter in the commands viewer: the record's output is one combined stream, so streams cannot be told apart. The exit-status section rule carries the failure signal.
- Intraline-paired diff lines keep intraline painting (over the new tint) instead of syntax highlighting — span boundaries cannot be mapped onto an ANSI-highlighted string.
- Mouse-clickable copy buttons: not in this plan (investigation-only stretch, per spec).
