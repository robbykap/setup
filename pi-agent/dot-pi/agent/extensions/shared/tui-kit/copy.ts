/**
 * Copy with a one-line receipt. Viewers show the returned note in their
 * footer; there is no other error UI, so this never throws. The note is
 * deliberately terse — it has one footer line to live in.
 *
 * `copyText` settles only when the copier does. Callers chaining
 * `.then(render)` should `.catch()` if their render can throw: the no-throw
 * guarantee ends at this function's boundary.
 */

import { copyToClipboard } from "@earendil-works/pi-coding-agent";

export async function copyText(
  text: string,
  label: string,
  copier: (text: string) => Promise<void> | void = copyToClipboard,
): Promise<string> {
  try {
    await copier(text);
    return `copied ${label}`;
  } catch {
    // the footer note is the whole error UI; detail has nowhere to go
    return `failed to copy ${label}`;
  }
}
