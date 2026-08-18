/**
 * Shell commands announced to the session-wide log.
 *
 * bash is recorded by the `commands` extension itself, which owns that tool's
 * registration. Everything else — fd and rg in file-search, and any shell tool
 * a subagent or workflow child runs — arrives here instead, so no extension
 * has to know who is listening. Same shape and same discipline as
 * CHILD_FILE_CHANNEL: a plain event plus a type guard, validated before use,
 * because an emitter may be a version behind.
 */

export const COMMAND_CHANNEL = "dashboard:command";

export type CommandTool = "bash" | "fd" | "rg";

export type CommandStatus = "ok" | "failed" | "aborted" | "timeout";

export type CommandOrigin =
  | { readonly kind: "session" }
  | { readonly kind: "subagent"; readonly id: string; readonly name: string }
  | { readonly kind: "workflow"; readonly label: string };

export interface CommandLogEvent {
  readonly tool: CommandTool;
  /** The command as run: a shell line for bash, argv for fd and rg. */
  readonly command: string;
  readonly cwd: string;
  readonly origin: CommandOrigin;
  readonly status: CommandStatus;
  /** Wall time in ms. Omitted when the emitter cannot measure it. */
  readonly durationMs?: number;
  readonly exitCode?: number;
  /** What the tool returned. Already capped by whoever ran the command. */
  readonly output: string;
  /** Where the untruncated output was spilled, when it was. */
  readonly fullOutputPath?: string;
}

const TOOLS: ReadonlySet<string> = new Set(["bash", "fd", "rg"]);
const STATUSES: ReadonlySet<string> = new Set([
  "ok",
  "failed",
  "aborted",
  "timeout",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isCommandOrigin(value: unknown): value is CommandOrigin {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "session":
      return true;
    case "subagent":
      return typeof value.id === "string" && typeof value.name === "string";
    case "workflow":
      return typeof value.label === "string";
    default:
      return false;
  }
}

export function isCommandLogEvent(value: unknown): value is CommandLogEvent {
  if (!isRecord(value)) return false;
  return (
    typeof value.tool === "string" &&
    TOOLS.has(value.tool) &&
    typeof value.command === "string" &&
    typeof value.cwd === "string" &&
    isCommandOrigin(value.origin) &&
    typeof value.status === "string" &&
    STATUSES.has(value.status) &&
    typeof value.output === "string" &&
    (value.durationMs === undefined || typeof value.durationMs === "number") &&
    (value.exitCode === undefined || typeof value.exitCode === "number") &&
    (value.fullOutputPath === undefined ||
      typeof value.fullOutputPath === "string")
  );
}

/** The tools worth logging, for producers filtering a child's tool events. */
export function isCommandTool(name: string): name is CommandTool {
  return TOOLS.has(name);
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * A readable command line from a tool call's arguments. A child session
 * reports tool names and arguments, not argv, so fd and rg are described
 * rather than reconstructed — enough to recognize the call in a list.
 */
export function describeToolCommand(tool: CommandTool, args: unknown): string {
  if (!isRecord(args)) return tool;
  if (tool === "bash") return text(args.command) ?? "bash";
  const parts = [tool, text(args.pattern) ?? "(all)"];
  const path = text(args.path);
  if (path) parts.push(`in ${path}`);
  return parts.join(" ");
}

/** The text of a tool result, however the caller happens to hold it. */
export function toolResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!isRecord(result) || !Array.isArray(result.content)) return "";
  return result.content
    .filter(
      (part): part is { type: string; text: string } =>
        isRecord(part) && part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}
