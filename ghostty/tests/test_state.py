import os
import tempfile
import unittest
from unittest import mock

from gwsidebar import state


class TestState(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = mock.patch.dict(os.environ, {"XDG_STATE_HOME": self.tmp.name})
        patcher.start()
        self.addCleanup(patcher.stop)

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

    def test_save_cleans_up_tmp_file_on_serialization_failure(self):
        state.save("s1", state.default_state("/tmp/root"))
        before = state.state_path("s1").read_text()

        with self.assertRaises(TypeError):
            state.save("s1", {"view": "tabs", "tree": {"bad": {1, 2, 3}}})

        leftovers = [p for p in state.state_dir().iterdir() if p.suffix not in (".json", ".fifo")]
        self.assertEqual(leftovers, [])
        self.assertEqual(state.state_path("s1").read_text(), before)

    def test_fifo_path_is_sibling_of_state(self):
        self.assertEqual(state.fifo_path("s1").parent, state.state_path("s1").parent)

    def test_session_name_with_slash_round_trips(self):
        data = state.default_state("/tmp/root")
        data["view"] = "files"
        state.save("feat/bar", data)
        self.assertEqual(state.load("feat/bar", "/tmp/other")["view"], "files")

    def test_session_name_cannot_escape_state_dir(self):
        path = state.state_path("../../escape")
        self.assertEqual(path.parent, state.state_dir())

    def test_state_path_and_fifo_path_sanitize_identically(self):
        session = "weird/../name with spaces!"
        self.assertEqual(state.state_path(session).stem, state.fifo_path(session).stem)

    def test_expanded_list_keeps_only_strings(self):
        state.save("s1", {"view": "tabs", "tree": {"expanded": ["/a", 1, None, {"a": 1}, "/b"]}})
        self.assertEqual(state.load("s1", "/tmp/root")["tree"]["expanded"], ["/a", "/b"])

    def test_negative_cursor_and_scroll_clamp_to_zero(self):
        state.save("s1", {"view": "tabs", "tree": {"cursor": -5, "scroll": -3}})
        result = state.load("s1", "/tmp/root")
        self.assertEqual(result["tree"]["cursor"], 0)
        self.assertEqual(result["tree"]["scroll"], 0)


if __name__ == "__main__":
    unittest.main()
