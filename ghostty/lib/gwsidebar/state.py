"""Persisted sidebar state. Corrupt or missing state degrades to defaults, never crashes."""

import json
import os
import re
import tempfile
from pathlib import Path

VIEWS = ("tabs", "files")

_SAFE_CHARS = re.compile(r"[^A-Za-z0-9_-]")


def _sanitize_session(session: str) -> str:
    cleaned = _SAFE_CHARS.sub("_", session)
    return cleaned or "gw"


def state_dir() -> Path:
    base = os.environ.get("XDG_STATE_HOME") or str(Path.home() / ".local" / "state")
    return Path(base) / "gw"


def state_path(session: str) -> Path:
    return state_dir() / f"{_sanitize_session(session)}.json"


def fifo_path(session: str) -> Path:
    return state_dir() / f"{_sanitize_session(session)}.fifo"


def default_state(root: str) -> dict:
    return {
        "view": "tabs",
        "tree": {
            "root": str(root),
            "expanded": [],
            "cursor": 0,
            "scroll": 0,
            "show_hidden": False,
        },
    }


def load(session: str, root: str) -> dict:
    merged = default_state(root)
    try:
        data = json.loads(state_path(session).read_text())
    except (OSError, ValueError):
        return merged
    if not isinstance(data, dict):
        return merged
    if data.get("view") in VIEWS:
        merged["view"] = data["view"]
    stored = data.get("tree")
    if isinstance(stored, dict):
        for key, default in merged["tree"].items():
            value = stored.get(key)
            if type(value) is type(default):
                merged["tree"][key] = value
        merged["tree"]["expanded"] = [
            entry for entry in merged["tree"]["expanded"] if isinstance(entry, str)
        ]
        for key in ("cursor", "scroll"):
            merged["tree"][key] = max(0, merged["tree"][key])
    return merged


def save(session: str, data: dict) -> None:
    directory = state_dir()
    directory.mkdir(parents=True, exist_ok=True)
    handle, tmp = tempfile.mkstemp(dir=str(directory), suffix=".tmp")
    try:
        with os.fdopen(handle, "w") as stream:
            json.dump(data, stream)
        os.replace(tmp, state_path(session))
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
