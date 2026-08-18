import { homedir } from "node:os";
import { relative } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
  getCapabilities,
  hyperlink,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  emptyGitInfoState,
  emptyModelInfoState,
  GIT_INFO_CHANNEL,
  MODEL_INFO_CHANNEL,
  REFRESH_CHANNEL,
  isGitInfoState,
  isModelInfoState,
} from "../shared/dashboard-state.ts";
import { composeStatusBar } from "../shared/status-bar.ts";

type Rgb = [number, number, number];
interface RenderableNode {
  children?: RenderableNode[];
  invalidate(): void;
  render(width: number): string[];
}

interface DashboardTui extends RenderableNode {
  requestRender(force?: boolean): void;
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
// Footer furniture: group separators, a branch mark, and the headroom gauge.
const SEPARATOR = " ◆ ";
const BRANCH = "⎇";
// ± is the conventional "working tree differs" mark; it reads as changes in
// both directions rather than additions.
const DIRTY = "±";
const GAUGE_WIDTH = 10;
const STATUS_WIDGET_KEY = "shared-status-bar";
const GAUGE_FULL = "▰";
const GAUGE_EMPTY = "▱";

// Catppuccin Mocha. The header art is drawn from this palette only, so it
// stays in step with themes/catppuccin-mocha.json.
const MOCHA = {
  rosewater: [245, 224, 220],
  pink: [245, 194, 231],
  mauve: [203, 166, 247],
  red: [243, 139, 168],
  maroon: [235, 160, 172],
  peach: [250, 179, 135],
  yellow: [249, 226, 175],
  lavender: [180, 190, 254],
  subtext0: [166, 173, 200],
  overlay1: [127, 132, 156],
  surface2: [88, 91, 112],
} satisfies Record<string, Rgb>;

// An apple pie, flat and wide the way a pie actually sits: steam, a sugared
// dome, a woven lattice over the filling, a fluted crust edge, and the tin.
// Every row is exactly PIE_WIDTH cells so the block centers as one shape.
const PIE_WIDTH = 23;
const PIE_LINES = [
  "        ‧  ‧  ‧        ",
  "     ▁▁▁▁▁▁▁▁▁▁▁▁▁     ",
  "   ╱▚▞▚▞▚▞▚▞▚▞▚▞▚▞▚╲   ",
  "  ╱▞▚▞▚▞▚▞▚▞▚▞▚▞▚▞▚▞╲  ",
  "▄▟▄▟▄▟▄▟▄▟▄▟▄▟▄▟▄▟▄▟▄▟▄",
  " ╲▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁╱ ",
];
// Left-to-right sweep per row, warm crust on top, cooling into the tin.
const PIE_ROW_COLORS: Array<[Rgb, Rgb]> = [
  [MOCHA.surface2, MOCHA.overlay1],
  [MOCHA.rosewater, MOCHA.yellow],
  [MOCHA.yellow, MOCHA.peach],
  [MOCHA.peach, MOCHA.maroon],
  [MOCHA.yellow, MOCHA.peach],
  [MOCHA.surface2, MOCHA.overlay1],
];
// Lattice gaps show the apple filling, not the crust.
const FILLING_CHARS = new Set(["▚", "▞"]);
const FILLING_COLORS: [Rgb, Rgb] = [MOCHA.red, MOCHA.maroon];
const ANSI_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
// eslint-disable-next-line no-control-regex
const OSC_PATTERN =
  /(?:\u001b\]|\u009d)(?:[^\u0007\u001b\u009c]|\u001b(?!\\))*(?:\u0007|\u001b\\|\u009c)/g;
// eslint-disable-next-line no-control-regex
const CSI_PATTERN = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const ESCAPE_PATTERN = /\u001b(?:[()][0-2A-Z]|[ -/]*[@-~])/g;

function sanitizeTerminalLabel(text: string) {
  return text
    .replace(OSC_PATTERN, "")
    .replace(CSI_PATTERN, "")
    .replace(ESCAPE_PATTERN, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

function mix(a: number, b: number, amount: number) {
  return Math.round(a + (b - a) * amount);
}

function blend([r1, g1, b1]: Rgb, [r2, g2, b2]: Rgb, amount: number) {
  return [
    mix(r1, r2, amount),
    mix(g1, g2, amount),
    mix(b1, b2, amount),
  ] satisfies Rgb;
}

function foreground([red, green, blue]: Rgb, text: string) {
  return `\x1b[38;2;${red};${green};${blue}m${text}${RESET}`;
}

function sweep(text: string, [from, to]: [Rgb, Rgb], override?: [Rgb, Rgb]) {
  const characters = [...text];
  const span = Math.max(characters.length - 1, 1);

  return characters
    .map((character, index) => {
      if (character === " ") return character;
      const amount = index / span;
      const stops =
        override && FILLING_CHARS.has(character) ? override : [from, to];
      return foreground(blend(stops[0]!, stops[1]!, amount), character);
    })
    .join("");
}

function pieArt() {
  return PIE_LINES.map((line, row) => {
    const padded = line.padEnd(PIE_WIDTH, " ");
    return sweep(padded, PIE_ROW_COLORS[row]!, FILLING_COLORS);
  });
}

function hasChildren(
  component: RenderableNode,
): component is RenderableNode & { children: RenderableNode[] } {
  return Array.isArray(component.children);
}

function renderedText(component: RenderableNode) {
  try {
    return component.render(200).join("\n").replace(ANSI_PATTERN, "");
  } catch {
    return "";
  }
}

function hideThemesSection(component: RenderableNode) {
  if (!hasChildren(component)) return false;

  for (let index = 0; index < component.children.length; index += 1) {
    const child = component.children[index]!;
    const firstLine = renderedText(child)
      .split("\n")
      .find((line) => line.trim())
      ?.trim();

    if (firstLine === "[Themes]") {
      const removeCount =
        component.children[index + 1] &&
        renderedText(component.children[index + 1]!).trim() === ""
          ? 2
          : 1;
      component.children.splice(index, removeCount);
      component.invalidate();
      return true;
    }

    if (hideThemesSection(child)) return true;
  }

  return false;
}

// Effort reads at a glance: the same color the editor border already uses for
// that thinking level.
function effortColor(level: string): ThemeColor {
  switch (level) {
    case "minimal":
      return "thinkingMinimal";
    case "low":
      return "thinkingLow";
    case "medium":
      return "thinkingMedium";
    case "high":
      return "thinkingHigh";
    case "xhigh":
      return "thinkingXhigh";
    case "max":
      return "thinkingMax";
    default:
      return "thinkingOff";
  }
}

// Context headroom, not context spent: the number you act on.
function headroomColor(percentLeft: number): ThemeColor {
  if (percentLeft <= 10) return "error";
  if (percentLeft <= 25) return "warning";
  return "success";
}

function formatDirectory(cwd: string) {
  const home = homedir();
  if (cwd === home) return "~";
  const display = cwd.startsWith(`${home}/`) ? `~/${relative(home, cwd)}` : cwd;
  return sanitizeTerminalLabel(display);
}

// The directory you are in matters more than the path that leads to it, so the
// last segment gets its own shade.
function splitDirectory(cwd: string) {
  const display = formatDirectory(cwd);
  const cut = display.lastIndexOf("/");
  if (cut < 0) return { lead: "", root: display };
  return { lead: display.slice(0, cut + 1), root: display.slice(cut + 1) };
}

function center(text: string, width: number) {
  const padding = Math.max(0, Math.floor((width - visibleWidth(text)) / 2));
  return truncateToWidth(`${" ".repeat(padding)}${text}`, width);
}

function columns(left: string, right: string, width: number) {
  if (!right) return truncateToWidth(left, width);

  const naturalGap = width - visibleWidth(left) - visibleWidth(right);
  if (naturalGap >= 1) return `${left}${" ".repeat(naturalGap)}${right}`;

  const leftWidth = Math.max(1, Math.floor(width * 0.45));
  const rightWidth = Math.max(1, width - leftWidth - 1);
  const fittedLeft = truncateToWidth(left, leftWidth);
  const fittedRight = truncateToWidth(right, rightWidth);
  const gap = Math.max(
    1,
    width - visibleWidth(fittedLeft) - visibleWidth(fittedRight),
  );
  return truncateToWidth(
    `${fittedLeft}${" ".repeat(gap)}${fittedRight}`,
    width,
  );
}

export default function uiCustomization(pi: ExtensionAPI) {
  let title = "pi";
  let modelInfo = emptyModelInfoState();
  let gitInfo = emptyGitInfoState();
  let requestRender: (() => void) | undefined;
  let activeTui: DashboardTui | undefined;
  let themeRemovalTimers: Array<ReturnType<typeof setTimeout>> = [];
  let footerData: ReadonlyFooterDataProvider | undefined;
  let statusContext: ExtensionContext | undefined;

  const stopModelListener = pi.events.on(MODEL_INFO_CHANNEL, (value) => {
    if (!isModelInfoState(value)) return;
    modelInfo = value;
    requestRender?.();
    refreshStatusBar();
  });

  const stopGitListener = pi.events.on(GIT_INFO_CHANNEL, (value) => {
    if (!isGitInfoState(value)) return;
    gitInfo = value;
    requestRender?.();
    refreshStatusBar();
  });

  function scheduleThemeRemoval(tui: DashboardTui) {
    for (const timer of themeRemovalTimers) clearTimeout(timer);
    themeRemovalTimers = [];

    for (const delay of [0, 50, 250, 1_000]) {
      themeRemovalTimers.push(
        setTimeout(() => {
          if (hideThemesSection(tui)) tui.requestRender(true);
        }, delay),
      );
    }
  }

  /** One shared line above the editor. Cleared entirely when nothing is
   * active, so the row does not sit there empty. */
  function refreshStatusBar() {
    const ctx = statusContext;
    if (!ctx || ctx.mode !== "tui" || !footerData) return;
    const statuses = footerData.getExtensionStatuses();
    if (statuses.size === 0) {
      ctx.ui.setWidget(STATUS_WIDGET_KEY, undefined);
      return;
    }
    ctx.ui.setWidget(STATUS_WIDGET_KEY, (_tui, theme) => ({
      render(width: number) {
        const line = composeStatusBar(statuses, width, theme);
        return line ? [line] : [];
      },
      invalidate() {},
    }));
  }

  function install(ctx: ExtensionContext) {
    statusContext = ctx;
    if (ctx.mode !== "tui") return;

    ctx.ui.setHeader((tui) => {
      activeTui = tui;
      requestRender = () => tui.requestRender();
      scheduleThemeRemoval(tui);

      return {
        render(width: number) {
          const art = pieArt().map((line) => center(line, width));
          const wordmark = `${BOLD}${foreground(MOCHA.mauve, "pi")}${RESET}${foreground(MOCHA.overlay1, " · ")}${foreground(MOCHA.lavender, title)}`;
          return ["", ...art, center(wordmark, width), ""];
        },
        invalidate() {},
      };
    });

    ctx.ui.setFooter((tui, theme, footer: ReadonlyFooterDataProvider) => {
      requestRender = () => tui.requestRender();
      footerData = footer;

      return {
        invalidate() {},
        render(width: number) {
          const diamond = theme.fg("dim", SEPARATOR);

          const { lead, root } = splitDirectory(ctx.cwd);
          const directory = `${theme.fg("dim", lead)}${theme.bold(theme.fg("accent", root))}`;

          const groups = [directory];

          if (gitInfo.branch) {
            let git = theme.fg(
              "mdListBullet",
              `${BRANCH} ${gitInfo.branch}`,
            );
            if (gitInfo.changedFiles > 0) {
              git += theme.fg(
                "warning",
                ` ${DIRTY}${gitInfo.changedFiles}`,
              );
            }
            if (gitInfo.pullRequest) {
              const prLabel = `PR #${gitInfo.pullRequest.number}`;
              const linkedPr = getCapabilities().hyperlinks
                ? hyperlink(prLabel, gitInfo.pullRequest.url)
                : prLabel;
              git += ` ${theme.fg("mdLink", linkedPr)}`;
            }
            groups.push(git);
          }

          const model = modelInfo.provider
            ? `${theme.fg("muted", modelInfo.provider)}${theme.fg("dim", "/")}${theme.fg("toolTitle", modelInfo.modelId)}`
            : theme.fg("toolTitle", modelInfo.modelId);
          groups.push(
            `${model} ${theme.fg(effortColor(modelInfo.thinking), `(${modelInfo.thinking})`)}`,
          );

          // Context headroom drains left to right, so a shrinking bar and a
          // shrinking number say the same thing.
          const percentLeft =
            modelInfo.contextPercent === null
              ? null
              : Math.max(0, 100 - Math.round(modelInfo.contextPercent));
          const gaugeColor =
            percentLeft === null ? "dim" : headroomColor(percentLeft);
          const filled =
            percentLeft === null
              ? 0
              : Math.round((percentLeft / 100) * GAUGE_WIDTH);
          const gauge = [
            theme.fg("dim", "["),
            theme.fg(gaugeColor, GAUGE_FULL.repeat(filled)),
            theme.fg("dim", GAUGE_EMPTY.repeat(GAUGE_WIDTH - filled)),
            theme.fg("dim", "]"),
          ].join("");
          const percentLabel = theme.fg(
            gaugeColor,
            percentLeft === null ? "—%" : `${percentLeft}%`,
          );
          const cost = theme.fg("muted", `$${modelInfo.cost.toFixed(2)}`);

          const lines = [
            columns(
              groups.join(diamond),
              `${gauge} ${percentLabel} ${cost}`,
              width,
            ),
          ];

          return lines;
        },
      };
    });

    ctx.ui.setTitle(`pi · ${title}`);
    pi.events.emit(REFRESH_CHANNEL, undefined);
    refreshStatusBar();
  }

  pi.on("session_start", (_event, ctx) => {
    title = formatDirectory(ctx.cwd);
    modelInfo = emptyModelInfoState();
    gitInfo = emptyGitInfoState();
    install(ctx);
  });

  pi.on("resources_discover", () => {
    if (activeTui) scheduleThemeRemoval(activeTui);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    stopModelListener();
    stopGitListener();
    for (const timer of themeRemovalTimers) clearTimeout(timer);
    themeRemovalTimers = [];
    activeTui = undefined;
    requestRender = undefined;
    if (ctx.mode === "tui") {
      ctx.ui.setHeader(undefined);
      ctx.ui.setFooter(undefined);
      ctx.ui.setWidget(STATUS_WIDGET_KEY, undefined);
    }
    footerData = undefined;
    statusContext = undefined;
  });
}
