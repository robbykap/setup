import unittest


class TestScaffold(unittest.TestCase):
    def test_package_imports(self):
        import gwsidebar

        self.assertTrue(hasattr(gwsidebar, "__version__"))


if __name__ == "__main__":
    unittest.main()
