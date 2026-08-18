"""Sidebar renderer: draws a frame, waits to be poked, draws again. Never reads the keyboard."""

import argparse
import os
import select
import sys

from . import render, state, tabs, tmuxio, tree

POKE_TIMEOUT = 2.0
CLEAR = "\x1b[H\x1b[2J"
HIDE_CURSOR = "\x1b[?25l"
HEADER_ROWS = 2


def _list_windows() -> str:
    result = tmuxio.run("list-windows", "-F", tabs.FORMAT)
    return result.stdout or ""


def compose(session: str, root: str, width: int, height: int, list_windows=_list_windows) -> str:
    """Build one full frame as a single string. Any failure renders as a visible error line."""
    try:
        data = state.load(session, root)
        if data["view"] == "tabs":
            lines = render.frame(
                "tabs", height, tabs=tabs.parse(list_windows()), width=width
            )
        else:
            settings = data["tree"]
            expanded = set(settings["expanded"])
            nodes = tree.flatten(settings["root"], expanded, settings["show_hidden"])
            scroll = tree.clamp_scroll(
                settings["cursor"], settings["scroll"], max(0, height - HEADER_ROWS), len(nodes)
            )
            lines = render.frame(
                "files",
                height,
                nodes=nodes,
                cursor=settings["cursor"],
                scroll=scroll,
                expanded=expanded,
                width=width,
            )
    except Exception as error:  # noqa: BLE001 - a dead sidebar is worse than a visible error
        lines = ["sidebar error:", str(error)]
    return CLEAR + HIDE_CURSOR + "\r\n".join(lines)


def _open_fifo(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        os.mkfifo(path, 0o600)
    reader = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    # Hold a writer open too, otherwise select() spins on EOF once a poker disconnects.
    writer = os.open(path, os.O_WRONLY | os.O_NONBLOCK)
    return reader, writer


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Render the tmux sidebar.")
    parser.add_argument("--session", default=None)
    args = parser.parse_args(argv)
    session = args.session or tmuxio.session_name()
    reader, _writer = _open_fifo(state.fifo_path(session))
    while True:
        size = os.get_terminal_size(sys.stdout.fileno())
        sys.stdout.write(compose(session, os.getcwd(), size.columns, size.lines))
        sys.stdout.flush()
        readable, _, _ = select.select([reader], [], [], POKE_TIMEOUT)
        if readable:
            try:
                os.read(reader, 4096)
            except OSError:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
