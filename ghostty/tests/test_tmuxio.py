import os
import tempfile
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
    def test_query_strips_surrounding_whitespace_not_just_trailing_newline(self):
        # Pins .strip() as the contract: leading whitespace and a blank trailing
        # line must both go. rstrip("\n") or rstrip() alone would leave the
        # leading spaces (and, for rstrip("\n"), the trailing spaces) behind.
        runner = FakeRunner(stdout="  main  \n")
        self.assertEqual(tmuxio.query("#{session_name}", runner=runner), "main")

    def test_query_passes_format_to_display_message(self):
        runner = FakeRunner(stdout="x")
        tmuxio.query("#{pane_id}", runner=runner)
        self.assertEqual(runner.calls[0], ["tmux", "display-message", "-p", "#{pane_id}"])

    def test_query_returns_empty_string_on_failure(self):
        runner = FakeRunner(stdout="", returncode=1)
        self.assertEqual(tmuxio.query("#{session_name}", runner=runner), "")

    def test_session_name_falls_back_when_tmux_fails(self):
        runner = FakeRunner(stdout="", returncode=1)
        self.assertEqual(tmuxio.session_name(runner=runner), "gw")

    def test_session_name_falls_back_when_tmux_silent(self):
        # Genuine silence: tmux exits 0 but prints nothing, which is what it
        # does when queried outside of any session.
        runner = FakeRunner(stdout="", returncode=0)
        self.assertEqual(tmuxio.session_name(runner=runner), "gw")

    def test_run_forwards_arguments(self):
        runner = FakeRunner(stdout="")
        tmuxio.run("send-keys", "-t", "%1", "ls", "Enter", runner=runner)
        self.assertEqual(runner.calls[0], ["tmux", "send-keys", "-t", "%1", "ls", "Enter"])


class TestMissingTmuxBinary(unittest.TestCase):
    """With no tmux binary reachable, the boundary must be total: return, never raise."""

    def setUp(self):
        self.missing_dir = tempfile.mkdtemp()
        self.original_path = os.environ.get("PATH", "")
        os.environ["PATH"] = self.missing_dir
        self.addCleanup(self._restore_path)

    def _restore_path(self):
        os.environ["PATH"] = self.original_path

    def test_run_returns_a_failed_result_instead_of_raising(self):
        result = tmuxio.run("display-message", "-p", "#{session_name}")
        self.assertNotEqual(result.returncode, 0)

    def test_query_returns_empty_string_instead_of_raising(self):
        self.assertEqual(tmuxio.query("#{session_name}"), "")

    def test_session_name_falls_back_to_gw(self):
        self.assertEqual(tmuxio.session_name(), "gw")


if __name__ == "__main__":
    unittest.main()
