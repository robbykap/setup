/**
 * The untruncated output, read back from the temp file bash spilled it to.
 *
 * This is the one thing /cmds can show that the transcript never could: the
 * model only ever saw the last 2000 lines, but the whole run is still on disk
 * until the OS cleans it up. Reading is lazy (on viewer open, not on capture),
 * capped, and always falls back to the stored text — the file belongs to a
 * process that may be long gone.
 */

import * as fs from "node:fs";

/** Reading a 4 GB build log into a TUI helps nobody. */
export const FULL_OUTPUT_CAP_BYTES = 2 * 1024 * 1024;

export type FullOutput =
  | { readonly kind: "loaded"; readonly text: string; readonly capped: boolean }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly message: string };

export interface FullOutputReader {
  statSync: (path: string) => { size: number };
  openSync: (path: string, flags: string) => number;
  readSync: (
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ) => number;
  closeSync: (fd: number) => void;
}

const nodeReader: FullOutputReader = {
  statSync: (path) => fs.statSync(path),
  openSync: (path, flags) => fs.openSync(path, flags),
  readSync: (fd, buffer, offset, length, position) =>
    fs.readSync(fd, buffer, offset, length, position),
  closeSync: (fd) => fs.closeSync(fd),
};

/**
 * Read at most the last FULL_OUTPUT_CAP_BYTES of the spill file. The tail is
 * the useful end — it is what the truncated view was already showing more of —
 * and reading from the end keeps a huge file from becoming a huge string.
 */
export function readFullOutput(
  path: string,
  reader: FullOutputReader = nodeReader,
): FullOutput {
  let fd: number | undefined;
  try {
    const { size } = reader.statSync(path);
    const length = Math.min(size, FULL_OUTPUT_CAP_BYTES);
    if (length === 0) return { kind: "loaded", text: "", capped: false };

    fd = reader.openSync(path, "r");
    const buffer = Buffer.alloc(length);
    const read = reader.readSync(fd, buffer, 0, length, size - length);
    return {
      kind: "loaded",
      text: buffer.subarray(0, read).toString("utf8"),
      capped: size > length,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") return { kind: "missing" };
    return {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (fd !== undefined) {
      try {
        reader.closeSync(fd);
      } catch {
        // A descriptor we cannot close is not worth failing a render over.
      }
    }
  }
}
