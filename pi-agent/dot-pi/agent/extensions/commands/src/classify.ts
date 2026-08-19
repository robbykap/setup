/**
 * What a command *does*, in one word — the label the picker groups by.
 *
 * Deliberately shallow: this reads the first real executable on the line and
 * a verb or two after it. A shell line can be arbitrarily complex, and a
 * parser that tried to be right about all of them would be both wrong and
 * unreadable; a heading that is right about `git`, `rg` and `npm test` is
 * worth far more than one that is subtle about pipelines.
 */

export type CommandCategory =
  | "git"
  | "search"
  | "test"
  | "build"
  | "network"
  | "files"
  | "packages"
  | "run"
  | "other";

const SEARCH = new Set(["rg", "grep", "egrep", "fd", "find", "ag"]);
const TEST_RUNNERS = new Set(["vitest", "jest", "pytest"]);
const NETWORK = new Set([
  "curl", "wget", "http", "ping", "ssh", "scp", "dig", "nc",
]);
const FILES = new Set([
  "ls", "cat", "head", "tail", "cp", "mv", "rm", "mkdir", "touch",
  "sed", "awk", "wc", "diff",
]);
const INSTALLERS = new Set(["brew", "pip", "pip3", "pipx"]);
const RUNTIMES = new Set(["node", "python", "python3", "bun", "deno", "npx"]);

/** npm, and the three tools that copy its verbs. */
const NODE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const PACKAGE_VERBS = new Set([
  "install", "add", "remove", "i", "ci", "update", "uninstall",
]);

/** `test` as a word, so `--test` and `x.test.ts` count but `latest` does not. */
const TEST_WORD = /\btest\b/;
/** A runner named outright, for the lines that never say `test`: `-m pytest`. */
const TEST_RUNNER_ARG = /\b(pytest|vitest|jest)\b/;

/**
 * A leading `cd <path> &&`: the interesting command is the one after it, and
 * a picker full of `cd` headings would say nothing. The path may be quoted.
 */
const CD_PREFIX = /^cd\s+(?:"[^"]*"|'[^']*'|[^\s&;|]+)\s*&&\s*/;
/** `FOO=bar` in front of the command, one at a time. */
const ENV_PREFIX = /^\w+=\S*(\s+|$)/;
const SUDO_PREFIX = /^sudo\s+/;

/** The first command of a `a && b`, `a; b` or `a | b` line. */
function firstCommand(line: string): string {
  return (line.split(/&&|\|\||[;|]/)[0] ?? "").trim();
}

function basename(token: string): string {
  return token.slice(token.lastIndexOf("/") + 1);
}

export function classify(command: string): CommandCategory {
  // Env assignments, sudo and `cd …&&` can interleave (`cd x && sudo FOO=1 rm …`),
  // so peel until what is left starts with something that runs. `cd` is peeled
  // before the line is cut at its first `&&`, because it lives in front of one.
  let rest = (command.split("\n")[0] ?? "").trim();
  for (;;) {
    const peeled = rest
      .replace(ENV_PREFIX, "")
      .replace(SUDO_PREFIX, "")
      .replace(CD_PREFIX, "");
    if (peeled === rest) break;
    rest = peeled;
  }

  const tokens = firstCommand(rest).split(/\s+/).filter((token) => token.length > 0);
  const name = basename(tokens[0] ?? "");
  const args = tokens.slice(1);
  if (!name) return "other";

  if (name === "git") return "git";
  if (SEARCH.has(name)) return "search";
  if (TEST_RUNNERS.has(name)) return "test";
  if (name === "tsc" || name === "make") return "build";
  if (NETWORK.has(name)) return "network";
  if (FILES.has(name)) return "files";
  if (INSTALLERS.has(name)) return "packages";
  if (name === "vite") return args[0] === "build" ? "build" : "run";
  if (name === "docker") return args[0] === "build" ? "build" : "other";

  // The multi-purpose tools, resolved by their verb. One order throughout:
  // test beats build beats packages beats run — `npm run test:build` is a
  // test run, and an install that also builds is still an install.
  const isManager = NODE_MANAGERS.has(name);
  // `npm run build` and `yarn build` are the same intent.
  const verb = isManager ? (args[0] === "run" ? args[1] : args[0]) : undefined;
  const installing = verb !== undefined && PACKAGE_VERBS.has(verb);
  if (isManager || RUNTIMES.has(name) || name === "cargo" || name === "go") {
    // …but `bun add vitest` installs a runner rather than running one.
    if (!installing && args.some((arg) => TEST_WORD.test(arg) || TEST_RUNNER_ARG.test(arg))) {
      return "test";
    }
  }
  if (isManager) {
    if (verb === "build") return "build";
    if (installing) return "packages";
    if (verb === "start" || verb === "dev" || args[0] === "run" || args[0] === "exec") {
      return "run";
    }
  }
  if (name === "cargo" || name === "go") {
    if (args[0] === "build") return "build";
    if (args[0] === "run") return "run";
    if (name === "cargo" && args[0] === "add") return "packages";
  }

  if (RUNTIMES.has(name)) return "run";
  return "other";
}
