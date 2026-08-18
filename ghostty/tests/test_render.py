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


from gwsidebar import tabs as tabmod
from gwsidebar import tree as treemod


def tab(index=1, name="nvim", active=False, panes=1, zoomed=False, bell=False):
    return tabmod.Tab(index=index, name=name, active=active, panes=panes, zoomed=zoomed, bell=bell)


def node(path="/r/src", name="src", is_dir=True, depth=0):
    return treemod.Node(path=path, name=name, is_dir=is_dir, depth=depth)


class TestTabLine(unittest.TestCase):
    def test_inactive_tab_has_no_marker(self):
        line = render.tab_line(tab(), width=20, color=False)
        self.assertEqual(line.rstrip(), " 1   nvim")
        self.assertEqual(len(line), 20)
        self.assertNotIn("●", line)

    def test_active_tab_shows_marker(self):
        self.assertIn("●", render.tab_line(tab(active=True), width=20, color=False))

    def test_pane_count_shown_only_when_more_than_one(self):
        self.assertIn("2p", render.tab_line(tab(panes=2), width=20, color=False))
        self.assertNotIn("1p", render.tab_line(tab(panes=1), width=20, color=False))

    def test_zoom_and_bell_markers(self):
        line = render.tab_line(tab(zoomed=True, bell=True), width=20, color=False)
        self.assertIn("Z", line)
        self.assertIn("!", line)

    def test_active_tab_reversed_with_color(self):
        line = render.tab_line(tab(active=True), width=20, color=True)
        self.assertTrue(line.startswith(render.REVERSE))
        self.assertTrue(line.endswith(render.RESET))


class TestTreeLine(unittest.TestCase):
    def test_collapsed_directory_glyph(self):
        self.assertTrue(render.tree_line(node(), False, set(), width=20, color=False).startswith("▸ src"))

    def test_expanded_directory_glyph(self):
        line = render.tree_line(node(), False, {"/r/src"}, width=20, color=False)
        self.assertTrue(line.startswith("▾ src"))

    def test_file_has_no_glyph(self):
        line = render.tree_line(node(path="/r/a.py", name="a.py", is_dir=False), False, set(), width=20, color=False)
        self.assertTrue(line.startswith("  a.py"))

    def test_depth_indents_two_spaces_per_level(self):
        line = render.tree_line(node(depth=2, is_dir=False, name="a.py"), False, set(), width=20, color=False)
        self.assertTrue(line.startswith("      a.py"))

    def test_selected_row_reversed_with_color(self):
        line = render.tree_line(node(), True, set(), width=20, color=True)
        self.assertTrue(line.startswith(render.REVERSE))


class TestFrame(unittest.TestCase):
    def test_tabs_frame_snapshot(self):
        lines = render.frame(
            "tabs", height=6, tabs=[tab(active=True), tab(index=2, name="server")], width=20, color=False
        )
        self.assertEqual(len(lines), 4)
        self.assertEqual(lines[0], " TABS │ FILES ")
        self.assertEqual(lines[1], "─" * 20)
        self.assertEqual(lines[2].rstrip(), " 1 ● nvim")
        self.assertEqual(lines[3].rstrip(), " 2   server")
        self.assertTrue(all(len(line) == 20 for line in lines[2:]))

    def test_tree_frame_snapshot(self):
        nodes = [node(), node(path="/r/src/a.py", name="a.py", is_dir=False, depth=1)]
        lines = render.frame(
            "files", height=6, nodes=nodes, cursor=1, scroll=0, expanded={"/r/src"}, width=20, color=False
        )
        self.assertEqual(len(lines), 4)
        self.assertEqual(lines[0], " TABS │ FILES ")
        self.assertEqual(lines[2].rstrip(), "▾ src")
        self.assertEqual(lines[3].rstrip(), "    a.py")
        self.assertTrue(all(len(line) == 20 for line in lines[2:]))

    def test_frame_body_respects_height(self):
        many = [tab(index=i, name=f"w{i}") for i in range(10)]
        lines = render.frame("tabs", height=5, tabs=many, width=20, color=False)
        self.assertEqual(len(lines), 5)

    def test_empty_tree_shows_placeholder(self):
        lines = render.frame("files", height=6, nodes=[], cursor=0, scroll=0, expanded=set(), width=20, color=False)
        self.assertIn("(empty)", lines[2])

    def test_scrolled_tree_starts_at_offset(self):
        nodes = [node(path=f"/r/f{i}", name=f"f{i}", is_dir=False, depth=0) for i in range(10)]
        lines = render.frame(
            "files", height=5, nodes=nodes, cursor=5, scroll=4, expanded=set(), width=20, color=False
        )
        self.assertIn("f4", lines[2])


if __name__ == "__main__":
    unittest.main()
