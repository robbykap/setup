import shutil
import subprocess
import unittest

from gwsidebar import tabs

SAMPLE = "1|1|2|0|0|nvim\n2|0|1|0|1|server\n"


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
        result = tabs.parse("\n\ngarbage\n1|1|1|0|0|a\n")
        self.assertEqual(
            result,
            [tabs.Tab(index=1, name="a", active=True, panes=1, zoomed=False, bell=False)],
        )

    def test_skips_lines_with_non_numeric_index(self):
        self.assertEqual(tabs.parse("x|1|1|0|0|a"), [])

    def test_skips_lines_with_non_numeric_panes(self):
        self.assertEqual(tabs.parse("1|1|x|0|0|a"), [])

    def test_window_name_containing_separator_is_preserved(self):
        result = tabs.parse("1|1|1|0|0|a|b c")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].name, "a|b c")

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


@unittest.skipUnless(shutil.which("tmux"), "tmux binary not available")
class TestFormatAgainstRealTmux(unittest.TestCase):
    """Guards the actual regression: tmux rewriting control chars under a non-UTF-8 locale."""

    SOCKET = "gwtest"

    def _run_against_real_tmux(self, env):
        subprocess.run(
            ["tmux", "-L", self.SOCKET, "-f", "/dev/null", "new-session", "-d", "-s", "fmt"],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )
        try:
            result = subprocess.run(
                ["tmux", "-L", self.SOCKET, "list-windows", "-F", tabs.FORMAT],
                check=True,
                capture_output=True,
                text=True,
                env=env,
            )
        finally:
            subprocess.run(
                ["tmux", "-L", self.SOCKET, "kill-server"],
                capture_output=True,
                text=True,
                env=env,
            )
        parsed = tabs.parse(result.stdout)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0].index, 0)
        self.assertTrue(parsed[0].name)

    def test_format_round_trips_with_default_locale(self):
        self._run_against_real_tmux(env=None)

    def test_format_round_trips_under_lc_all_c(self):
        import os

        env = dict(os.environ)
        env["LC_ALL"] = "C"
        self._run_against_real_tmux(env=env)


if __name__ == "__main__":
    unittest.main()
