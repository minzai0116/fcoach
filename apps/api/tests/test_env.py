import os
import tempfile
import unittest
from pathlib import Path

from app.env import load_local_env


class EnvLoaderTest(unittest.TestCase):
    def test_load_local_env_reads_cwd_env_file(self) -> None:
        key = "HABIT_LAB_TEST_ENV_KEY"
        previous = os.environ.pop(key, None)

        with tempfile.TemporaryDirectory() as tmp_dir:
            env_path = Path(tmp_dir) / ".env"
            env_path.write_text(f"{key}=loaded-from-temp\n", encoding="utf-8")
            previous_cwd = os.getcwd()
            try:
                os.chdir(tmp_dir)
                load_local_env(force=True)
                self.assertEqual(os.environ.get(key), "loaded-from-temp")
            finally:
                os.chdir(previous_cwd)
                if previous is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = previous
