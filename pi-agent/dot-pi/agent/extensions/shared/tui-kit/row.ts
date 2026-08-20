/**
 * The one tool-row look every transcript surface shares: a colored icon, a
 * pre-painted title, a right-aligned outcome, and dim `│` peek lines.
 * Lifted out of file-edits and commands so a bash row, an edit row and an
 * ask_user row cannot drift apart. Callers paint their own title (bold
 * command, dim-directory/bold-basename path) before handing it in.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { paintIcon, type FileIcon } from "./icons.ts";

export interface ToolRowParts {
  readonly icon: FileIcon;
  /** Already painted by the caller. */
  readonly title: string;
  /** Right-aligned outcome, already painted. */
  readonly right?: string;
  /** Dim peek lines under the header; blank entries are dropped. */
  readonly peek?: readonly string[];
}

export function renderToolRow(
  parts: ToolRowParts,
  width: number,
  theme: Theme,
): string[] {
  const left = `${paintIcon(parts.icon)} ${parts.title}`;
  const right = parts.right ?? "";
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  const header = truncateToWidth(
    right ? `${left}${" ".repeat(gap)}${right}` : left,
    width,
    theme.fg("dim", "…"),
  );
  const peek = (parts.peek ?? []).filter((line) => line.trim().length > 0);
  return [header, ...peek.map((line) => peekLine(line, width, theme))];
}

/** A dim `   │ text` line under a row header. */
export function peekLine(text: string, width: number, theme: Theme): string {
  return truncateToWidth(
    `   ${theme.fg("dim", "│")} ${theme.fg("dim", text)}`,
    width,
    theme.fg("dim", "…"),
  );
}

/** A one-line call header for tools without richer rows: icon, bold tool
 * name, and a muted detail (a title, an id list, a pattern). */
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
