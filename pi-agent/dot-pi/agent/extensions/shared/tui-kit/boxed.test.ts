/**
 * The caching contract boxedDelegation makes with a render slot: the box is
 * reused across calls, its previous inner is handed back to the built-in as
 * lastComponent, and a foreign lastComponent goes through `unwrap` first.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Text } from "@earendil-works/pi-tui";
import { BoxedDelegate, boxedDelegation } from "./boxed.ts";

type Ctx = { lastComponent: unknown };

test("the same box is reused across calls", () => {
  const ctx: Ctx = { lastComponent: undefined };
  const box1 = boxedDelegation(ctx, 1, undefined, (c) => c, () => new Text("a"));
  const box2 = boxedDelegation(
    { lastComponent: box1 },
    1,
    undefined,
    (c) => c,
    () => new Text("b"),
  );
  assert.equal(box1, box2);
});

test("on reuse, render sees the box's previous inner as lastComponent", () => {
  const ctx: Ctx = { lastComponent: undefined };
  const first = new Text("a");
  const box = boxedDelegation(ctx, 1, undefined, (c) => c, () => first);
  let seen: unknown;
  boxedDelegation(
    { lastComponent: box },
    1,
    undefined,
    (c) => c,
    (c) => {
      seen = c.lastComponent;
      return new Text("b");
    },
  );
  assert.equal(seen, first);
});

test("a foreign lastComponent goes through unwrap first", () => {
  const foreign = { note: "not a BoxedDelegate" };
  const unwrapped = new Text("unwrapped");
  const unwrap = (_c: Ctx) => ({ lastComponent: unwrapped });
  let seen: unknown;
  boxedDelegation({ lastComponent: foreign }, 1, undefined, unwrap, (c) => {
    seen = c.lastComponent;
    return new Text("b");
  });
  assert.equal(seen, unwrapped);
});

test("bgFn is re-applied on every call", () => {
  const bg = (text: string) => `\x1b[48;2;0;0;0m${text}\x1b[0m`;
  const ctx: Ctx = { lastComponent: undefined };
  const box1 = boxedDelegation(ctx, 1, bg, (c) => c, () => new Text("a"));
  assert.ok(box1.render(20).some((line) => line.includes("\x1b[48")));

  const box2 = boxedDelegation(
    { lastComponent: box1 },
    1,
    undefined,
    (c) => c,
    () => new Text("a"),
  );
  assert.ok(box2.render(20).every((line) => !line.includes("\x1b[48")));
});

test("the box wraps the inner component's rendered lines", () => {
  const ctx: Ctx = { lastComponent: undefined };
  const box = boxedDelegation(ctx, 0, undefined, (c) => c, () => new Text("hello"));
  const lines = box.render(20);
  assert.ok(lines.some((line) => line.includes("hello")));
  assert.ok(box instanceof BoxedDelegate);
});
