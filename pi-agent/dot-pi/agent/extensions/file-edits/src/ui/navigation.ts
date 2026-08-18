/**
 * Sibling navigation for the diff viewer, kept apart from viewer.ts (whose
 * class uses TS parameter properties, which node's strip-only mode can't
 * load directly) so it is importable by a plain test.
 */

/** The next/previous path in `paths`, wrapping around. `undefined` when
 * `current` is not in `paths` (it was filtered out or dropped from the
 * store) or `paths` is empty. */
export function siblingPath(
  paths: ReadonlyArray<string>,
  current: string,
  step: number,
): string | undefined {
  const index = paths.indexOf(current);
  if (index === -1 || paths.length === 0) return undefined;
  return paths[(index + step + paths.length) % paths.length];
}
