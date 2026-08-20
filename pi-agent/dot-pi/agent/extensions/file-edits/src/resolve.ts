/**
 * Turning a record into a diff.
 *
 * A record says a file changed and roughly by how much; it does not say what
 * the file looks like against where the session began. Four sources can
 * answer that, in descending order of how much they know:
 *
 * 1. the baseline — a snapshot taken before we first wrote, or the blob at the
 *    session's starting commit — diffed against the file on disk now. This is
 *    the whole session's story for that file, so hunks and counts agree by
 *    construction;
 * 2. the patches whoever made the change reported, concatenated. Per call
 *    rather than per session, and a file edited twice shows two hunks over the
 *    same lines, but it is exact about what happened;
 * 3. git, against the pinned starting commit — which also covers a file that
 *    was untracked all along, through `--no-index`;
 * 4. nothing, and then the viewer says so rather than drawing an empty panel.
 *
 * The step that matters is the first one. Everything that came before this
 * asked a moving HEAD, and a commit made mid-session moves HEAD past exactly
 * the work someone opened /files to look at.
 */

import * as path from "node:path";
import type { BaselineStore } from "./baseline.ts";
import { diffContents, parseUnifiedPatch, type ParsedPatch } from "./diff.ts";
import type { FileChange, Hunk } from "./domain.ts";

export type ResolutionSource = "baseline" | "patch" | "git";

export type Resolution =
  | {
      readonly kind: "resolved";
      readonly hunks: ReadonlyArray<Hunk>;
      readonly added: number;
      readonly removed: number;
      readonly source: ResolutionSource;
    }
  /** We know what the file looked like, and it looks like that still. */
  | { readonly kind: "unchanged"; readonly source: ResolutionSource }
  /** Nothing could describe it; `reason` is shown to the user verbatim. */
  | { readonly kind: "unavailable"; readonly reason: string };

export interface ResolveDeps {
  readonly cwd: string;
  readonly baselines: BaselineStore;
  /** The commit the session started on; null outside a repository. */
  readonly headSha: string | null;
  /** Null when the file is gone — which is itself a diff worth showing. */
  readFile(absolutePath: string): string | null;
  blobAtRef(cwd: string, ref: string, relativePath: string): string | null;
  diffAgainstRef(
    cwd: string,
    ref: string,
    relativePath: string,
  ): ParsedPatch | null;
}

/** Patches from separate calls, read as one diff. They are not merged — two
 * edits to the same lines stay two hunks — because this is the fallback, and
 * an honest repetition beats a reconciliation nothing can check. */
function fromPatches(patches: ReadonlyArray<string>): ParsedPatch | null {
  const hunks: Hunk[] = [];
  let added = 0;
  let removed = 0;
  for (const patch of patches) {
    const parsed = parseUnifiedPatch(patch);
    if (!parsed) continue;
    hunks.push(...parsed.hunks);
    added += parsed.added;
    removed += parsed.removed;
  }
  return hunks.length === 0 ? null : { hunks, added, removed };
}

/**
 * The baseline for a file, fetching the blob at the pinned commit the first
 * time it is asked for. A file git has never heard of gets no baseline rather
 * than an empty one: "absent at the starting commit" and "untracked all along"
 * are the same answer from git, and only the second one would be a lie.
 */
function baselineFor(change: FileChange, deps: ResolveDeps) {
  const held = deps.baselines.get(change.path);
  if (held) return held;
  if (!deps.headSha) return undefined;
  const blob = deps.blobAtRef(deps.cwd, deps.headSha, change.path);
  if (blob === null) return undefined;
  const baseline = { content: blob, source: "git" as const };
  deps.baselines.adopt(change.path, baseline);
  return baseline;
}

export function resolveChange(
  change: FileChange,
  deps: ResolveDeps,
): Resolution {
  const absolute = path.isAbsolute(change.path)
    ? change.path
    : path.join(deps.cwd, change.path);

  const baseline = baselineFor(change, deps);
  if (baseline) {
    // A file that is gone diffs against the empty string, so a deletion reads
    // as the removal it is instead of vanishing from the panel.
    const current = deps.readFile(absolute) ?? "";
    const parsed = diffContents(change.path, baseline.content ?? "", current);
    const source = baseline.source === "snapshot" ? "baseline" : "git";
    return parsed
      ? { kind: "resolved", ...parsed, source }
      : { kind: "unchanged", source };
  }

  const patched = fromPatches(change.patches);
  if (patched) return { kind: "resolved", ...patched, source: "patch" };

  if (deps.headSha) {
    const parsed = deps.diffAgainstRef(deps.cwd, deps.headSha, change.path);
    if (parsed) return { kind: "resolved", ...parsed, source: "git" };
    return { kind: "unchanged", source: "git" };
  }

  return {
    kind: "unavailable",
    reason: "no diff: nothing was recorded before this file changed, and this is not a git repository",
  };
}

/** What the viewer says when a resolution produced no hunks. */
export function resolutionNote(resolution: Resolution): string | undefined {
  if (resolution.kind === "resolved") return undefined;
  if (resolution.kind === "unavailable") return resolution.reason;
  return resolution.source === "baseline"
    ? "no changes: the file matches what it was when the session started"
    : "no changes against the commit this session started on";
}
