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
