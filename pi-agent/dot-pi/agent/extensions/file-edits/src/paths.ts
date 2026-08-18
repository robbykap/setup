/**
 * The one place that turns a filesystem path into a store key. Kept apart
 * from store.ts (which only knows about FileChange shapes, not node:path)
 * and out of record.ts/observe.ts, which used to each define their own
 * near-identical version of this.
 */

import * as path from "node:path";

/** Store keys are cwd-relative: that is what the user reads and types. A
 * path outside the cwd stays absolute. `rel === ".."` alone is not enough —
 * a file literally named `..config.ts` inside the cwd relativizes to that
 * exact string and must not be mistaken for "outside the cwd". */
export function storeKeyFor(cwd: string, target: string): string {
  const absolute = path.isAbsolute(target) ? target : path.join(cwd, target);
  const relative = path.relative(cwd, absolute);
  return relative === ".." || relative.startsWith("../") ? absolute : relative;
}
