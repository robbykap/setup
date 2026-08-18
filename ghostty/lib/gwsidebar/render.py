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
