/**
 * The fallback diff for changes we did not make ourselves.
 *
 * Child sessions report which file they touched but not how, so the viewer
 * asks git. The baseline is HEAD rather than the pre-edit buffer, which is
 * the honest thing to show for work done elsewhere.
 */

import { execFileSync } from "node:child_process";
import { parseUnifiedPatch, type ParsedPatch } from "./diff.ts";

export function diffAgainstHead(
  cwd: string,
  relativePath: string,
): ParsedPatch | null {
  const run = (args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 8 * 1024 * 1024,
    });

  try {
    // --no-index against /dev/null covers untracked files, which plain
    // `git diff HEAD --` reports as nothing at all.
    const tracked = run([
      "diff",
      "HEAD",
      "--unified=3",
      "--",
      relativePath,
    ]);
    if (tracked.trim()) return parseUnifiedPatch(tracked);

    const untracked = run([
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      relativePath,
    ]);
    if (!untracked.trim()) return null;

    try {
      run(["diff", "--no-index", "--unified=3", "/dev/null", relativePath]);
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
