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
