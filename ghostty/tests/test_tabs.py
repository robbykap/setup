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
