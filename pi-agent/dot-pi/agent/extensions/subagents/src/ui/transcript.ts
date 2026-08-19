/**
 * Transcript rendering for the takeover view: turns a SubagentSnapshot's
 * normalized transcript + live state into plain wrapped lines. Ported from
 * v1, with the session-poking replaced by snapshot reads.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { sectionRule } from "../../../shared/tui-kit/frame.ts";
import type {
  SubagentSnapshot,
  TranscriptItem,
  TranscriptPart,
} from "../domain.ts";

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

/**
 * Strip raw ANSI codes, expand tabs, and drop control chars. Terminal-expanded
 * tabs (and stray escapes) make lines wider than the width we declare to the
 * TUI, which desyncs the renderer and smears the overlay.
 */
export function sanitizeText(text: string): string {
  return text
    .replace(ANSI_PATTERN, "")
    .replaceAll("\t", "  ")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

function renderUserText(
  theme: Theme,
  text: string,
  width: number,
  out: string[],
) {
  const clean = sanitizeText(text).trim();
  if (!clean) return;
  const wrapped = wrapTextWithAnsi(clean, Math.max(10, width - 2));
  for (let i = 0; i < wrapped.length; i++) {
    const prefix = i === 0 ? theme.fg("accent", "> ") : "  ";
    out.push(
      truncateToWidth(prefix + theme.fg("userMessageText", wrapped[i]), width),
    );
  }
}

function renderThinking(
  theme: Theme,
  text: string,
  width: number,
  out: string[],
) {
  const reasoning = sanitizeText(text).trim();
  if (!reasoning) return;
  const prefix = theme.fg("dim", "~ ");
  const wrapped = wrapTextWithAnsi(reasoning, Math.max(10, width - 2));
  for (let i = 0; i < wrapped.length; i++) {
    out.push(
      truncateToWidth(
        (i === 0 ? prefix : "  ") + theme.fg("muted", theme.italic(wrapped[i])),
        width,
      ),
    );
  }
}

function renderAssistantItem(
  theme: Theme,
  item: Extract<TranscriptItem, { kind: "assistant" }>,
  width: number,
  out: string[],
) {
  for (const part of item.parts) {
    if (part.type === "text") {
      const text = sanitizeText(part.text).trim();
      if (!text) continue;
      out.push(...wrapTextWithAnsi(text, width));
    } else if (part.type === "thinking") {
      renderThinking(
        theme,
        part.redacted ? "[redacted reasoning]" : part.text,
        width,
        out,
      );
    } else if (part.type === "toolCall") {
      renderToolCall(theme, part, width, out);
    }
  }
}

/**
 * Tool names that mean "run a shell line". The pi backend forwards whatever
 * the child registered, and bridges rename the same tool, so match on a small
 * set of known spellings rather than on one id.
 */
const SHELL_TOOLS: ReadonlySet<string> = new Set([
  "bash",
  "sh",
  "shell",
  "run_command",
  "execute_command",
  "terminal",
]);

/**
 * The shell line a tool call carries, if it is a shell call at all.
 * `argsPreview` is the JSON the backend flattened out of the tool arguments
 * (see backends/pi.ts safeJson), so the command sits under a named field;
 * when the JSON is unparseable or truncated we fall back to the raw preview
 * rather than dropping the block's identity.
 */
function shellCommandOf(name: string, argsPreview: string): string | undefined {
  if (!SHELL_TOOLS.has(name.toLowerCase())) return undefined;
  let command = argsPreview;
  try {
    const args: unknown = JSON.parse(argsPreview);
    if (args && typeof args === "object") {
      const record = args as Record<string, unknown>;
      for (const key of ["command", "cmd", "script"]) {
        if (typeof record[key] === "string") {
          command = record[key];
          break;
        }
      }
    }
  } catch {
    // Keep the raw preview: a partial line still names the block.
  }
  const firstLine = command.split("\n").find((line) => line.trim()) ?? "";
  return firstLine.trim();
}

/**
 * A tool call opens a framed block: a dashed rule labelled with the shell line
 * for shell tools (accent, because that is the thing worth reading) or with
 * the tool name for everything else (muted), and the arguments underneath.
 * The rule's own label truncation keeps it at exactly `width` cells.
 */
function renderToolCall(
  theme: Theme,
  part: Extract<TranscriptPart, { type: "toolCall" }>,
  width: number,
  out: string[],
) {
  const preview = part.argsPreview ? sanitizeText(part.argsPreview) : "";
  const command = shellCommandOf(part.name, preview);

  if (command) {
    // The command IS the block's content; repeating the raw JSON below it
    // would only push the transcript around.
    out.push(truncateToWidth(sectionRule(theme, width, `$ ${command}`), width));
    return;
  }

  out.push(
    truncateToWidth(sectionRule(theme, width, part.name, "muted"), width),
  );
  if (preview && preview !== "{}") {
    out.push(truncateToWidth(theme.fg("dim", `  ${preview}`), width));
  }
}

function renderToolResultItem(
  theme: Theme,
  item: Extract<TranscriptItem, { kind: "toolResult" }>,
  width: number,
  out: string[],
) {
  const firstLine =
    sanitizeText(item.outputPreview ?? "")
      .split("\n")
      .find((line) => line.trim()) ?? "";
  const label = item.isError
    ? theme.fg("error", "  error: ")
    : theme.fg("dim", "  output: ");
  out.push(
    truncateToWidth(label + theme.fg("dim", firstLine || "(no output)"), width),
  );
}

/** Render a subagent's conversation as plain lines, wrapped to `width`. */
export function buildTranscriptLines(
  snap: SubagentSnapshot,
  width: number,
  theme: Theme,
): string[] {
  const out: string[] = [];

  for (const item of snap.transcript) {
    const before = out.length;
    if (item.kind === "user") {
      renderUserText(theme, item.text, width, out);
    } else if (item.kind === "assistant") {
      renderAssistantItem(theme, item, width, out);
    } else {
      renderToolResultItem(theme, item, width, out);
    }
    if (out.length > before) out.push("");
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();

  // Live streaming assistant buffers (cleared when the finalized message lands).
  if (snap.liveAssistant) {
    const { thinking, text } = snap.liveAssistant;
    const before = out.length;
    if (out.length > 0) out.push("");
    if (thinking.trim()) renderThinking(theme, thinking, width, out);
    if (text.trim())
      out.push(...wrapTextWithAnsi(sanitizeText(text).trim(), width));
    if (out.length === before + 1) out.pop();
  }

  // Live tool executions (present until the ToolEnd lands in the transcript).
  for (const tool of snap.liveTools) {
    if (out.length > 0) out.push("");
    const marker = tool.done
      ? tool.isError
        ? theme.fg("error", "error")
        : theme.fg("success", "done")
      : theme.fg("warning", "running");
    let line = `${theme.fg("toolTitle", tool.name)} · ${marker}`;
    const preview = tool.outputPreview && sanitizeText(tool.outputPreview);
    if (preview) line += theme.fg("dim", ` · ${preview}`);
    out.push(truncateToWidth(line, width));
  }

  // Queued steering/follow-up messages: show them immediately so Enter
  // visibly acknowledges the user's input instead of appearing to do nothing.
  for (const message of snap.queued) {
    if (out.length > 0) out.push("");
    const prefix = theme.fg("warning", `> [queued ${message.kind}] `);
    const wrapped = wrapTextWithAnsi(
      sanitizeText(message.text),
      Math.max(10, width - visibleWidth(prefix)),
    );
    for (let i = 0; i < wrapped.length; i++) {
      out.push(
        truncateToWidth(
          (i === 0 ? prefix : " ".repeat(visibleWidth(prefix))) +
            theme.fg("muted", wrapped[i]),
          width,
        ),
      );
    }
  }

  return out;
}
