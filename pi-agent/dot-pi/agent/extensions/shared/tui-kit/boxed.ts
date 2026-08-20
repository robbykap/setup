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
 *
 * `paddingY` only takes effect the first time this slot builds the box —
 * pi-tui's Box has no setter for it, so it is ignored on the reuse path.
 * Callers must keep it constant per slot.
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
