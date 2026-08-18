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


if __name__ == "__main__":
    unittest.main()
