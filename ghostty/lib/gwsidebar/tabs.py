"""Parse `tmux list-windows` output into tab rows. Malformed lines are skipped, never fatal."""

from dataclasses import dataclass

FIELDS = (
    "#{window_index}",
    "#{window_active}",
    "#{window_panes}",
    "#{window_zoomed_flag}",
    "#{window_bell_flag}",
    "#{window_name}",
)
SEP = "|"
FORMAT = SEP.join(FIELDS)


@dataclass(frozen=True)
class Tab:
    index: int
    name: str
    active: bool
    panes: int
    zoomed: bool
    bell: bool


def parse(output: str) -> list:
    result = []
    for line in output.splitlines():
        fields = line.split(SEP, len(FIELDS) - 1)
        if len(fields) != len(FIELDS):
            continue
        try:
            index = int(fields[0])
            panes = int(fields[2])
        except ValueError:
            continue
        result.append(
            Tab(
                index=index,
                name=fields[5],
                active=fields[1] == "1",
                panes=panes,
                zoomed=fields[3] == "1",
                bell=fields[4] == "1",
            )
        )
    return result


def index_for_row(parsed: list, row: int):
    """Map a 0-based row below the header to a window index, or None if off the list."""
    if 0 <= row < len(parsed):
        return parsed[row].index
    return None
