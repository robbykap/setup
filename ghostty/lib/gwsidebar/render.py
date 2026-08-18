"""Pure rendering. Model in, list of lines out. The only module that emits ANSI."""

WIDTH = 24
REVERSE = "\x1b[7m"
RESET = "\x1b[0m"


def fit(left: str, right: str, width: int) -> str:
    """Left text padded to `width`, with `right` flush to the right edge. Truncates left as needed."""
    space = width - len(right) - 1
    if space < 1:
        return right[:width]
    if len(left) > space:
        left = left[: max(0, space - 1)] + "…"
    return left.ljust(space) + " " + right


def header(view: str, width: int = WIDTH, color: bool = True) -> list:
    tabs_label = " TABS "
    files_label = " FILES "
    if color:
        if view == "tabs":
            tabs_label = REVERSE + tabs_label + RESET
        else:
            files_label = REVERSE + files_label + RESET
    return [tabs_label + "│" + files_label, "─" * width]


def tab_line(tab, width: int = WIDTH, color: bool = True) -> str:
    marker = "●" if tab.active else " "
    right = ""
    if tab.zoomed:
        right += "Z"
    if tab.bell:
        right += "!"
    if tab.panes > 1:
        right += f"{tab.panes}p"
    line = fit(f"{tab.index:>2} {marker} {tab.name}", right, width)
    if color and tab.active:
        return REVERSE + line + RESET
    return line


def tree_line(node, selected: bool, expanded: set, width: int = WIDTH, color: bool = True) -> str:
    if node.is_dir:
        glyph = "▾" if node.path in expanded else "▸"
    else:
        glyph = " "
    line = fit("  " * node.depth + f"{glyph} {node.name}", "", width)
    if color and selected:
        return REVERSE + line + RESET
    return line


def frame(
    view: str,
    height: int,
    *,
    tabs=None,
    nodes=None,
    cursor: int = 0,
    scroll: int = 0,
    expanded=(),
    width: int = WIDTH,
    color: bool = True,
) -> list:
    lines = header(view, width, color)
    body_height = max(0, height - len(lines))
    if view == "tabs":
        for tab in (tabs or [])[:body_height]:
            lines.append(tab_line(tab, width, color))
    else:
        nodes = nodes or []
        expanded = set(expanded)
        if not nodes:
            lines.append(fit("  (empty)", "", width))
        for offset, node in enumerate(nodes[scroll : scroll + body_height]):
            lines.append(tree_line(node, scroll + offset == cursor, expanded, width, color))
    return lines
