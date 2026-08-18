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
