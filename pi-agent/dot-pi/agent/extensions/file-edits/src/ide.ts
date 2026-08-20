/**
 * The editor `o` hands a file to.
 *
 * Deliberately not $EDITOR: that variable answers a different question — what
 * runs in this terminal — and the terminal is already busy running pi. An
 * unconfigured `o` says so and offers the choice rather than guessing, because
 * a guess here launches a program over the top of the session.
 *
 * The config is this extension's own file rather than a key in pi's
 * settings.json: pi writes that file itself, and a read-modify-write from here
 * would race it.
 *
 * Everything except `nodeEditorIo` is pure — the command line built for a file
 * is worth testing without launching anything.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";

export interface EditorConfig {
  readonly command: string;
  /** `{path}` and `{line}` are substituted per launch. A command naming
   * neither still gets the path, appended. */
  readonly args: ReadonlyArray<string>;
}

/** An editor worth offering, if it turns out to be installed. GUI editors
 * only: a terminal editor launched detached from a TUI has nowhere to draw. */
export interface KnownEditor extends EditorConfig {
  readonly label: string;
}

export const KNOWN_EDITORS: ReadonlyArray<KnownEditor> = [
  { label: "Cursor", command: "cursor", args: ["--goto", "{path}:{line}"] },
  { label: "VS Code", command: "code", args: ["--goto", "{path}:{line}"] },
  {
    label: "VS Code Insiders",
    command: "code-insiders",
    args: ["--goto", "{path}:{line}"],
  },
  { label: "Windsurf", command: "windsurf", args: ["--goto", "{path}:{line}"] },
  { label: "Zed", command: "zed", args: ["{path}:{line}"] },
  { label: "Sublime Text", command: "subl", args: ["{path}:{line}"] },
  { label: "IntelliJ IDEA", command: "idea", args: ["--line", "{line}", "{path}"] },
  { label: "WebStorm", command: "webstorm", args: ["--line", "{line}", "{path}"] },
];

export interface EditorIo {
  readFile(file: string): string | null;
  writeFile(file: string, content: string): boolean;
  /** Whether a bare command name resolves on PATH. */
  onPath(command: string): boolean;
  launch(command: string, args: ReadonlyArray<string>): string | null;
}

export function editorConfigPath(agentDir?: string): string {
  const root = agentDir ?? path.join(os.homedir(), ".pi", "agent");
  return path.join(root, "editor.json");
}

/**
 * The stored config, or null when there is none to speak of. A malformed file
 * reads as absent: the chooser is one keypress away, and refusing to launch
 * something half-parsed is the safer failure.
 */
export function parseEditorConfig(text: string | null): EditorConfig | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { command, args } = parsed as { command?: unknown; args?: unknown };
    if (typeof command !== "string" || command.trim() === "") return null;
    if (args !== undefined && !Array.isArray(args)) return null;
    if (args?.some((arg) => typeof arg !== "string")) return null;
    return { command, args: (args as string[]) ?? [] };
  } catch {
    return null;
  }
}

export function readEditorConfig(io: EditorIo, file: string): EditorConfig | null {
  return parseEditorConfig(io.readFile(file));
}

export function writeEditorConfig(
  io: EditorIo,
  file: string,
  config: EditorConfig,
): boolean {
  return io.writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
}

/** The known editors this machine actually has. */
export function availableEditors(io: EditorIo): ReadonlyArray<KnownEditor> {
  return KNOWN_EDITORS.filter((editor) => io.onPath(editor.command));
}

/**
 * The argv for one file. A config whose args mention neither placeholder gets
 * the path appended, so `{ command: "open", args: ["-a", "Xcode"] }` — a
 * perfectly reasonable thing to type into the prompt — still opens something.
 */
export function buildLaunch(
  config: EditorConfig,
  absolutePath: string,
  line: number,
): { command: string; args: string[] } {
  const substitute = (arg: string) =>
    arg.replaceAll("{path}", absolutePath).replaceAll("{line}", String(line));
  const mentionsPath = config.args.some((arg) => arg.includes("{path}"));
  const args = config.args.map(substitute);
  return {
    command: config.command,
    args: mentionsPath ? args : [...args, absolutePath],
  };
}

/**
 * A command typed by a user, split into a config. Quoting is not honoured:
 * anything needing quotes needs the JSON file, and pretending otherwise would
 * split a path with a space into two arguments that both fail.
 */
export function parseEditorCommand(input: string): EditorConfig | null {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  const [command, ...args] = parts;
  if (!command) return null;
  return { command, args };
}

export function nodeEditorIo(): EditorIo {
  return {
    readFile(file) {
      try {
        return fs.readFileSync(file, "utf8");
      } catch {
        return null;
      }
    },
    writeFile(file, content) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content, "utf8");
        return true;
      } catch {
        return false;
      }
    },
    onPath(command) {
      const dirs = (process.env.PATH ?? "").split(path.delimiter);
      return dirs.some((dir) => {
        if (!dir) return false;
        try {
          fs.accessSync(path.join(dir, command), fs.constants.X_OK);
          return true;
        } catch {
          return false;
        }
      });
    },
    launch(command, args) {
      try {
        // Detached with no stdio: the editor outlives this session and never
        // writes over the TUI. A spawn error arrives asynchronously, hence the
        // handler as well as the try.
        const child = spawn(command, [...args], {
          detached: true,
          stdio: "ignore",
        });
        child.on("error", () => {});
        child.unref();
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  };
}
