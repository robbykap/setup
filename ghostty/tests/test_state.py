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
