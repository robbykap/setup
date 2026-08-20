/**
 * The editor config and the command line it builds. Nothing here launches
 * anything: the fake io records what it was asked to run, which is the part
 * worth asserting.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  availableEditors,
  buildLaunch,
  editorConfigPath,
  parseEditorCommand,
  parseEditorConfig,
  readEditorConfig,
  writeEditorConfig,
  type EditorIo,
} from "./ide.ts";

function fakeIo(options: { files?: Record<string, string>; path?: string[] } = {}) {
  const files: Record<string, string> = { ...options.files };
  const onPath = new Set(options.path ?? []);
  const launched: Array<{ command: string; args: ReadonlyArray<string> }> = [];
  const io: EditorIo = {
    readFile: (file) => files[file] ?? null,
    writeFile: (file, content) => {
      files[file] = content;
      return true;
    },
    onPath: (command) => onPath.has(command),
    launch: (command, args) => {
      launched.push({ command, args });
      return null;
    },
  };
  return { io, files, launched };
}

test("a stored config round-trips", () => {
  const { io, files } = fakeIo();
  const file = "/agent/editor.json";

  assert.equal(writeEditorConfig(io, file, { command: "zed", args: ["{path}"] }), true);
  assert.deepEqual(readEditorConfig(io, file), { command: "zed", args: ["{path}"] });
  assert.match(files[file]!, /\n$/);
});

test("nothing configured reads as nothing, not as a crash", () => {
  const { io } = fakeIo();
  assert.equal(readEditorConfig(io, "/agent/editor.json"), null);
});

test("a malformed config reads as absent", () => {
  // Half-parsed is not something to launch; the chooser is one keypress away.
  assert.equal(parseEditorConfig("{ not json"), null);
  assert.equal(parseEditorConfig("[]"), null);
  assert.equal(parseEditorConfig('{"args":["{path}"]}'), null);
  assert.equal(parseEditorConfig('{"command":"  "}'), null);
  assert.equal(parseEditorConfig('{"command":"zed","args":"{path}"}'), null);
  assert.equal(parseEditorConfig('{"command":"zed","args":[1]}'), null);
});

test("a config with no args is valid", () => {
  assert.deepEqual(parseEditorConfig('{"command":"zed"}'), {
    command: "zed",
    args: [],
  });
});

test("only the editors on this machine are offered", () => {
  const { io } = fakeIo({ path: ["code", "zed"] });
  assert.deepEqual(
    availableEditors(io).map((editor) => editor.label),
    ["VS Code", "Zed"],
  );
});

test("placeholders are substituted", () => {
  const launch = buildLaunch(
    { command: "cursor", args: ["--goto", "{path}:{line}"] },
    "/repo/src/a.ts",
    42,
  );
  assert.deepEqual(launch, {
    command: "cursor",
    args: ["--goto", "/repo/src/a.ts:42"],
  });
});

test("a command naming no path still gets one", () => {
  const launch = buildLaunch(
    { command: "open", args: ["-a", "Xcode"] },
    "/repo/src/a.ts",
    1,
  );
  assert.deepEqual(launch.args, ["-a", "Xcode", "/repo/src/a.ts"]);
});

test("a line-only command is left to place the path itself", () => {
  const launch = buildLaunch(
    { command: "idea", args: ["--line", "{line}", "{path}"] },
    "/repo/a.ts",
    9,
  );
  assert.deepEqual(launch.args, ["--line", "9", "/repo/a.ts"]);
});

test("a typed command becomes a config", () => {
  assert.deepEqual(parseEditorCommand("  code --goto {path}:{line} "), {
    command: "code",
    args: ["--goto", "{path}:{line}"],
  });
  assert.deepEqual(parseEditorCommand("zed"), { command: "zed", args: [] });
  assert.equal(parseEditorCommand("   "), null);
});

test("the config sits in the agent directory", () => {
  assert.equal(editorConfigPath("/agent"), "/agent/editor.json");
});
