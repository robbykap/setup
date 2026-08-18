/**
 * Fixed-size tail of a byte stream.
 *
 * Bytes, not characters: process output arrives as Buffers that can split a
 * multi-byte character across chunks, so decoding happens once over the whole
 * retained tail rather than per chunk. Decoding is cached because the UI reads
 * `text` on every repaint.
 */

import type { OutputView } from "./domain.ts";

export const DEFAULT_LIMIT_BYTES = 256 * 1024;

export interface RingBuffer {
  /** Stable view object; fields update in place as the buffer mutates. */
  readonly view: OutputView;
  /** Append raw stream bytes. */
  append(chunk: Buffer | string): void;
  /** Replace the whole contents (Pi's tool updates are cumulative snapshots). */
  replace(text: string): void;
}

export function createRingBuffer(
  limitBytes: number = DEFAULT_LIMIT_BYTES,
): RingBuffer {
  let bytes = Buffer.alloc(0);
  let totalBytes = 0;
  let droppedBytes = 0;
  let decoded: string | undefined;

  const view: OutputView = {
    get text() {
      return (decoded ??= bytes.toString("utf8"));
    },
    get totalBytes() {
      return totalBytes;
    },
    get droppedBytes() {
      return droppedBytes;
    },
  };

  /** Trim from the front, then skip forward past any UTF-8 continuation bytes
   * so the retained tail always starts on a character boundary. */
  const trim = () => {
    if (bytes.length <= limitBytes) return;
    let start = bytes.length - limitBytes;
    while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
    droppedBytes += start;
    bytes = bytes.subarray(start);
  };

  return {
    view,
    append(chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
      if (buf.length === 0) return;
      totalBytes += buf.length;
      bytes = Buffer.concat([bytes, buf]);
      trim();
      decoded = undefined;
    },
    replace(text) {
      bytes = Buffer.from(text, "utf8");
      totalBytes = bytes.length;
      droppedBytes = 0;
      trim();
      decoded = undefined;
    },
  };
}
