/**
 * Copy with a one-line receipt. Viewers show the returned note in their
 * footer; there is no other error UI, so this never throws.
 */

import { copyToClipboard } from "@earendil-works/pi-coding-agent";

export async function copyText(
  text: string,
  label: string,
  copier: (text: string) => Promise<void> = copyToClipboard,
): Promise<string> {
  try {
    await copier(text);
    return `copied ${label}`;
  } catch {
    return "copy failed";
  }
}
