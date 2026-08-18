/**
 * Nerd-font file-type glyphs in Catppuccin Mocha.
 *
 * These are literal RGB rather than ThemeColor because ThemeColor is a fixed
 * 43-name union with no per-language entries. Every value below is a Mocha
 * accent taken from themes/catppuccin-mocha.json, so the icons cannot drift
 * from the rest of the TUI.
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

const FALLBACK = glyph(0xf016, SUBTEXT);

/** Exact filenames take precedence over extensions. */
const BY_NAME: Record<string, FileIcon> = {
  dockerfile: glyph(0xe7b0, BLUE),
  makefile: glyph(0xe673, PEACH),
  ".gitignore": glyph(0xe702, PEACH),
};

const BY_EXTENSION: Record<string, FileIcon> = {
  ts: glyph(0xe628, BLUE),
  tsx: glyph(0xe628, BLUE),
  js: glyph(0xe781, YELLOW),
  jsx: glyph(0xe781, YELLOW),
  json: glyph(0xe60b, YELLOW),
  py: glyph(0xe73c, YELLOW),
  rs: glyph(0xe7a8, PEACH),
  go: glyph(0xe627, SKY),
  sh: glyph(0xe795, GREEN),
  bash: glyph(0xe795, GREEN),
  zsh: glyph(0xe795, GREEN),
  nu: glyph(0xe795, GREEN),
  md: glyph(0xe73e, SUBTEXT),
  toml: glyph(0xe615, PEACH),
  yaml: glyph(0xe615, PEACH),
  yml: glyph(0xe615, PEACH),
  css: glyph(0xe749, MAUVE),
  html: glyph(0xe736, RED),
  lock: glyph(0xf023, SUBTEXT),
};

export function iconFor(path: string): FileIcon {
  const name = (path.split("/").pop() ?? path).toLowerCase();
  const byName = BY_NAME[name];
  if (byName) return byName;

  const dot = name.lastIndexOf(".");
  if (dot <= 0) return FALLBACK;
  return BY_EXTENSION[name.slice(dot + 1)] ?? FALLBACK;
}

export function paintIcon({ glyph, rgb: [r, g, b] }: FileIcon): string {
  return `\x1b[38;2;${r};${g};${b}m${glyph}\x1b[0m`;
}
