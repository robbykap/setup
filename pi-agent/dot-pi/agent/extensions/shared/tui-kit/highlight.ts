/**
 * Syntax highlighting for the kit, guaranteed line-preserving.
 *
 * pi's highlightCode uses the active theme singleton, so the token colours
 * always match the running TUI without any mapping here. What it does not
 * guarantee is shape: callers zip highlighted lines back onto diff hunks, so
 * a mismatched line count would smear code across the wrong rows. On any
 * doubt — no language, unknown language, count mismatch, a throw — the
 * caller gets the plain lines back and the view degrades to what it renders
 * today.
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
