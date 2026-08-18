"""Every keybinding lands here. Mutates state, then pokes the renderer."""

import argparse
import os
import shlex
from pathlib import Path

from . import state, tabs, tmuxio, tree

MOVES = {"up": -1, "down": 1}
HEADER_ROWS = 2
# An empty tmuxio.query() result means tmux was unreachable, not that the pane
# is legitimately running nothing — it MUST fail closed, the same as any other
# non-shell value.
SHELLS = {"sh", "bash", "zsh", "fish", "nu"}


def send_to_shell(command: str) -> bool:
    """Type `command` into the active pane, but only if a shell is what is running there."""
    running = tmuxio.query("#{pane_current_command}")
    if not running:
        tmuxio.run("display-message", "sidebar: tmux unreachable — not sending")
        return False
    if running not in SHELLS:
        tmuxio.run("display-message", f"sidebar: {running} is running — not sending")
        return False
    pane = tmuxio.query("#{pane_id}")
    if not pane:
        return False
    tmuxio.run("send-keys", "-t", pane, command, "Enter")
    return True


def poke(session: str) -> None:
    path = state.fifo_path(session)
    if not path.exists():
        return
    try:
        handle = os.open(path, os.O_WRONLY | os.O_NONBLOCK)
    except OSError:
        return  # no renderer listening; nothing to wake
    try:
        os.write(handle, b"x")
    except OSError:
        pass
    finally:
        os.close(handle)


def nodes_for(data: dict) -> list:
    settings = data["tree"]
    return tree.flatten(settings["root"], set(settings["expanded"]), settings["show_hidden"])


def selected(data: dict):
    nodes = nodes_for(data)
    if not nodes:
        return None, nodes
    cursor = max(0, min(data["tree"]["cursor"], len(nodes) - 1))
    return nodes[cursor], nodes


def apply_verb(data: dict, verb: str, argument) -> int:
    settings = data["tree"]

    if verb == "poke":
        # Mutates nothing; main() pokes the FIFO whenever a verb returns 0,
        # so this exists purely to wake the renderer out-of-band (e.g. from
        # a tmux hook on window change) without touching any state.
        return 0

    if verb == "view":
        if argument == "toggle":
            data["view"] = "files" if data["view"] == "tabs" else "tabs"
        elif argument in state.VIEWS:
            data["view"] = argument
        else:
            return 2
        return 0

    if verb in MOVES:
        settings["cursor"] = tree.move_cursor(settings["cursor"], MOVES[verb], len(nodes_for(data)))
        return 0

    if verb == "toggle-hidden":
        settings["show_hidden"] = not settings["show_hidden"]
        settings["cursor"] = 0
        settings["scroll"] = 0
        return 0

    if verb == "root":
        settings["root"] = argument or tmuxio.query("#{pane_current_path}") or settings["root"]
        settings["expanded"] = []
        settings["cursor"] = 0
        settings["scroll"] = 0
        return 0

    if verb in ("expand", "collapse"):
        node, nodes = selected(data)
        if node is None:
            return 0
        expanded = set(settings["expanded"])
        if verb == "expand":
            if node.is_dir:
                expanded.add(node.path)
        elif node.is_dir and node.path in expanded:
            expanded.discard(node.path)
        else:
            parent = tree.parent_index(nodes, settings["cursor"])
            settings["cursor"] = parent
            expanded.discard(nodes[parent].path)
        settings["expanded"] = sorted(expanded)
        return 0

    if verb == "activate":
        node, _ = selected(data)
        if node is None:
            return 0
        if node.is_dir:
            settings["expanded"] = sorted(tree.toggle(set(settings["expanded"]), node.path))
            return 0
        editor = os.environ.get("VISUAL") or os.environ.get("EDITOR") or "vi"
        send_to_shell(f"{editor} {shlex.quote(node.path)}")
        return 0

    if verb == "cd":
        node, _ = selected(data)
        if node is None:
            return 0
        target = node.path if node.is_dir else str(Path(node.path).parent)
        send_to_shell(f"cd {shlex.quote(target)}")
        return 0

    if verb == "click":
        try:
            row = int(argument)
        except (TypeError, ValueError):
            return 2
        if row == 0:
            data["view"] = "files" if data["view"] == "tabs" else "tabs"
            return 0
        body = row - HEADER_ROWS
        if body < 0:
            return 0
        if data["view"] == "tabs":
            listing = tmuxio.run("list-windows", "-F", tabs.FORMAT).stdout or ""
            index = tabs.index_for_row(tabs.parse(listing), body)
            if index is not None:
                tmuxio.run("select-window", "-t", str(index))
            return 0
        total = len(nodes_for(data))
        if total:
            settings["cursor"] = min(settings["scroll"] + body, total - 1)
        return 0

    return 2


def _run(argv) -> int:
    parser = argparse.ArgumentParser(description="Mutate sidebar state.")
    parser.add_argument("--session", default=None)
    parser.add_argument("verb")
    parser.add_argument("argument", nargs="?")
    args = parser.parse_args(argv)

    session = args.session or tmuxio.session_name()
    data = state.load(session, os.getcwd())
    code = apply_verb(data, args.verb, args.argument)
    if code == 0:
        state.save(session, data)
        poke(session)
    return code


def main(argv=None) -> int:
    """Through run-shell -b a crash is otherwise invisible: no pane output,
    no tmux message, the sidebar just stops responding to keys. Surface it."""
    try:
        return _run(argv)
    except SystemExit:
        raise  # argparse usage errors (e.g. missing verb); leave as-is
    except Exception as error:  # noqa: BLE001 - last-resort diagnostic path
        tmuxio.run("display-message", f"sidebar: sb-cmd crashed — {type(error).__name__}: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
