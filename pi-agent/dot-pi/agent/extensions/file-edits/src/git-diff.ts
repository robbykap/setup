/**
 * The fallback diff for changes we hold no baseline for.
 *
 * Child sessions report which file they touched, and not every one of them
 * carries a patch, so the viewer asks git. The baseline is a ref rather than
 * whatever HEAD happens to be now: a commit made mid-session moves HEAD past
 * the very work the user wants to look at, and `git diff HEAD` then reports
 * nothing at all. index.ts pins the session's starting commit once and passes
 * it here.
 */

import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { parseUnifiedPatch, type ParsedPatch } from "./diff.ts";

function run(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 8 * 1024 * 1024,
  });
}

/**
 * The commit the session started on, resolved once and pinned. Null when
 * there is nothing to pin: not a repository, or a repository with no commits
 * yet, where every tracked path is "new" anyway.
 */
export function resolveHeadSha(cwd: string): string | null {
  try {
    const sha = run(cwd, ["rev-parse", "HEAD"]).trim();
    return sha || null;
  } catch {
    return null;
  }
}

/**
 * A file's contents at a commit, or null when it did not exist there — which
 * is also the answer for a file created this session, and the reason the
 * caller can treat null as "the baseline is empty".
 */
export function blobAtRef(
  cwd: string,
  ref: string,
  relativePath: string,
): string | null {
  // `git show ref:path` addresses the repository, not the filesystem: an
  // absolute path is not something it can name.
  if (path.isAbsolute(relativePath)) return null;
  try {
    return run(cwd, ["show", `${ref}:${relativePath}`]);
  } catch {
    return null;
  }
}

export function diffAgainstRef(
  cwd: string,
  ref: string,
  relativePath: string,
): ParsedPatch | null {
  try {
    // --no-index against /dev/null covers untracked files, which plain
    // `git diff <ref> --` reports as nothing at all.
    const tracked = run(cwd, ["diff", ref, "--unified=3", "--", relativePath]);
    if (tracked.trim()) return parseUnifiedPatch(tracked);

    const untracked = run(cwd, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      relativePath,
    ]);
    if (!untracked.trim()) return null;

    try {
      run(cwd, ["diff", "--no-index", "--unified=3", "/dev/null", relativePath]);
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

/** Against the working tree's current HEAD. Kept for callers that have no
 * session baseline to pin against. */
export function diffAgainstHead(
  cwd: string,
  relativePath: string,
): ParsedPatch | null {
  return diffAgainstRef(cwd, "HEAD", relativePath);
}
