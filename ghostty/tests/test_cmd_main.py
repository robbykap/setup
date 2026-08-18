import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

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

    def test_nothing_is_sent_when_current_command_is_unknown(self):
        # Empty #{pane_current_command} means tmux could not be reached, not
        # that a program happens to be running — must still fail closed.
        self.fake.answers["#{pane_current_command}"] = ""
        self.assertFalse(cmd_main.send_to_shell("ls"))
        self.assertEqual(self.fake.sent, [])

    def test_nothing_is_sent_when_pane_id_is_unknown(self):
        self.fake.answers["#{pane_id}"] = ""
        self.assertFalse(cmd_main.send_to_shell("ls"))
        self.assertEqual(self.fake.sent, [])

    def test_unreachable_tmux_message_differs_from_program_running_message(self):
        self.fake.answers["#{pane_current_command}"] = ""
        cmd_main.send_to_shell("ls")
        unreachable_message = self.fake.messages[0][1]

        self.fake.messages = []
        self.fake.answers["#{pane_current_command}"] = "psql"
        cmd_main.send_to_shell("ls")
        running_message = self.fake.messages[0][1]

        self.assertNotEqual(unreachable_message, running_message)
        self.assertNotIn("running", unreachable_message)
        self.assertIn("running", running_message)


if __name__ == "__main__":
    unittest.main()
