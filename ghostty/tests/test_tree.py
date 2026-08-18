import os
import tempfile
import unittest
from pathlib import Path

from gwsidebar import tree


class TestListing(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / "src").mkdir()
        (self.root / "src" / "app.py").write_text("")
        (self.root / ".git").mkdir()
        (self.root / ".env").write_text("")
        (self.root / "README.md").write_text("")

    def test_directories_sort_before_files(self):
        names = [p.name for p in tree.list_dir(self.root, show_hidden=False)]
        self.assertEqual(names, ["src", "README.md"])

    def test_hidden_files_excluded_by_default(self):
        names = [p.name for p in tree.list_dir(self.root, show_hidden=False)]
        self.assertNotIn(".env", names)

    def test_hidden_files_included_when_requested(self):
        names = [p.name for p in tree.list_dir(self.root, show_hidden=True)]
        self.assertIn(".env", names)

    def test_git_directory_always_skipped(self):
        names = [p.name for p in tree.list_dir(self.root, show_hidden=True)]
        self.assertNotIn(".git", names)

    def test_unreadable_directory_returns_empty(self):
        self.assertEqual(tree.list_dir(self.root / "nope", show_hidden=False), [])


class TestFlatten(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / "src").mkdir()
        (self.root / "src" / "app.py").write_text("")
        (self.root / "README.md").write_text("")

    def test_collapsed_directory_hides_children(self):
        nodes = tree.flatten(self.root, expanded=set(), show_hidden=False)
        self.assertEqual([n.name for n in nodes], ["src", "README.md"])

    def test_expanded_directory_shows_children_with_depth(self):
        nodes = tree.flatten(self.root, expanded={str(self.root / "src")}, show_hidden=False)
        self.assertEqual([n.name for n in nodes], ["src", "app.py", "README.md"])
        self.assertEqual(nodes[1].depth, 1)
        self.assertTrue(nodes[0].is_dir)
        self.assertFalse(nodes[1].is_dir)

    def test_nodes_carry_absolute_paths(self):
        nodes = tree.flatten(self.root, expanded=set(), show_hidden=False)
        self.assertTrue(os.path.isabs(nodes[0].path))


class TestCursorMath(unittest.TestCase):
    def test_move_clamps_at_top(self):
        self.assertEqual(tree.move_cursor(0, -1, total=5), 0)

    def test_move_clamps_at_bottom(self):
        self.assertEqual(tree.move_cursor(4, 1, total=5), 4)

    def test_move_within_range(self):
        self.assertEqual(tree.move_cursor(2, 1, total=5), 3)

    def test_empty_list_pins_cursor_to_zero(self):
        self.assertEqual(tree.move_cursor(3, 1, total=0), 0)


class TestScrollMath(unittest.TestCase):
    def test_cursor_above_window_scrolls_up(self):
        self.assertEqual(tree.clamp_scroll(cursor=2, scroll=5, height=4, total=20), 2)

    def test_cursor_below_window_scrolls_down(self):
        self.assertEqual(tree.clamp_scroll(cursor=9, scroll=0, height=4, total=20), 6)

    def test_cursor_inside_window_leaves_scroll_alone(self):
        self.assertEqual(tree.clamp_scroll(cursor=3, scroll=2, height=4, total=20), 2)

    def test_scroll_never_exceeds_last_page(self):
        self.assertEqual(tree.clamp_scroll(cursor=19, scroll=18, height=10, total=20), 10)

    def test_short_list_never_scrolls(self):
        self.assertEqual(tree.clamp_scroll(cursor=1, scroll=0, height=10, total=3), 0)

    def test_zero_height_is_safe(self):
        self.assertEqual(tree.clamp_scroll(cursor=5, scroll=3, height=0, total=20), 0)


class TestExpansion(unittest.TestCase):
    def test_toggle_adds_then_removes(self):
        self.assertEqual(tree.toggle(set(), "/a"), {"/a"})
        self.assertEqual(tree.toggle({"/a"}, "/a"), set())

    def test_toggle_does_not_mutate_input(self):
        original = {"/a"}
        tree.toggle(original, "/b")
        self.assertEqual(original, {"/a"})

    def test_parent_index_finds_enclosing_directory(self):
        nodes = [
            tree.Node(path="/r/src", name="src", is_dir=True, depth=0),
            tree.Node(path="/r/src/app.py", name="app.py", is_dir=False, depth=1),
        ]
        self.assertEqual(tree.parent_index(nodes, 1), 0)

    def test_parent_index_at_top_level_returns_same_row(self):
        nodes = [tree.Node(path="/r/src", name="src", is_dir=True, depth=0)]
        self.assertEqual(tree.parent_index(nodes, 0), 0)

    def test_parent_index_empty_list_returns_zero(self):
        self.assertEqual(tree.parent_index([], 3), 0)


if __name__ == "__main__":
    unittest.main()
