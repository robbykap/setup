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
