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
