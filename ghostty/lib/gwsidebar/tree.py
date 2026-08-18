"""File-tree model. Pure: paths and sets in, node lists and integers out."""

from dataclasses import dataclass
from pathlib import Path

ALWAYS_SKIP = {".git", ".DS_Store"}


@dataclass(frozen=True)
class Node:
    path: str
    name: str
    is_dir: bool
    depth: int


def list_dir(path, show_hidden: bool) -> list:
    try:
        entries = list(Path(path).iterdir())
    except OSError:
        return []
    entries.sort(key=lambda entry: (not entry.is_dir(), entry.name.lower()))
    result = []
    for entry in entries:
        if entry.name in ALWAYS_SKIP:
            continue
        if not show_hidden and entry.name.startswith("."):
            continue
        result.append(entry)
    return result


def flatten(root, expanded: set, show_hidden: bool, depth: int = 0) -> list:
    nodes = []
    for entry in list_dir(root, show_hidden):
        is_dir = entry.is_dir()
        nodes.append(Node(path=str(entry), name=entry.name, is_dir=is_dir, depth=depth))
        if is_dir and str(entry) in expanded:
            nodes.extend(flatten(entry, expanded, show_hidden, depth + 1))
    return nodes


def move_cursor(cursor: int, delta: int, total: int) -> int:
    if total <= 0:
        return 0
    return max(0, min(cursor + delta, total - 1))


def clamp_scroll(cursor: int, scroll: int, height: int, total: int) -> int:
    """Return a scroll offset that keeps `cursor` visible in a window `height` rows tall."""
    if height <= 0:
        return 0
    if cursor < scroll:
        scroll = cursor
    elif cursor >= scroll + height:
        scroll = cursor - height + 1
    return max(0, min(scroll, max(0, total - height)))


def toggle(expanded: set, path: str) -> set:
    updated = set(expanded)
    if path in updated:
        updated.discard(path)
    else:
        updated.add(path)
    return updated


def parent_index(nodes: list, cursor: int) -> int:
    """Row of the directory containing nodes[cursor], or the row itself when at top level."""
    if not nodes:
        return 0
    cursor = max(0, min(cursor, len(nodes) - 1))
    depth = nodes[cursor].depth
    if depth == 0:
        return cursor
    for row in range(cursor - 1, -1, -1):
        if nodes[row].depth == depth - 1:
            return row
    return cursor
