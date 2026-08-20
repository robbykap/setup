/**
 * The one tool-row look every transcript surface shares: a colored icon, a
 * pre-painted title, a right-aligned outcome, and dim `│` peek lines.
 * Lifted out of file-edits and commands so a bash row, an edit row and an
 * ask_user row cannot drift apart. Callers paint their own title (bold
 * command, dim-directory/bold-basename path) before handing it in.
 */

import { keyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { paintIcon, type FileIcon } from "./icons.ts";

export interface ToolRowParts {
  readonly icon: FileIcon;
  /** Already painted by the caller. */
  readonly title: string;
  /** Right-aligned outcome, already painted. */
  readonly right?: string;
  /**
   * Dim peek lines under the header; blank entries are dropped.
   * Plain text only — the kit paints it dim; embedded escapes will break
   * the dim run. Entries must be single-line: a `\n` inside one entry
   * renders as extra terminal rows.
   */
  readonly peek?: readonly string[];
}

export function renderToolRow(
  parts: ToolRowParts,
  width: number,
  theme: Theme,
): string[] {
  const right = parts.right ?? "";
  const ellipsis = theme.fg("dim", "…");
  const left = truncateToWidth(
    `${paintIcon(parts.icon)} ${parts.title}`,
    right ? Math.max(0, width - visibleWidth(right) - 1) : width,
    ellipsis,
  );
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  const header = truncateToWidth(
    right ? `${left}${" ".repeat(gap)}${right}` : left,
    width,
    ellipsis,
  );
  const peek = (parts.peek ?? []).filter((line) => line.trim().length > 0);
  return [header, ...peek.map((line) => peekLine(line, width, theme))];
}

/**
 * A dim `   │ text` line under a row header.
 * Plain text only — the kit paints it dim; embedded escapes will break the
 * dim run.
 */
export function peekLine(text: string, width: number, theme: Theme): string {
  return truncateToWidth(
    `   ${theme.fg("dim", "│")} ${theme.fg("dim", text)}`,
    width,
    theme.fg("dim", "…"),
  );
}

/**
 * A one-line call header for tools without richer rows: icon, bold tool
 * name, and a muted detail (a title, an id list, a pattern). The return
 * value already includes the painted icon, so it must NOT be passed as
 * `ToolRowParts.title` (that would paint two icons); it is also
 * width-unaware — hand it to a pi-tui `Text` component as a standalone
 * call header, not to `renderToolRow`.
 */
export function toolCallTitle(
  icon: FileIcon,
  name: string,
  detail: string | undefined,
  theme: Theme,
): string {
  let text = `${paintIcon(icon)} ${theme.bold(theme.fg("text", name))}`;
  if (detail) text += ` ${theme.fg("muted", detail)}`;
  return text;
}

// Minimal ANSI/control stripper. pi's own sanitizers (stripAnsi,
// sanitizeBinaryOutput) live in core/tools/render-utils and utils/shell,
// neither of which the package exports, so this covers the same ground:
// CSI sequences, OSC strings (window titles, hyperlinks), and stray C0
// control bytes that would otherwise desync the terminal renderer.
// eslint-disable-next-line no-control-regex
const OSC_PATTERN = /\x1b\].*?(?:\x07|\x1b\\)/g;
// eslint-disable-next-line no-control-regex
const CSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

function sanitizeResultText(text: string): string {
  const stripped = text.replace(OSC_PATTERN, "").replace(CSI_PATTERN, "");
  // eslint-disable-next-line no-control-regex
  return stripped.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

const COLLAPSED_LINE_CAP = 10;

/** The plain result body for tools with nothing richer to show: sanitized
 * text, capped when collapsed, red with a ✗ when the call failed. What pi's
 * default fallback did before renderShell: "self" — minus the box, plus the
 * error marker the box's red background used to carry. */
export function plainResultText(
  result: {
    readonly content: ReadonlyArray<{
      readonly type: string;
      readonly text?: string;
    }>;
  },
  theme: Theme,
  context: { readonly isError: boolean },
  options: { readonly expanded: boolean },
): string {
  const joined = sanitizeResultText(
    result.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n"),
  );
  if (!joined) return "";

  const allLines = joined.split("\n");
  const lines = options.expanded
    ? allLines
    : allLines.slice(0, COLLAPSED_LINE_CAP);
  const hidden = allLines.length - lines.length;

  const color = context.isError ? "error" : "toolOutput";
  const painted = lines.map((line, i) =>
    theme.fg(color, context.isError && i === 0 ? `✗ ${line}` : line),
  );
  if (hidden > 0) {
    painted.push(
      theme.fg(
        "dim",
        `… (${hidden} more lines, `,
      ) + keyHint("app.tools.expand", "to expand)"),
    );
  }
  return painted.join("\n");
}
