/**
 * Syntax highlighting for the kit, guaranteed line-preserving.
 *
 * pi's highlightCode uses the active theme singleton, so the token colours
 * always match the running TUI without any mapping here. What it does not
 * guarantee is shape: callers zip highlighted lines back onto diff hunks, so
 * a mismatched line count would smear code across the wrong rows. With no
 * language the caller gets plain lines back from the early return, and a
 * throw or a count mismatch degrades to plain lines too. An unknown language
 * under a live theme comes back as pi's own code-block-tinted lines rather
 * than plain ones — fine, because the preserved line count is the contract
 * callers actually rely on. The count guard is defensive: no current SDK path
 * trips it.
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
