# Ghostty Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 24-column sidebar inside Ghostty that switches between a vertical tab list and a navigable file explorer, built entirely from code in this repo on top of tmux.

**Architecture:** tmux owns all input via key tables and hooks; a single long-lived Python process renders the sidebar and never reads the keyboard. The sidebar is one pane that migrates between windows with `join-pane`, so it keeps its state. All mutations go through one small CLI (`sb-cmd`) that writes a JSON state file and pokes the renderer through a FIFO.

**Tech Stack:** tmux ≥ 3.3, Python ≥ 3.11 (target 3.13, stdlib only), POSIX sh, Ghostty 1.3.1.

**Spec:** `docs/superpowers/specs/2026-08-17-ghostty-tmux-sidebar-design.md`

---

## File Structure

| Path | Responsibility |
|---|---|
| `ghostty/lib/gwsidebar/state.py` | Load/save JSON state; recover from corruption |
| `ghostty/lib/gwsidebar/tmuxio.py` | The only place that shells out to `tmux` |
| `ghostty/lib/gwsidebar/tabs.py` | Parse `list-windows` output; map click row → window |
| `ghostty/lib/gwsidebar/tree.py` | Directory listing, flatten, cursor/scroll/expand math |
| `ghostty/lib/gwsidebar/render.py` | Pure: model in, list of lines out |
| `ghostty/lib/gwsidebar/sidebar_main.py` | Render loop; waits on FIFO |
| `ghostty/lib/gwsidebar/cmd_main.py` | Verb dispatch for every keybinding |
| `ghostty/bin/gw` | Preflight, interpreter resolution, session launch |
| `ghostty/bin/gw-sidebar` | Create the sidebar pane if absent |
| `ghostty/bin/gw-follow` | Migrate the sidebar into the active window |
| `ghostty/bin/sidebar`, `ghostty/bin/sb-cmd` | Two-line sh wrappers pinning the interpreter |
| `ghostty/tmux/tmux.conf` | Layout, hooks, every keybinding |
| `ghostty/config` | Ghostty settings (included by the generated stub) |
| `ghostty/install.sh` | Preflight, generate `~/.config/ghostty/config`, chmod |
| `ghostty/tools/probe.sh` | Capability probe for the tmux assumptions |
| `ghostty/tests/` | Unit tests + integration smoke test |

**Boundaries:** `tmuxio` is the only module that runs subprocesses, so every other module is testable with plain data. `render` is the only module that emits ANSI. `cmd_main` is glue — all logic it needs lives as pure functions in `tree`/`tabs`.

---

## Task 1: Capability probe

The design rests on four tmux behaviours. Verify them before writing code against them.

**Files:**
- Create: `ghostty/tools/probe.sh`

- [ ] **Step 1: Install dependencies**

```bash
brew install tmux python@3.13
tmux -V && /opt/homebrew/bin/python3.13 -V
```

Expected: `tmux 3.7b` or later, `Python 3.13.x`.

- [ ] **Step 2: Write the probe**

```sh
#!/bin/sh
# Verifies the tmux behaviours the sidebar depends on.
# Uses its own server socket and temp files; touches nothing you own.
set -u
SOCK=gwprobe
LOG=$(mktemp)
BIN=$(mktemp -d)
CONF=$(mktemp)

cat > "$BIN/gw-probe-marker" <<EOF
#!/bin/sh
echo "\$1" >> "$LOG"
EOF
chmod +x "$BIN/gw-probe-marker"

cat > "$CONF" <<'EOF'
set -g status off
set -g mouse on
set-hook -g after-new-window 'run-shell -b "gw-probe-marker new-window"'
set-hook -g session-window-changed 'run-shell -b "gw-probe-marker window-changed"'
bind -n MouseDown1Pane run-shell -b "gw-probe-marker mouse-#{mouse_y}"
EOF

PATH="$BIN:$PATH" tmux -L "$SOCK" -f "$CONF" new-session -d -s probe
tmux -L "$SOCK" new-window
tmux -L "$SOCK" select-window -t 1
sleep 1

check() {
  printf '%-48s' "$1"
  if grep -q "$2" "$LOG" 2>/dev/null; then echo PASS; else echo FAIL; fi
}
check "A. after-new-window hook fires"       "new-window"
check "B. session-window-changed hook fires" "window-changed"
check "C. run-shell inherits server PATH"    "new-window"

printf '%-48s' "D. join-pane preserves the process"
pane=$(tmux -L "$SOCK" split-window -d -P -F '#{pane_id}' 'sleep 300')
if tmux -L "$SOCK" join-pane -d -s "$pane" -t 0 2>/dev/null &&
   tmux -L "$SOCK" list-panes -a -F '#{pane_id} #{pane_current_command}' | grep -q "$pane sleep"; then
  echo PASS
else
  echo FAIL
fi

tmux -L "$SOCK" kill-server 2>/dev/null
echo
echo "E. mouse_y: run 'tmux -L $SOCK ...' interactively and click a pane;"
echo "   a line 'mouse-<row>' in the log confirms it. Log: $LOG"
```

- [ ] **Step 3: Run it**

Run: `sh ghostty/tools/probe.sh`
Expected: A through D print PASS.

**If any check FAILs, use the fallback and note it in the commit message:**
- **A or B FAIL** — the hook name differs on this tmux. Run `tmux -L gwprobe list-hooks -g` for the real names and substitute in Task 14. If no window-change hook exists, bind `next-window`/`previous-window`/`select-window` directly to also run `gw-follow`.
- **C FAILs** — `run-shell` does not see the server PATH. In Task 14, replace bare `sb-cmd` with `#{@gw_bin}/sb-cmd` and have `gw` set `tmux set-option -g @gw_bin "$SELF"`.
- **D FAILs** — stop. The migrating-sidebar model is not viable on this tmux; return to the spec and switch to the per-window sidebar alternative.
- **E is optional.** Click-to-switch is a nice-to-have; if it does not work, skip the mouse binding in Task 14 and remove `index_for_row` usage. Keyboard switching covers the feature.

- [ ] **Step 4: Commit**

```bash
git add ghostty/tools/probe.sh
git commit -m "test: add tmux capability probe for sidebar design"
```

---

## Task 2: Package scaffold and test runner

**Files:**
- Create: `ghostty/lib/gwsidebar/__init__.py`, `ghostty/run-tests.sh`, `ghostty/tests/test_scaffold.py`

- [ ] **Step 1: Write the failing test**

`ghostty/tests/test_scaffold.py`:

```python
import unittest


class TestScaffold(unittest.TestCase):
    def test_package_imports(self):
        import gwsidebar

        self.assertTrue(hasattr(gwsidebar, "__version__"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Write the test runner**

`ghostty/run-tests.sh`:

```sh
#!/bin/sh
# Run the sidebar unit tests. Usage: sh ghostty/run-tests.sh
set -eu
cd "$(dirname "$0")"
PY="${GW_PYTHON:-python3}"
PYTHONPATH=lib exec "$PY" -m unittest discover -s tests -p 'test_*.py' -v
```

- [ ] **Step 3: Run it to verify it fails**

Run: `sh ghostty/run-tests.sh`
Expected: FAIL with `ModuleNotFoundError: No module named 'gwsidebar'`

- [ ] **Step 4: Create the package**

`ghostty/lib/gwsidebar/__init__.py`:

```python
"""Sidebar for a tmux-backed Ghostty workspace: vertical tabs and a file explorer."""

__version__ = "0.1.0"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `chmod +x ghostty/run-tests.sh && sh ghostty/run-tests.sh`
Expected: `OK` (1 test)

- [ ] **Step 6: Commit**

```bash
git add ghostty/lib/gwsidebar/__init__.py ghostty/run-tests.sh ghostty/tests/test_scaffold.py
git commit -m "feat: scaffold gwsidebar package and test runner"
```

---

## Task 3: State persistence

**Files:**
- Create: `ghostty/lib/gwsidebar/state.py`, `ghostty/tests/test_state.py`

- [ ] **Step 1: Write the failing test**

`ghostty/tests/test_state.py`:

```python
import json
import os
import tempfile
import unittest
from pathlib import Path

from gwsidebar import state


class TestState(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.environ["XDG_STATE_HOME"] = self.tmp

    def test_missing_file_returns_default(self):
        result = state.load("s1", "/tmp/root")
        self.assertEqual(result["view"], "tabs")
        self.assertEqual(result["tree"]["root"], "/tmp/root")
        self.assertEqual(result["tree"]["expanded"], [])

    def test_round_trip(self):
        data = state.default_state("/tmp/root")
        data["view"] = "files"
        data["tree"]["cursor"] = 7
        state.save("s1", data)
        self.assertEqual(state.load("s1", "/tmp/other")["view"], "files")
        self.assertEqual(state.load("s1", "/tmp/other")["tree"]["cursor"], 7)

    def test_corrupt_file_returns_default(self):
        path = state.state_path("s1")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{not json")
        self.assertEqual(state.load("s1", "/tmp/root")["view"], "tabs")

    def test_unknown_view_falls_back_to_tabs(self):
        state.save("s1", {"view": "banana", "tree": {}})
        self.assertEqual(state.load("s1", "/tmp/root")["view"], "tabs")

    def test_save_is_atomic_no_partial_files_left(self):
        state.save("s1", state.default_state("/tmp/root"))
        leftovers = [p for p in state.state_dir().iterdir() if p.suffix not in (".json", ".fifo")]
        self.assertEqual(leftovers, [])

    def test_fifo_path_is_sibling_of_state(self):
        self.assertEqual(state.fifo_path("s1").parent, state.state_path("s1").parent)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `sh ghostty/run-tests.sh`
Expected: FAIL with `ImportError: cannot import name 'state'`

- [ ] **Step 3: Implement**

`ghostty/lib/gwsidebar/state.py`:

```python
"""Persisted sidebar state. Corrupt or missing state degrades to defaults, never crashes."""

import json
import os
import re
import tempfile
from pathlib import Path

VIEWS = ("tabs", "files")

_SAFE_CHARS = re.compile(r"[^A-Za-z0-9_-]")


def _sanitize_session(session: str) -> str:
    """tmux permits `/` in session names; a raw name would escape or break the state dir."""
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `sh ghostty/run-tests.sh`
Expected: `OK` (7 tests). Review of this task added six more covering session-name sanitization, `expanded` element validation, cursor clamping, and real cleanup-on-failure — see commit `59a54eb`, which brings the suite to 13.

- [ ] **Step 5: Commit**

```bash
git add ghostty/lib/gwsidebar/state.py ghostty/tests/test_state.py
git commit -m "feat: add sidebar state persistence with corruption recovery"
```

---

## Task 4: tmux I/O boundary

Everything that shells out lives here, so every other module stays pure.

**Files:**
- Create: `ghostty/lib/gwsidebar/tmuxio.py`, `ghostty/tests/test_tmuxio.py`

- [ ] **Step 1: Write the failing test**

`ghostty/tests/test_tmuxio.py`:

```python
import unittest

from gwsidebar import tmuxio


class FakeRunner:
    def __init__(self, stdout="", returncode=0):
        self.stdout = stdout
        self.returncode = returncode
        self.calls = []

    def __call__(self, args, **kwargs):
        self.calls.append(args)
        return self


class TestTmuxIO(unittest.TestCase):
    def test_query_strips_trailing_newline(self):
        runner = FakeRunner(stdout="main\n")
        self.assertEqual(tmuxio.query("#{session_name}", runner=runner), "main")

    def test_query_passes_format_to_display_message(self):
        runner = FakeRunner(stdout="x")
        tmuxio.query("#{pane_id}", runner=runner)
        self.assertEqual(runner.calls[0], ["tmux", "display-message", "-p", "#{pane_id}"])

    def test_query_returns_empty_string_on_failure(self):
        runner = FakeRunner(stdout="", returncode=1)
        self.assertEqual(tmuxio.query("#{session_name}", runner=runner), "")

    def test_session_name_falls_back_when_tmux_silent(self):
        runner = FakeRunner(stdout="", returncode=1)
        self.assertEqual(tmuxio.session_name(runner=runner), "gw")

    def test_run_forwards_arguments(self):
        runner = FakeRunner(stdout="")
        tmuxio.run("send-keys", "-t", "%1", "ls", "Enter", runner=runner)
        self.assertEqual(runner.calls[0], ["tmux", "send-keys", "-t", "%1", "ls", "Enter"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `sh ghostty/run-tests.sh`
Expected: FAIL with `ImportError: cannot import name 'tmuxio'`

- [ ] **Step 3: Implement**

`ghostty/lib/gwsidebar/tmuxio.py`:

```python
"""The only module that talks to the tmux binary. Injectable runner keeps callers testable."""

import subprocess

DEFAULT_SESSION = "gw"


def _default_runner(args, **kwargs):
    return subprocess.run(args, capture_output=True, text=True, check=False, **kwargs)


def run(*args, runner=None):
    runner = runner or _default_runner
    return runner(["tmux", *args])


def query(fmt: str, runner=None) -> str:
    result = run("display-message", "-p", fmt, runner=runner)
    if result.returncode != 0:
        return ""
    return (result.stdout or "").strip()


def session_name(runner=None) -> str:
    return query("#{session_name}", runner=runner) or DEFAULT_SESSION
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `sh ghostty/run-tests.sh`
Expected: `OK` (12 tests)

- [ ] **Step 5: Commit**

```bash
git add ghostty/lib/gwsidebar/tmuxio.py ghostty/tests/test_tmuxio.py
git commit -m "feat: add injectable tmux I/O boundary"
```

---

## Task 5: Tab parsing

**Files:**
- Create: `ghostty/lib/gwsidebar/tabs.py`, `ghostty/tests/test_tabs.py`

- [ ] **Step 1: Write the failing test**

`ghostty/tests/test_tabs.py`:

```python
import unittest

from gwsidebar import tabs

SAMPLE = "1\tnvim\t1\t2\t0\t0\n2\tserver\t0\t1\t0\t1\n"


class TestTabs(unittest.TestCase):
    def test_parses_all_fields(self):
        result = tabs.parse(SAMPLE)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].index, 1)
        self.assertEqual(result[0].name, "nvim")
        self.assertTrue(result[0].active)
        self.assertEqual(result[0].panes, 2)
        self.assertFalse(result[0].zoomed)
        self.assertTrue(result[1].bell)

    def test_skips_blank_and_malformed_lines(self):
        self.assertEqual(tabs.parse("\n\ngarbage\n1\ta\t1\t1\t0\t0\n"), tabs.parse("1\ta\t1\t1\t0\t0"))

    def test_skips_lines_with_non_numeric_index(self):
        self.assertEqual(tabs.parse("x\ta\t1\t1\t0\t0"), [])

    def test_empty_output_gives_empty_list(self):
        self.assertEqual(tabs.parse(""), [])

    def test_index_for_row_maps_body_row_to_window(self):
        parsed = tabs.parse(SAMPLE)
        self.assertEqual(tabs.index_for_row(parsed, 0), 1)
        self.assertEqual(tabs.index_for_row(parsed, 1), 2)

    def test_index_for_row_out_of_range_returns_none(self):
        parsed = tabs.parse(SAMPLE)
        self.assertIsNone(tabs.index_for_row(parsed, 5))
        self.assertIsNone(tabs.index_for_row(parsed, -1))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `sh ghostty/run-tests.sh`
Expected: FAIL with `ImportError: cannot import name 'tabs'`

- [ ] **Step 3: Implement**

`ghostty/lib/gwsidebar/tabs.py`:

```python
"""Parse `tmux list-windows` output into tab rows. Malformed lines are skipped, never fatal."""

from dataclasses import dataclass

FIELDS = (
    "#{window_index}",
    "#{window_name}",
    "#{window_active}",
    "#{window_panes}",
    "#{window_zoomed_flag}",
    "#{window_bell_flag}",
)
FORMAT = "\t".join(FIELDS)


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
        fields = line.split("\t")
        if len(fields) != len(FIELDS):
            continue
        try:
            index = int(fields[0])
            panes = int(fields[3])
        except ValueError:
            continue
        result.append(
            Tab(
                index=index,
                name=fields[1],
                active=fields[2] == "1",
                panes=panes,
                zoomed=fields[4] == "1",
                bell=fields[5] == "1",
            )
        )
    return result


def index_for_row(parsed: list, row: int):
    """Map a 0-based row below the header to a window index, or None if off the list."""
    if 0 <= row < len(parsed):
        return parsed[row].index
    return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `sh ghostty/run-tests.sh`
Expected: `OK` (18 tests)

- [ ] **Step 5: Commit**

```bash
git add ghostty/lib/gwsidebar/tabs.py ghostty/tests/test_tabs.py
git commit -m "feat: parse tmux window list into tab rows"
```

---

## Task 6: Directory listing and flattening

**Files:**
- Create: `ghostty/lib/gwsidebar/tree.py`, `ghostty/tests/test_tree.py`

- [ ] **Step 1: Write the failing test**

`ghostty/tests/test_tree.py`:

```python
import os
import tempfile
import unittest
from pathlib import Path

from gwsidebar import tree


class TestListing(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / "src").mkdir()
        (self.root / "src" / "app.py").write_text("")
        (self.root / ".git").mkdir()
        (self.root / ".env").write_text("")
        (self.root / "README.md").write_text("")

    def test_directories_sort_before_files(self):
        names = [p.name for p in tree.list_dir(self.root, show_hidden=False)]
        self.assertEqual(names, ["src", "README.md"])

    def test_hidden_files_excluded_by_default(self):
        names = [p.name for p in tree.list_dir(self.root, show_hidden=False)]
        self.assertNotIn(".env", names)

    def test_hidden_files_included_when_requested(self):
        names = [p.name for p in tree.list_dir(self.root, show_hidden=True)]
        self.assertIn(".env", names)

    def test_git_directory_always_skipped(self):
        names = [p.name for p in tree.list_dir(self.root, show_hidden=True)]
        self.assertNotIn(".git", names)

    def test_unreadable_directory_returns_empty(self):
        self.assertEqual(tree.list_dir(self.root / "nope", show_hidden=False), [])


class TestFlatten(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / "src").mkdir()
        (self.root / "src" / "app.py").write_text("")
        (self.root / "README.md").write_text("")

    def test_collapsed_directory_hides_children(self):
        nodes = tree.flatten(self.root, expanded=set(), show_hidden=False)
        self.assertEqual([n.name for n in nodes], ["src", "README.md"])

    def test_expanded_directory_shows_children_with_depth(self):
        nodes = tree.flatten(self.root, expanded={str(self.root / "src")}, show_hidden=False)
        self.assertEqual([n.name for n in nodes], ["src", "app.py", "README.md"])
        self.assertEqual(nodes[1].depth, 1)
        self.assertTrue(nodes[0].is_dir)
        self.assertFalse(nodes[1].is_dir)

    def test_nodes_carry_absolute_paths(self):
        nodes = tree.flatten(self.root, expanded=set(), show_hidden=False)
        self.assertTrue(os.path.isabs(nodes[0].path))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `sh ghostty/run-tests.sh`
Expected: FAIL with `ImportError: cannot import name 'tree'`

- [ ] **Step 3: Implement**

`ghostty/lib/gwsidebar/tree.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `sh ghostty/run-tests.sh`
Expected: `OK` (26 tests)

- [ ] **Step 5: Commit**

```bash
git add ghostty/lib/gwsidebar/tree.py ghostty/tests/test_tree.py
git commit -m "feat: add file tree listing and flattening"
```

---

## Task 7: Cursor, scroll, and expansion math

**Files:**
- Modify: `ghostty/lib/gwsidebar/tree.py`
- Modify: `ghostty/tests/test_tree.py`

- [ ] **Step 1: Write the failing test**

Append to `ghostty/tests/test_tree.py`, above the `if __name__` block:

```python
class TestCursorMath(unittest.TestCase):
    def test_move_clamps_at_top(self):
        self.assertEqual(tree.move_cursor(0, -1, total=5), 0)

    def test_move_clamps_at_bottom(self):
        self.assertEqual(tree.move_cursor(4, 1, total=5), 4)

    def test_move_within_range(self):
        self.assertEqual(tree.move_cursor(2, 1, total=5), 3)

    def test_empty_list_pins_cursor_to_zero(self):
        self.assertEqual(tree.move_cursor(3, 1, total=0), 0)


class TestScrollMath(unittest.TestCase):
    def test_cursor_above_window_scrolls_up(self):
        self.assertEqual(tree.clamp_scroll(cursor=2, scroll=5, height=4, total=20), 2)

    def test_cursor_below_window_scrolls_down(self):
        self.assertEqual(tree.clamp_scroll(cursor=9, scroll=0, height=4, total=20), 6)

    def test_cursor_inside_window_leaves_scroll_alone(self):
        self.assertEqual(tree.clamp_scroll(cursor=3, scroll=2, height=4, total=20), 2)

    def test_scroll_never_exceeds_last_page(self):
        self.assertEqual(tree.clamp_scroll(cursor=19, scroll=18, height=10, total=20), 10)

    def test_short_list_never_scrolls(self):
        self.assertEqual(tree.clamp_scroll(cursor=1, scroll=0, height=10, total=3), 0)

    def test_zero_height_is_safe(self):
        self.assertEqual(tree.clamp_scroll(cursor=5, scroll=3, height=0, total=20), 0)


class TestExpansion(unittest.TestCase):
    def test_toggle_adds_then_removes(self):
        self.assertEqual(tree.toggle(set(), "/a"), {"/a"})
        self.assertEqual(tree.toggle({"/a"}, "/a"), set())

    def test_toggle_does_not_mutate_input(self):
        original = {"/a"}
        tree.toggle(original, "/b")
        self.assertEqual(original, {"/a"})

    def test_parent_index_finds_enclosing_directory(self):
        nodes = [
            tree.Node(path="/r/src", name="src", is_dir=True, depth=0),
            tree.Node(path="/r/src/app.py", name="app.py", is_dir=False, depth=1),
        ]
        self.assertEqual(tree.parent_index(nodes, 1), 0)

    def test_parent_index_at_top_level_returns_same_row(self):
        nodes = [tree.Node(path="/r/src", name="src", is_dir=True, depth=0)]
        self.assertEqual(tree.parent_index(nodes, 0), 0)

    def test_parent_index_empty_list_returns_zero(self):
        self.assertEqual(tree.parent_index([], 3), 0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `sh ghostty/run-tests.sh`
Expected: FAIL with `AttributeError: module 'gwsidebar.tree' has no attribute 'move_cursor'`

- [ ] **Step 3: Implement**

Append to `ghostty/lib/gwsidebar/tree.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `sh ghostty/run-tests.sh`
Expected: `OK` (41 tests)

- [ ] **Step 5: Commit**

```bash
git add ghostty/lib/gwsidebar/tree.py ghostty/tests/test_tree.py
git commit -m "feat: add cursor, scroll, and expansion math"
```

---

## Task 8: Line fitting and header

**Files:**
- Create: `ghostty/lib/gwsidebar/render.py`, `ghostty/tests/test_render.py`

- [ ] **Step 1: Write the failing test**

`ghostty/tests/test_render.py`:

```python
import unittest

from gwsidebar import render


class TestFit(unittest.TestCase):
    def test_pads_to_exact_width(self):
        self.assertEqual(len(render.fit("ab", "", 10)), 10)

    def test_right_text_is_right_aligned(self):
        self.assertEqual(render.fit("ab", "2p", 10), "ab      2p")

    def test_long_left_text_is_truncated_with_ellipsis(self):
        result = render.fit("averylongfilename.py", "", 10)
        self.assertEqual(len(result), 10)
        self.assertTrue(result.startswith("averylon"))
        self.assertIn("…", result)

    def test_width_smaller_than_right_text_returns_truncated_right(self):
        self.assertEqual(render.fit("ab", "12345", 3), "123")


class TestHeader(unittest.TestCase):
    def test_header_is_two_rows(self):
        self.assertEqual(len(render.header("tabs", width=24, color=False)), 2)

    def test_header_labels_are_plain_without_color(self):
        self.assertEqual(render.header("tabs", width=24, color=False)[0], " TABS │ FILES ")

    def test_separator_matches_width(self):
        self.assertEqual(len(render.header("tabs", width=24, color=False)[1]), 24)

    def test_active_view_is_highlighted_with_color(self):
        row = render.header("files", width=24, color=True)[0]
        self.assertIn(render.REVERSE + " FILES " + render.RESET, row)
        self.assertNotIn(render.REVERSE + " TABS ", row)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `sh ghostty/run-tests.sh`
Expected: FAIL with `ImportError: cannot import name 'render'`

- [ ] **Step 3: Implement**

`ghostty/lib/gwsidebar/render.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `sh ghostty/run-tests.sh`
Expected: `OK` (49 tests)

- [ ] **Step 5: Commit**

```bash
git add ghostty/lib/gwsidebar/render.py ghostty/tests/test_render.py
git commit -m "feat: add line fitting and sidebar header"
```

---

## Task 9: Tab, tree, and frame rendering

**Files:**
- Modify: `ghostty/lib/gwsidebar/render.py`
- Modify: `ghostty/tests/test_render.py`

- [ ] **Step 1: Write the failing test**

Append to `ghostty/tests/test_render.py`, above the `if __name__` block:

```python
from gwsidebar import tabs as tabmod
from gwsidebar import tree as treemod


def tab(index=1, name="nvim", active=False, panes=1, zoomed=False, bell=False):
    return tabmod.Tab(index=index, name=name, active=active, panes=panes, zoomed=zoomed, bell=bell)


def node(path="/r/src", name="src", is_dir=True, depth=0):
    return treemod.Node(path=path, name=name, is_dir=is_dir, depth=depth)


class TestTabLine(unittest.TestCase):
    def test_inactive_tab_has_no_marker(self):
        line = render.tab_line(tab(), width=20, color=False)
        self.assertEqual(line.rstrip(), " 1   nvim")
        self.assertEqual(len(line), 20)
        self.assertNotIn("●", line)

    def test_active_tab_shows_marker(self):
        self.assertIn("●", render.tab_line(tab(active=True), width=20, color=False))

    def test_pane_count_shown_only_when_more_than_one(self):
        self.assertIn("2p", render.tab_line(tab(panes=2), width=20, color=False))
        self.assertNotIn("1p", render.tab_line(tab(panes=1), width=20, color=False))

    def test_zoom_and_bell_markers(self):
        line = render.tab_line(tab(zoomed=True, bell=True), width=20, color=False)
        self.assertIn("Z", line)
        self.assertIn("!", line)

    def test_active_tab_reversed_with_color(self):
        line = render.tab_line(tab(active=True), width=20, color=True)
        self.assertTrue(line.startswith(render.REVERSE))
        self.assertTrue(line.endswith(render.RESET))


class TestTreeLine(unittest.TestCase):
    def test_collapsed_directory_glyph(self):
        self.assertTrue(render.tree_line(node(), False, set(), width=20, color=False).startswith("▸ src"))

    def test_expanded_directory_glyph(self):
        line = render.tree_line(node(), False, {"/r/src"}, width=20, color=False)
        self.assertTrue(line.startswith("▾ src"))

    def test_file_has_no_glyph(self):
        line = render.tree_line(node(path="/r/a.py", name="a.py", is_dir=False), False, set(), width=20, color=False)
        self.assertTrue(line.startswith("  a.py"))

    def test_depth_indents_two_spaces_per_level(self):
        line = render.tree_line(node(depth=2, is_dir=False, name="a.py"), False, set(), width=20, color=False)
        self.assertTrue(line.startswith("      a.py"))

    def test_selected_row_reversed_with_color(self):
        line = render.tree_line(node(), True, set(), width=20, color=True)
        self.assertTrue(line.startswith(render.REVERSE))


class TestFrame(unittest.TestCase):
    def test_tabs_frame_snapshot(self):
        lines = render.frame(
            "tabs", height=6, tabs=[tab(active=True), tab(index=2, name="server")], width=20, color=False
        )
        self.assertEqual(len(lines), 4)
        self.assertEqual(lines[0], " TABS │ FILES ")
        self.assertEqual(lines[1], "─" * 20)
        self.assertEqual(lines[2].rstrip(), " 1 ● nvim")
        self.assertEqual(lines[3].rstrip(), " 2   server")
        self.assertTrue(all(len(line) == 20 for line in lines[2:]))

    def test_tree_frame_snapshot(self):
        nodes = [node(), node(path="/r/src/a.py", name="a.py", is_dir=False, depth=1)]
        lines = render.frame(
            "files", height=6, nodes=nodes, cursor=1, scroll=0, expanded={"/r/src"}, width=20, color=False
        )
        self.assertEqual(len(lines), 4)
        self.assertEqual(lines[0], " TABS │ FILES ")
        self.assertEqual(lines[2].rstrip(), "▾ src")
        self.assertEqual(lines[3].rstrip(), "    a.py")
        self.assertTrue(all(len(line) == 20 for line in lines[2:]))

    def test_frame_body_respects_height(self):
        many = [tab(index=i, name=f"w{i}") for i in range(10)]
        lines = render.frame("tabs", height=5, tabs=many, width=20, color=False)
        self.assertEqual(len(lines), 5)

    def test_empty_tree_shows_placeholder(self):
        lines = render.frame("files", height=6, nodes=[], cursor=0, scroll=0, expanded=set(), width=20, color=False)
        self.assertIn("(empty)", lines[2])

    def test_scrolled_tree_starts_at_offset(self):
        nodes = [node(path=f"/r/f{i}", name=f"f{i}", is_dir=False, depth=0) for i in range(10)]
        lines = render.frame(
            "files", height=5, nodes=nodes, cursor=5, scroll=4, expanded=set(), width=20, color=False
        )
        self.assertIn("f4", lines[2])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `sh ghostty/run-tests.sh`
Expected: FAIL with `AttributeError: module 'gwsidebar.render' has no attribute 'tab_line'`

- [ ] **Step 3: Implement**

Append to `ghostty/lib/gwsidebar/render.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `sh ghostty/run-tests.sh`
Expected: `OK` (64 tests)

If a snapshot test fails on exact spacing, fix the **test** to match `fit`'s real output only after confirming by hand that the rendered width is correct — do not loosen the assertion to `assertIn`.

- [ ] **Step 5: Commit**

```bash
git add ghostty/lib/gwsidebar/render.py ghostty/tests/test_render.py
git commit -m "feat: render tab list, file tree, and full frames"
```

---

## Task 10: Renderer loop

**Files:**
- Create: `ghostty/lib/gwsidebar/sidebar_main.py`, `ghostty/tests/test_sidebar_main.py`

- [ ] **Step 1: Write the failing test**

`ghostty/tests/test_sidebar_main.py`:

```python
import os
import tempfile
import unittest
from pathlib import Path

from gwsidebar import sidebar_main, state


class TestDraw(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.environ["XDG_STATE_HOME"] = self.tmp
        self.root = Path(tempfile.mkdtemp())
        (self.root / "README.md").write_text("")

    def test_tabs_view_renders_window_names(self):
        output = sidebar_main.compose(
            "s1", root=str(self.root), width=24, height=10, list_windows=lambda: "1\tnvim\t1\t1\t0\t0"
        )
        self.assertIn("nvim", output)
        self.assertIn("TABS", output)

    def test_files_view_renders_directory_contents(self):
        data = state.default_state(str(self.root))
        data["view"] = "files"
        state.save("s1", data)
        output = sidebar_main.compose("s1", root=str(self.root), width=24, height=10, list_windows=lambda: "")
        self.assertIn("README.md", output)

    def test_output_is_crlf_separated_for_raw_terminal(self):
        output = sidebar_main.compose(
            "s1", root=str(self.root), width=24, height=10, list_windows=lambda: "1\ta\t1\t1\t0\t0"
        )
        body = output.replace(sidebar_main.CLEAR, "").replace(sidebar_main.HIDE_CURSOR, "")
        self.assertIn("\r\n", body)
        self.assertNotIn("\n", body.replace("\r\n", ""))

    def test_scroll_is_recomputed_to_keep_cursor_visible(self):
        for index in range(30):
            (self.root / f"file{index:02d}.txt").write_text("")
        data = state.default_state(str(self.root))
        data["view"] = "files"
        data["tree"]["cursor"] = 25
        data["tree"]["scroll"] = 0
        state.save("s1", data)
        output = sidebar_main.compose("s1", root=str(self.root), width=24, height=10, list_windows=lambda: "")
        self.assertIn("file25.txt", output)

    def test_render_failure_reports_inside_the_pane(self):
        def explode():
            raise RuntimeError("tmux gone")

        output = sidebar_main.compose("s1", root=str(self.root), width=24, height=10, list_windows=explode)
        self.assertIn("sidebar error", output)
        self.assertIn("tmux gone", output)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `sh ghostty/run-tests.sh`
Expected: FAIL with `ImportError: cannot import name 'sidebar_main'`

- [ ] **Step 3: Implement**

`ghostty/lib/gwsidebar/sidebar_main.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `sh ghostty/run-tests.sh`
Expected: `OK` (69 tests)

- [ ] **Step 5: Commit**

```bash
git add ghostty/lib/gwsidebar/sidebar_main.py ghostty/tests/test_sidebar_main.py
git commit -m "feat: add sidebar render loop"
```

---

## Task 11: Command verbs for view and movement

**Files:**
- Create: `ghostty/lib/gwsidebar/cmd_main.py`, `ghostty/tests/test_cmd_main.py`

- [ ] **Step 1: Write the failing test**

`ghostty/tests/test_cmd_main.py`:

```python
import os
import tempfile
import unittest
from pathlib import Path

from gwsidebar import cmd_main, state


class TestVerbs(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.environ["XDG_STATE_HOME"] = self.tmp
        self.root = Path(tempfile.mkdtemp())
        (self.root / "src").mkdir()
        (self.root / "src" / "app.py").write_text("")
        (self.root / "README.md").write_text("")
        data = state.default_state(str(self.root))
        state.save("s1", data)

    def load(self):
        return state.load("s1", str(self.root))

    def test_view_toggle_flips_between_views(self):
        cmd_main.main(["--session", "s1", "view", "toggle"])
        self.assertEqual(self.load()["view"], "files")
        cmd_main.main(["--session", "s1", "view", "toggle"])
        self.assertEqual(self.load()["view"], "tabs")

    def test_view_files_sets_view_directly(self):
        cmd_main.main(["--session", "s1", "view", "files"])
        self.assertEqual(self.load()["view"], "files")

    def test_down_moves_cursor(self):
        cmd_main.main(["--session", "s1", "down"])
        self.assertEqual(self.load()["tree"]["cursor"], 1)

    def test_down_clamps_at_last_row(self):
        for _ in range(10):
            cmd_main.main(["--session", "s1", "down"])
        self.assertEqual(self.load()["tree"]["cursor"], 1)

    def test_up_clamps_at_first_row(self):
        cmd_main.main(["--session", "s1", "up"])
        self.assertEqual(self.load()["tree"]["cursor"], 0)

    def test_expand_adds_directory_to_expanded(self):
        cmd_main.main(["--session", "s1", "expand"])
        self.assertEqual(self.load()["tree"]["expanded"], [str(self.root / "src")])

    def test_expand_on_a_file_does_nothing(self):
        cmd_main.main(["--session", "s1", "down"])
        cmd_main.main(["--session", "s1", "expand"])
        self.assertEqual(self.load()["tree"]["expanded"], [])

    def test_collapse_closes_an_expanded_directory(self):
        cmd_main.main(["--session", "s1", "expand"])
        cmd_main.main(["--session", "s1", "collapse"])
        self.assertEqual(self.load()["tree"]["expanded"], [])

    def test_collapse_on_child_jumps_to_parent(self):
        cmd_main.main(["--session", "s1", "expand"])
        cmd_main.main(["--session", "s1", "down"])
        cmd_main.main(["--session", "s1", "collapse"])
        self.assertEqual(self.load()["tree"]["cursor"], 0)
        self.assertEqual(self.load()["tree"]["expanded"], [])

    def test_toggle_hidden_flips_and_resets_cursor(self):
        cmd_main.main(["--session", "s1", "down"])
        cmd_main.main(["--session", "s1", "toggle-hidden"])
        self.assertTrue(self.load()["tree"]["show_hidden"])
        self.assertEqual(self.load()["tree"]["cursor"], 0)

    def test_root_rebases_the_tree_and_clears_expansion(self):
        other = tempfile.mkdtemp()
        cmd_main.main(["--session", "s1", "expand"])
        cmd_main.main(["--session", "s1", "root", other])
        data = self.load()
        self.assertEqual(data["tree"]["root"], other)
        self.assertEqual(data["tree"]["expanded"], [])
        self.assertEqual(data["tree"]["cursor"], 0)

    def test_unknown_verb_exits_non_zero(self):
        self.assertEqual(cmd_main.main(["--session", "s1", "banana"]), 2)

    def test_empty_tree_verbs_do_not_crash(self):
        empty = tempfile.mkdtemp()
        cmd_main.main(["--session", "s1", "root", empty])
        self.assertEqual(cmd_main.main(["--session", "s1", "down"]), 0)
        self.assertEqual(cmd_main.main(["--session", "s1", "expand"]), 0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `sh ghostty/run-tests.sh`
Expected: FAIL with `ImportError: cannot import name 'cmd_main'`

- [ ] **Step 3: Implement**

`ghostty/lib/gwsidebar/cmd_main.py`:

```python
"""Every keybinding lands here. Mutates state, then pokes the renderer."""

import argparse
import os
from pathlib import Path

from . import state, tmuxio, tree

MOVES = {"up": -1, "down": 1}


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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `sh ghostty/run-tests.sh`
Expected: `OK` (82 tests)

- [ ] **Step 5: Commit**

```bash
git add ghostty/lib/gwsidebar/cmd_main.py ghostty/tests/test_cmd_main.py
git commit -m "feat: add sidebar command verbs for view and tree movement"
```

---

## Task 12: Opening files and directories

`activate` on a directory toggles expansion; on a file it types `$EDITOR <path>` into the work pane's shell. The shell guard prevents typing into a running program.

**Files:**
- Modify: `ghostty/lib/gwsidebar/cmd_main.py`
- Modify: `ghostty/tests/test_cmd_main.py`

- [ ] **Step 1: Write the failing test**

Add `from unittest import mock` to the imports at the top of `ghostty/tests/test_cmd_main.py`, then append below, above the `if __name__` block:

```python
class FakeTmux:
    """Stands in for tmuxio: canned query answers, recorded commands."""

    def __init__(self, current_command="zsh", pane_id="%1"):
        self.answers = {"#{pane_current_command}": current_command, "#{pane_id}": pane_id}
        self.sent = []
        self.messages = []

    def query(self, fmt, runner=None):
        return self.answers.get(fmt, "")

    def run(self, *args, runner=None):
        if args and args[0] == "send-keys":
            self.sent.append(args)
        if args and args[0] == "display-message":
            self.messages.append(args)
        return self


class TestActivate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.environ["XDG_STATE_HOME"] = self.tmp
        os.environ["EDITOR"] = "nvim"
        self.root = Path(tempfile.mkdtemp())
        (self.root / "src").mkdir()
        (self.root / "notes one.md").write_text("")
        state.save("s1", state.default_state(str(self.root)))
        self.fake = FakeTmux()
        patcher = mock.patch.object(cmd_main, "tmuxio", self.fake)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_activate_on_directory_expands_it(self):
        cmd_main.main(["--session", "s1", "activate"])
        self.assertEqual(state.load("s1", str(self.root))["tree"]["expanded"], [str(self.root / "src")])
        self.assertEqual(self.fake.sent, [])

    def test_activate_on_file_sends_editor_command(self):
        cmd_main.main(["--session", "s1", "down"])
        cmd_main.main(["--session", "s1", "activate"])
        self.assertEqual(len(self.fake.sent), 1)
        command = self.fake.sent[0][3]
        self.assertIn("nvim", command)
        self.assertIn("notes one.md", command)

    def test_paths_with_spaces_are_quoted(self):
        cmd_main.main(["--session", "s1", "down"])
        cmd_main.main(["--session", "s1", "activate"])
        self.assertIn("'", self.fake.sent[0][3])

    def test_nothing_is_sent_when_a_program_is_running(self):
        self.fake.answers["#{pane_current_command}"] = "psql"
        cmd_main.main(["--session", "s1", "down"])
        cmd_main.main(["--session", "s1", "activate"])
        self.assertEqual(self.fake.sent, [])
        self.assertTrue(self.fake.messages)

    def test_cd_sends_directory_of_selection(self):
        cmd_main.main(["--session", "s1", "cd"])
        self.assertIn("cd ", self.fake.sent[0][3])
        self.assertIn("src", self.fake.sent[0][3])

    def test_cd_on_a_file_uses_its_parent_directory(self):
        cmd_main.main(["--session", "s1", "down"])
        cmd_main.main(["--session", "s1", "cd"])
        self.assertIn(str(self.root), self.fake.sent[0][3])
        self.assertNotIn("notes one.md", self.fake.sent[0][3])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `sh ghostty/run-tests.sh`
Expected: FAIL — `activate` returns 2 (unknown verb), so no state change and no sends.

- [ ] **Step 3: Implement**

Add to the imports at the top of `ghostty/lib/gwsidebar/cmd_main.py`:

```python
import shlex
```

Add these functions above `apply_verb`:

```python
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
```

Add these branches inside `apply_verb`, immediately before the final `return 2`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `sh ghostty/run-tests.sh`
Expected: `OK` (88 tests)

- [ ] **Step 5: Commit**

```bash
git add ghostty/lib/gwsidebar/cmd_main.py ghostty/tests/test_cmd_main.py
git commit -m "feat: open files and directories from the tree with a shell guard"
```

---

## Task 13: Executable wrappers and launcher

The wrappers pin the interpreter, so `PATH` resolution order (conda, system 3.9) can never pick the wrong Python.

**Files:**
- Create: `ghostty/bin/sidebar`, `ghostty/bin/sb-cmd`, `ghostty/bin/gw`

- [ ] **Step 1: Write the wrappers**

`ghostty/bin/sidebar`:

```sh
#!/bin/sh
exec "${GW_PYTHON:-python3}" -m gwsidebar.sidebar_main "$@"
```

`ghostty/bin/sb-cmd`:

```sh
#!/bin/sh
exec "${GW_PYTHON:-python3}" -m gwsidebar.cmd_main "$@"
```

- [ ] **Step 2: Write the launcher**

`ghostty/bin/gw`:

```sh
#!/bin/sh
# Launch the Ghostty workspace: preflight, pin the interpreter, attach the tmux session.
set -eu

SELF=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$SELF")
MIN_TMUX=3.3
SESSION="${1:-gw}"

die() { printf '%s\n' "$1" >&2; exit 1; }

command -v tmux >/dev/null 2>&1 ||
  die "tmux not found. Install it with:  brew install tmux"

version=$(tmux -V | sed 's/^tmux //')
oldest=$(printf '%s\n%s\n' "$MIN_TMUX" "$version" | sort -V | head -1)
[ "$oldest" = "$MIN_TMUX" ] ||
  die "tmux $MIN_TMUX or newer required (found $version). Upgrade with:  brew upgrade tmux"

pick_python() {
  for candidate in "${GW_PYTHON:-}" /opt/homebrew/bin/python3.13 /usr/local/bin/python3.13 python3; do
    [ -n "$candidate" ] || continue
    command -v "$candidate" >/dev/null 2>&1 || continue
    if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

GW_PYTHON=$(pick_python) ||
  die "Python 3.11 or newer not found. Install it with:  brew install python@3.13"

export GW_PYTHON
export PYTHONPATH="$ROOT/lib${PYTHONPATH:+:$PYTHONPATH}"
export PATH="$SELF:$PATH"

exec tmux -L gw -f "$ROOT/tmux/tmux.conf" new-session -A -s "$SESSION" -c "$PWD"
```

- [ ] **Step 3: Verify the preflight rejects a bad interpreter**

```bash
chmod +x ghostty/bin/gw ghostty/bin/sidebar ghostty/bin/sb-cmd
GW_PYTHON=/usr/bin/python3 sh -c 'cd ghostty && GW_PYTHON=/usr/bin/python3 ./bin/gw --help' 2>&1 | head -3
```

Expected: it does **not** use `/usr/bin/python3` (3.9). Confirm the chosen interpreter directly:

```bash
GW_PYTHON=/usr/bin/python3 sh -eu -c '
  for c in "${GW_PYTHON:-}" /opt/homebrew/bin/python3.13 python3; do
    command -v "$c" >/dev/null 2>&1 || continue
    "$c" -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)" 2>/dev/null && { command -v "$c"; break; }
  done'
```

Expected: prints `/opt/homebrew/bin/python3.13`, not `/usr/bin/python3`.

- [ ] **Step 4: Verify the module entry points run**

```bash
PYTHONPATH=ghostty/lib /opt/homebrew/bin/python3.13 -m gwsidebar.cmd_main --session probe view toggle && echo OK
```

Expected: `OK`, and `~/.local/state/gw/probe.json` now exists containing `"view": "files"`.

- [ ] **Step 5: Commit**

```bash
git add ghostty/bin/gw ghostty/bin/sidebar ghostty/bin/sb-cmd
git commit -m "feat: add launcher and interpreter-pinning wrappers"
```

---

## Task 14: tmux configuration, sidebar creation, and migration

**Files:**
- Create: `ghostty/bin/gw-sidebar`, `ghostty/bin/gw-follow`, `ghostty/tmux/tmux.conf`

- [ ] **Step 1: Write the sidebar creator**

`ghostty/bin/gw-sidebar`:

```sh
#!/bin/sh
# Create the single sidebar pane in the active window, unless it already exists somewhere.
set -eu

existing=$(tmux show-option -gqv @sidebar_pane)
if [ -n "$existing" ] && tmux list-panes -a -F '#{pane_id}' | grep -qx "$existing"; then
  exit 0
fi

active=$(tmux display-message -p '#{pane_id}')
pane=$(tmux split-window -bhd -l 24 -P -F '#{pane_id}' 'sidebar')
tmux set-option -p -t "$pane" @sidebar 1
tmux set-option -g @sidebar_pane "$pane"
tmux select-layout main-vertical
tmux select-pane -t "$active"
```

- [ ] **Step 2: Write the migration script**

`ghostty/bin/gw-follow`:

```sh
#!/bin/sh
# Move the one sidebar pane into the active window and re-apply the layout.
set -eu

lock="${TMPDIR:-/tmp}/gw-follow.lock"
mkdir "$lock" 2>/dev/null || exit 0
trap 'rmdir "$lock" 2>/dev/null || true' EXIT

pane=$(tmux show-option -gqv @sidebar_pane)
if [ -z "$pane" ] || ! tmux list-panes -a -F '#{pane_id}' | grep -qx "$pane"; then
  gw-sidebar
  exit 0
fi

window=$(tmux display-message -p '#{window_id}')
holder=$(tmux list-panes -a -F '#{pane_id} #{window_id}' | awk -v p="$pane" '$1 == p {print $2}')
[ "$holder" = "$window" ] && exit 0

active=$(tmux display-message -p '#{pane_id}')
tmux join-pane -bhd -l 24 -s "$pane" -t "$window"
tmux select-layout -t "$window" main-vertical
tmux select-pane -t "$active"
```

- [ ] **Step 3: Write the tmux config**

`ghostty/tmux/tmux.conf`:

```tmux
# Ghostty workspace config. Loaded only via `tmux -f`; ~/.tmux.conf is never read.

set -g mouse on
set -g base-index 1
set -g pane-base-index 1
set -g main-pane-width 24
set -g status off
set -g escape-time 10
set -g focus-events on
set -g renumber-windows on
set -g pane-border-style "fg=colour238"
set -g pane-active-border-style "fg=colour238"

# --- sidebar lifecycle -------------------------------------------------------
set-hook -g after-new-window   'run-shell -b "gw-follow"'
set-hook -g session-window-changed 'run-shell -b "gw-follow"'

# --- tab navigation ----------------------------------------------------------
bind -N "Next tab"     j next-window
bind -N "Previous tab" k previous-window
bind -N "New tab"      t new-window

# --- sidebar views -----------------------------------------------------------
bind -N "Toggle sidebar view" Tab run-shell -b "sb-cmd view toggle"
bind -N "Rebuild sidebar"     B   run-shell -b "gw-sidebar"
bind -N "Re-root file tree"   R   run-shell -b "sb-cmd root '#{pane_current_path}'"
bind -N "File explorer"       e   run-shell -b "sb-cmd view files" \; switch-client -T tree

# --- tree mode ---------------------------------------------------------------
# Each binding re-enters the table, since tmux returns to root after one key.
bind -T tree j      run-shell -b "sb-cmd down"          \; switch-client -T tree
bind -T tree k      run-shell -b "sb-cmd up"            \; switch-client -T tree
bind -T tree l      run-shell -b "sb-cmd expand"        \; switch-client -T tree
bind -T tree h      run-shell -b "sb-cmd collapse"      \; switch-client -T tree
bind -T tree Enter  run-shell -b "sb-cmd activate"      \; switch-client -T tree
bind -T tree c      run-shell -b "sb-cmd cd"            \; switch-client -T tree
bind -T tree .      run-shell -b "sb-cmd toggle-hidden" \; switch-client -T tree
bind -T tree q      switch-client -T root
bind -T tree Escape switch-client -T root

# --- keep focus out of the chrome -------------------------------------------
bind -N "Next pane" o select-pane -t :.+ \; if -F '#{@sidebar}' 'select-pane -t :.+'
```

**If probe check C failed in Task 1**, replace every bare `sb-cmd`, `gw-sidebar`, and `gw-follow` above with `#{@gw_bin}/...` and add `tmux set-option -g @gw_bin "$SELF"` to `gw` before the `exec`.

**If probe check B failed**, delete the `session-window-changed` hook line and instead append `\; run-shell -b "gw-follow"` to the `next-window`, `previous-window`, and `new-window` bindings.

- [ ] **Step 4: Verify the sidebar appears**

```bash
chmod +x ghostty/bin/gw-sidebar ghostty/bin/gw-follow
cd ghostty && ./bin/gw probe
```

Expected: a 24-column sidebar on the left showing `TABS │ FILES` and one tab row. Press `prefix + Tab` to see the file tree, `prefix + t` for a new tab, and confirm the sidebar follows into it. Detach with `prefix + d`, then clean up: `tmux -L gw kill-server`. The workspace runs on its own `gw` socket, so this never touches another tmux server you have running.

- [ ] **Step 5: Commit**

```bash
git add ghostty/bin/gw-sidebar ghostty/bin/gw-follow ghostty/tmux/tmux.conf
git commit -m "feat: add tmux config, sidebar creation, and migration"
```

---

## Task 14b: Click-to-switch (optional — only if probe check E passed)

`tabs.index_for_row` exists for this. **If probe E failed, skip this task and delete `index_for_row`
and its two tests from Task 5** rather than leaving dead code behind.

**Files:**
- Modify: `ghostty/lib/gwsidebar/cmd_main.py`
- Modify: `ghostty/tmux/tmux.conf`
- Modify: `ghostty/tests/test_cmd_main.py`

- [ ] **Step 1: Write the failing test**

Append to `ghostty/tests/test_cmd_main.py`, above the `if __name__` block:

```python
class ClickTmux(FakeTmux):
    """FakeTmux that also answers list-windows, which click handling needs."""

    def __init__(self, windows="1\tnvim\t1\t1\t0\t0\n2\tserver\t0\t1\t0\t0\n"):
        super().__init__()
        self.stdout = windows
        self.selected = []

    def run(self, *args, runner=None):
        if args and args[0] == "select-window":
            self.selected.append(args[-1])
        return super().run(*args, runner=runner)


class TestClick(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.environ["XDG_STATE_HOME"] = self.tmp
        self.root = Path(tempfile.mkdtemp())
        (self.root / "a.txt").write_text("")
        (self.root / "b.txt").write_text("")
        (self.root / "c.txt").write_text("")
        state.save("s1", state.default_state(str(self.root)))
        self.fake = ClickTmux()
        patcher = mock.patch.object(cmd_main, "tmuxio", self.fake)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_click_on_header_toggles_view(self):
        cmd_main.main(["--session", "s1", "click", "0"])
        self.assertEqual(state.load("s1", str(self.root))["view"], "files")

    def test_click_on_separator_row_does_nothing(self):
        cmd_main.main(["--session", "s1", "click", "1"])
        self.assertEqual(state.load("s1", str(self.root))["view"], "tabs")
        self.assertEqual(self.fake.selected, [])

    def test_click_on_tab_row_selects_that_window(self):
        cmd_main.main(["--session", "s1", "click", "3"])
        self.assertEqual(self.fake.selected, ["2"])

    def test_click_past_the_last_tab_selects_nothing(self):
        cmd_main.main(["--session", "s1", "click", "9"])
        self.assertEqual(self.fake.selected, [])

    def test_click_in_files_view_moves_the_cursor(self):
        cmd_main.main(["--session", "s1", "view", "files"])
        cmd_main.main(["--session", "s1", "click", "4"])
        self.assertEqual(state.load("s1", str(self.root))["tree"]["cursor"], 2)

    def test_non_numeric_click_is_rejected(self):
        self.assertEqual(cmd_main.main(["--session", "s1", "click", "x"]), 2)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `sh ghostty/run-tests.sh`
Expected: FAIL — `click` is an unknown verb, so nothing is selected and the view never changes.

- [ ] **Step 3: Implement**

Add `tabs` to the imports in `ghostty/lib/gwsidebar/cmd_main.py`:

```python
from . import state, tabs, tmuxio, tree
```

Add this branch inside `apply_verb`, immediately before the final `return 2`:

```python
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
```

Add this constant near the top of `cmd_main.py`, below `MOVES`:

```python
HEADER_ROWS = 2
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `sh ghostty/run-tests.sh`
Expected: `OK` (94 tests)

- [ ] **Step 5: Bind the mouse in tmux**

Add to `ghostty/tmux/tmux.conf`, at the end of the sidebar views section:

```tmux
bind -n MouseDown1Pane if -F '#{@sidebar}' 'run-shell -b "sb-cmd click #{mouse_y}"' 'select-pane -t=; send -M'
```

- [ ] **Step 6: Verify by clicking**

Run `ghostty/bin/gw probe`, create a second tab with `prefix + t`, then click the first tab row in
the sidebar. Expected: the workspace switches to tab 1. Click the header: the view flips.
Clicking anywhere in a normal pane must still position the cursor as usual.

- [ ] **Step 7: Commit**

```bash
git add ghostty/lib/gwsidebar/cmd_main.py ghostty/tests/test_cmd_main.py ghostty/tmux/tmux.conf
git commit -m "feat: add click-to-switch in the sidebar"
```

---

## Task 15: Integration smoke test

**Files:**
- Create: `ghostty/tests/test_smoke.sh`

- [ ] **Step 1: Write the smoke test**

`ghostty/tests/test_smoke.sh`:

```sh
#!/bin/sh
# End-to-end check on a throwaway tmux server. Run: sh ghostty/tests/test_smoke.sh
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SOCK=gwsmoke
STATE=$(mktemp -d)
failures=0

export XDG_STATE_HOME="$STATE"
export PATH="$ROOT/bin:$PATH"
export PYTHONPATH="$ROOT/lib"
export GW_PYTHON="${GW_PYTHON:-/opt/homebrew/bin/python3.13}"

check() {
  printf '%-52s' "$1"
  if [ "$2" = "0" ]; then echo PASS; else echo FAIL; failures=$((failures + 1)); fi
}

tmux -L "$SOCK" -f "$ROOT/tmux/tmux.conf" new-session -d -s smoke -x 100 -y 30
sleep 1
gw-sidebar 2>/dev/null || tmux -L "$SOCK" run-shell "gw-sidebar"
sleep 1

pane=$(tmux -L "$SOCK" show-option -gqv @sidebar_pane)
[ -n "$pane" ]; check "sidebar pane was created" $?

tmux -L "$SOCK" capture-pane -p -t "$pane" | grep -q "TABS"; check "sidebar renders its header" $?

tmux -L "$SOCK" new-window
sleep 1
holder=$(tmux -L "$SOCK" list-panes -a -F '#{pane_id} #{window_index}' | awk -v p="$pane" '$1 == p {print $2}')
[ "$holder" = "2" ]; check "sidebar migrated to the new window" $?

count=$(tmux -L "$SOCK" list-panes -a -F '#{pane_id}' | grep -cx "$pane")
[ "$count" = "1" ]; check "exactly one sidebar exists" $?

tmux -L "$SOCK" run-shell "sb-cmd --session smoke view toggle"
sleep 1
grep -q '"view": "files"' "$STATE/gw/smoke.json"; check "view toggle reached the state file" $?

tmux -L "$SOCK" capture-pane -p -t "$pane" | grep -q "FILES"; check "sidebar redrew after the poke" $?

width=$(tmux -L "$SOCK" display-message -pt "$pane" '#{pane_width}')
[ "$width" = "24" ]; check "sidebar is 24 columns wide" $?

tmux -L "$SOCK" kill-server 2>/dev/null
rm -rf "$STATE"

echo
if [ "$failures" -eq 0 ]; then echo "smoke: all checks passed"; else echo "smoke: $failures failed"; fi
exit "$failures"
```

- [ ] **Step 2: Run it**

Run: `chmod +x ghostty/tests/test_smoke.sh && sh ghostty/tests/test_smoke.sh`
Expected: every line PASS, exit status 0.

If "sidebar redrew after the poke" fails but the state file check passed, the FIFO poke is not reaching the renderer — check that `sb-cmd` and `sidebar` agree on the session name by running `tmux -L gwsmoke display-message -p '#{session_name}'`.

- [ ] **Step 3: Commit**

```bash
git add ghostty/tests/test_smoke.sh
git commit -m "test: add end-to-end sidebar smoke test"
```

---

## Task 16: Ghostty config, installer, and docs

**Files:**
- Create: `ghostty/config`, `ghostty/install.sh`, `ghostty/README.md`

- [ ] **Step 1: Write the Ghostty config**

`ghostty/config`:

```ini
# Ghostty settings for the workspace. Included by ~/.config/ghostty/config,
# which install.sh generates with the absolute path to bin/gw.

theme = Catppuccin Frappe
font-size = 13
window-padding-x = 4
window-padding-y = 4
window-save-state = always
macos-option-as-alt = true
mouse-hide-while-typing = true
confirm-close-surface = false
```

- [ ] **Step 2: Write the installer**

`ghostty/install.sh`:

```sh
#!/bin/sh
# Install the Ghostty workspace. Idempotent. Pass --dry-run to see what it would do.
set -eu

ROOT=$(cd "$(dirname "$0")" && pwd)
TARGET="$HOME/.config/ghostty/config"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

say() { printf '%s\n' "$1"; }
act() { if [ "$DRY" -eq 1 ]; then say "would: $*"; else "$@"; fi; }

missing=0
for tool in tmux; do
  command -v "$tool" >/dev/null 2>&1 || { say "missing: $tool  ->  brew install $tool"; missing=1; }
done
if ! /opt/homebrew/bin/python3.13 -V >/dev/null 2>&1 &&
   ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
  say "missing: python >= 3.11  ->  brew install python@3.13"
  missing=1
fi
[ -d /Applications/Ghostty.app ] || say "note: Ghostty.app not found in /Applications"
[ "$missing" -eq 1 ] && say "install the tools above, then re-run this script" && exit 1

act chmod +x "$ROOT/bin/gw" "$ROOT/bin/gw-sidebar" "$ROOT/bin/gw-follow" \
    "$ROOT/bin/sidebar" "$ROOT/bin/sb-cmd" "$ROOT/run-tests.sh" "$ROOT/tests/test_smoke.sh"

if [ -e "$TARGET" ] && [ ! -L "$TARGET" ]; then
  act cp "$TARGET" "$TARGET.bak"
  say "backed up existing config to $TARGET.bak"
fi

act mkdir -p "$(dirname "$TARGET")"
if [ "$DRY" -eq 1 ]; then
  say "would write $TARGET with config-file and command pointing at $ROOT"
else
  cat > "$TARGET" <<EOF
# Generated by $ROOT/install.sh — edit $ROOT/config instead.
config-file = $ROOT/config
command = $ROOT/bin/gw
EOF
fi

say ""
say "Installed. Add this to your shell rc to use gw outside Ghostty:"
say "  export PATH=\"$ROOT/bin:\$PATH\""
say ""
say "Then open Ghostty, or run: $ROOT/bin/gw"
```

- [ ] **Step 3: Run the installer in dry-run mode**

Run: `sh ghostty/install.sh --dry-run`
Expected: prints `would:` lines for chmod and the config write, touches nothing. Confirm with `ls ~/.config/ghostty/` that nothing changed.

- [ ] **Step 4: Run it for real and verify**

```bash
sh ghostty/install.sh
cat ~/.config/ghostty/config
```

Expected: two settings lines pointing at absolute paths under this repo. Open Ghostty; it should launch into the workspace with the sidebar visible.

- [ ] **Step 5: Write the README**

`ghostty/README.md`:

````markdown
# Ghostty workspace: vertical tabs + file explorer

A 24-column sidebar with two switchable views, built on tmux. Ghostty has no plugin API,
so nothing here runs inside Ghostty — it is a tmux session that Ghostty opens into.

## Install

```sh
brew install tmux python@3.13
sh ghostty/install.sh
export PATH="$PWD/ghostty/bin:$PATH"   # add to your shell rc
```

## Keys

| Key | Action |
|---|---|
| `prefix + Tab` | Switch sidebar view |
| `prefix + e` | File explorer + tree mode |
| `prefix + j` / `k` | Next / previous tab |
| `prefix + t` | New tab |
| `prefix + R` | Re-root the tree here |
| `prefix + B` | Rebuild the sidebar |
| `j` `k` `h` `l` (tree mode) | Move, collapse, expand |
| `Enter` (tree mode) | Open file, or expand folder |
| `c` (tree mode) | `cd` the shell to the selection |
| `.` (tree mode) | Toggle hidden files |
| `q` / `Escape` | Leave tree mode |

## Tests

```sh
sh ghostty/run-tests.sh          # unit tests
sh ghostty/tests/test_smoke.sh   # end-to-end on a throwaway tmux server
```

## Uninstall

Delete `~/.config/ghostty/config` (restore `config.bak` if present) and remove the PATH line.
Nothing else on the system was modified: no `~/.tmux.conf` changes, no shell rc edits, no daemons.

## Notes

- Work panes stack vertically to the right of the sidebar — that is `main-vertical` doing its job.
- Killing the window holding the sidebar kills the sidebar. `prefix + B` brings it back.
- State lives in `~/.local/state/gw/<session>.json` and is safe to delete.
````

- [ ] **Step 6: Commit**

```bash
git add ghostty/config ghostty/install.sh ghostty/README.md
git commit -m "feat: add ghostty config, installer, and docs"
```

---

## Done criteria

- [ ] `sh ghostty/run-tests.sh` passes (88 tests, or 94 with the optional click task)
- [ ] `sh ghostty/tests/test_smoke.sh` exits 0
- [ ] Opening Ghostty lands in the workspace with the sidebar visible
- [ ] `prefix + Tab` switches views; `prefix + e` then `j`/`k`/`Enter` navigates and opens a file
- [ ] Creating and switching tabs moves the sidebar without duplicating it
