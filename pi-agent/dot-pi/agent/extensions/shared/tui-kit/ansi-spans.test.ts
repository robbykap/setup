/**
 * Tests for the overlay invariant: emphasis goes in, escape sequences and
 * visible characters come out untouched. `strip` is the arbiter — if the
 * stripped output ever differs from the stripped input, the overlay has eaten
 * something it had no business touching.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { overlayRanges, visibleLength } from "./ansi-spans.ts";

const BG = "\x1b[48;2;40;52;46m";
const CLOSE = "\x1b[49m";
const RESET = "\x1b[0m";
const FG = "\x1b[38;2;1;2;3m";
const FG_CLOSE = "\x1b[39m";

const strip = (s: string) => s.replaceAll(/\x1b\[[0-9;]*m/g, "");
const escapes = (s: string) => s.match(/\x1b\[[0-9;]*m/g) ?? [];
const count = (s: string, piece: string) => s.split(piece).length - 1;

test("overlays a range of plain text", () => {
  const line = overlayRanges("hello world", [{ start: 6, end: 11 }], BG, RESET);
  assert.equal(line, `hello ${BG}world${RESET}`);
  assert.equal(strip(line), "hello world");
});

test("keeps every escape of a coloured line, in order", () => {
  const text = `${FG}const${FG_CLOSE} x = 1`;
  const line = overlayRanges(text, [{ start: 6, end: 7 }], BG, CLOSE);

  assert.deepEqual(
    escapes(line).filter((e) => e !== BG && e !== CLOSE),
    [FG, FG_CLOSE],
  );
  assert.equal(strip(line), strip(text));
  assert.equal(line, `${FG}const${FG_CLOSE} ${BG}x${CLOSE} = 1`);
});

test("a range spanning an escape boundary opens and closes once", () => {
  const text = `${FG}const${FG_CLOSE}${FG}value${FG_CLOSE}`;
  const line = overlayRanges(text, [{ start: 3, end: 8 }], BG, CLOSE);

  assert.equal(strip(line), "constvalue");
  assert.equal(count(line, BG), 1);
  assert.equal(count(line, CLOSE), 1);
  // The narrow fg close is harmless to a background, so it goes un-chased.
  assert.ok(!line.includes(`${FG_CLOSE}${BG}`));
});

test("re-opens after a full reset inside a range", () => {
  const line = overlayRanges(`ab${RESET}cd`, [{ start: 0, end: 4 }], BG, CLOSE);
  assert.ok(line.includes(RESET + BG));
  assert.equal(strip(line), "abcd");
});

test("re-opens after a narrow background close inside a range", () => {
  const text = `ab${CLOSE}cd`;
  const line = overlayRanges(text, [{ start: 0, end: 4 }], BG, RESET);
  assert.ok(line.includes(CLOSE + BG));
  assert.equal(strip(line), "abcd");
});

test("a reset outside every range is left alone", () => {
  const line = overlayRanges(`ab${RESET}cd`, [{ start: 0, end: 2 }], BG, CLOSE);
  assert.equal(line, `${BG}ab${CLOSE}${RESET}cd`);
  assert.equal(count(line, BG), 1);
});

test("unsorted overlapping ranges match their merged equivalent", () => {
  const text = "the quick brown fox";
  const messy = [
    { start: 10, end: 15 },
    { start: 0, end: 3 },
    { start: 4, end: 12 },
  ];
  assert.equal(
    overlayRanges(text, messy, BG, CLOSE),
    overlayRanges(
      text,
      [
        { start: 0, end: 3 },
        { start: 4, end: 15 },
      ],
      BG,
      CLOSE,
    ),
  );
});

test("adjacent ranges fuse into one run", () => {
  const line = overlayRanges(
    "abcdef",
    [
      { start: 0, end: 3 },
      { start: 3, end: 6 },
    ],
    BG,
    CLOSE,
  );
  assert.equal(line, `${BG}abcdef${CLOSE}`);
});

test("clamps out-of-bounds ranges and drops the ones past the end", () => {
  const text = "abcde";
  assert.equal(
    overlayRanges(text, [{ start: -4, end: 99 }], BG, CLOSE),
    `${BG}abcde${CLOSE}`,
  );
  assert.equal(overlayRanges(text, [{ start: 9, end: 12 }], BG, CLOSE), text);
  // Inverted and empty ranges are not ranges at all.
  assert.equal(overlayRanges(text, [{ start: 3, end: 3 }], BG, CLOSE), text);
  assert.equal(overlayRanges(text, [{ start: 4, end: 2 }], BG, CLOSE), text);
});

test("nothing to overlay returns the very same string", () => {
  const text = `${FG}const${FG_CLOSE} x`;
  assert.equal(overlayRanges(text, [], BG, CLOSE), text);
  assert.equal(overlayRanges(text, [{ start: 0, end: 5 }], "", CLOSE), text);
});

test("offsets count code points, so an emoji is one character", () => {
  const line = overlayRanges("a🎉bc", [{ start: 2, end: 4 }], BG, CLOSE);
  assert.equal(line, `a🎉${BG}bc${CLOSE}`);
  assert.equal(strip(line), "a🎉bc");
});

test("visibleLength ignores escapes and counts code points", () => {
  assert.equal(visibleLength(`${FG}const${FG_CLOSE} x`), 7);
  assert.equal(visibleLength("🎉"), 1);
  assert.equal("🎉".length, 2); // the UTF-16 count this deliberately is not
  assert.equal(visibleLength(`${BG}🎉🎉${RESET}`), 2);
  assert.equal(visibleLength(""), 0);
});

test("a lone escape byte is treated as visible, not as a swallowed tail", () => {
  const text = "a\x1b[3b";
  assert.equal(visibleLength(text), 5);
  assert.equal(
    strip(overlayRanges(text, [{ start: 0, end: 5 }], BG, CLOSE)),
    text,
  );
});
