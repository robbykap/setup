"""Every keybinding lands here. Mutates state, then pokes the renderer."""

import argparse
import os
import shlex
from pathlib import Path

from . import state, tmuxio, tree

MOVES = {"up": -1, "down": 1}
SHELLS = {"sh", "bash", "zsh", "fish", "nu"}


def send_to_shell(command: str) -> bool:
    """Type `command` into the active pane, but only if a shell is what is running there."""
    running = tmuxio.query("#{pane_current_command}")
    if running not in SHELLS:
        tmuxio.run("display-message", f"sidebar: {running or 'a program'} is running — not sending")
        return False
    pane = tmuxio.query("#{pane_id}")
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
        editor = os.environ.get("EDITOR", "vi")
        send_to_shell(f"{editor} {shlex.quote(node.path)}")
        return 0

    if verb == "cd":
        node, _ = selected(data)
        if node is None:
            return 0
        target = node.path if node.is_dir else str(Path(node.path).parent)
        send_to_shell(f"cd {shlex.quote(target)}")
        return 0

    return 2


def main(argv=None) -> int:
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


if __name__ == "__main__":
    raise SystemExit(main())
