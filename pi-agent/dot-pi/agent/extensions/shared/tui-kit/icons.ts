/**
 * Nerd-font glyphs in Catppuccin Mocha: file-type icons keyed by name and
 * extension, plus the shared UI glyphs (status, actors, time) in UI_ICONS.
 *
 * These are literal RGB rather than ThemeColor because ThemeColor is a fixed
 * union of role names with no per-language entries. Every value below is a
 * Mocha accent taken from themes/catppuccin-mocha.json, so the icons cannot
 * drift from the rest of the TUI.
 *
 * Lifted out of file-edits so every extension paints the same icon for the
 * same file. Extensions reach in by relative path.
 */

export type Rgb = [number, number, number];

export interface FileIcon {
  readonly glyph: string;
  readonly rgb: Rgb;
}

const BLUE: Rgb = [137, 180, 250];
const YELLOW: Rgb = [249, 226, 175];
const GREEN: Rgb = [166, 227, 161];
const PEACH: Rgb = [250, 179, 135];
const MAUVE: Rgb = [203, 166, 247];
const RED: Rgb = [243, 139, 168];
const SKY: Rgb = [137, 220, 235];
const SUBTEXT: Rgb = [166, 173, 200];

/** Glyphs are declared as numeric codepoints, not literal characters.
 * Nerd-font glyphs live in the Unicode private use area; pasted literally they
 * are invisible in most editors and are silently dropped by some tools, which
 * would leave the UI with blank icons and tests that assert blankness. A number
 * cannot be corrupted that way. */
function glyph(codePoint: number, rgb: Rgb): FileIcon {
  return { glyph: String.fromCodePoint(codePoint), rgb };
}

/** The generic-document icon: what an unmatched path gets, and what a segment
 * about files in general (rather than one file) should paint. */
export const FALLBACK_FILE_ICON = glyph(0xf016, SUBTEXT);

/** Exact filenames take precedence over extensions. */
const BY_NAME: Record<string, FileIcon> = {
  dockerfile: glyph(0xe7b0, BLUE),
  makefile: glyph(0xe673, PEACH),
  justfile: glyph(0xe673, PEACH),
  ".gitignore": glyph(0xe702, PEACH),
  ".gitattributes": glyph(0xe702, PEACH),
  ".env": glyph(0xe615, YELLOW),
};

const BY_EXTENSION: Record<string, FileIcon> = {
  ts: glyph(0xe628, BLUE),
  tsx: glyph(0xe628, BLUE),
  js: glyph(0xe781, YELLOW),
  jsx: glyph(0xe781, YELLOW),
  mjs: glyph(0xe781, YELLOW),
  cjs: glyph(0xe781, YELLOW),
  json: glyph(0xe60b, YELLOW),
  jsonc: glyph(0xe60b, YELLOW),
  py: glyph(0xe73c, YELLOW),
  rs: glyph(0xe7a8, PEACH),
  go: glyph(0xe627, SKY),
  c: glyph(0xe61e, BLUE),
  h: glyph(0xe61e, BLUE),
  cpp: glyph(0xe61d, BLUE),
  hpp: glyph(0xe61d, BLUE),
  java: glyph(0xe738, PEACH),
  kt: glyph(0xe634, MAUVE),
  swift: glyph(0xe755, PEACH),
  rb: glyph(0xe739, RED),
  php: glyph(0xe73d, MAUVE),
  lua: glyph(0xe620, BLUE),
  scala: glyph(0xe737, RED),
  sql: glyph(0xe706, SKY),
  sh: glyph(0xe795, GREEN),
  bash: glyph(0xe795, GREEN),
  zsh: glyph(0xe795, GREEN),
  nu: glyph(0xe795, GREEN),
  fish: glyph(0xe795, GREEN),
  md: glyph(0xe73e, SUBTEXT),
  mdx: glyph(0xe73e, SUBTEXT),
  txt: glyph(0xf016, SUBTEXT), // same as FALLBACK_FILE_ICON; explicit so .txt stays stable if the fallback changes
  toml: glyph(0xe615, PEACH),
  yaml: glyph(0xe615, PEACH),
  yml: glyph(0xe615, PEACH),
  ini: glyph(0xe615, SUBTEXT),
  css: glyph(0xe749, MAUVE),
  scss: glyph(0xe749, MAUVE),
  html: glyph(0xe736, RED),
  vue: glyph(0xe6a0, GREEN),
  svelte: glyph(0xe697, PEACH),
  graphql: glyph(0xe662, MAUVE),
  proto: glyph(0xe60b, SUBTEXT),
  tf: glyph(0xe69a, MAUVE),
  lock: glyph(0xf023, SUBTEXT),
  png: glyph(0xf1c5, MAUVE),
  jpg: glyph(0xf1c5, MAUVE),
  jpeg: glyph(0xf1c5, MAUVE),
  gif: glyph(0xf1c5, MAUVE),
  webp: glyph(0xf1c5, MAUVE),
  svg: glyph(0xf1c5, PEACH),
  pdf: glyph(0xf1c1, RED),
  zip: glyph(0xf1c6, SUBTEXT),
  csv: glyph(0xf1c3, GREEN),
};

/** Non-file glyphs the dashboards share: status, actors, time. */
export const UI_ICONS = {
  terminal: glyph(0xe795, GREEN),
  agent: glyph(0xeb99, MAUVE), // nf-cod-hubot
  clock: glyph(0xf017, SUBTEXT),
  check: glyph(0xf00c, GREEN),
  cross: glyph(0xf00d, RED),
} as const;

/** Every icon in the module, for the width invariant test. */
export const ALL_ICONS: readonly FileIcon[] = [
  FALLBACK_FILE_ICON,
  ...Object.values(BY_NAME),
  ...Object.values(BY_EXTENSION),
  ...Object.values(UI_ICONS),
];

export function iconFor(path: string): FileIcon {
  const name = (path.split("/").pop() ?? path).toLowerCase();
  const byName = BY_NAME[name];
  if (byName) return byName;

  const dot = name.lastIndexOf(".");
  if (dot <= 0) return FALLBACK_FILE_ICON;
  return BY_EXTENSION[name.slice(dot + 1)] ?? FALLBACK_FILE_ICON;
}

export function paintIcon({ glyph, rgb: [r, g, b] }: FileIcon): string {
  return `\x1b[38;2;${r};${g};${b}m${glyph}\x1b[0m`;
}
