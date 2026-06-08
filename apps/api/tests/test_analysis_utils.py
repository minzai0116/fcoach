import unittest

from app.services.analysis_utils import is_truthy


class AnalysisUtilsTest(unittest.TestCase):
    def test_is_truthy_accepts_api_booleans_and_env_strings(self) -> None:
        self.assertTrue(is_truthy(True))
        self.assertFalse(is_truthy(False))
        self.assertTrue(is_truthy("true"))
        self.assertTrue(is_truthy("1"))
        self.assertFalse(is_truthy("0"))


if __name__ == "__main__":
    unittest.main()
