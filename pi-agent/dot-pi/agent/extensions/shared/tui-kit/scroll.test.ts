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
