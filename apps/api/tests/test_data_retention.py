from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.db import connect, init_db, purge_stale_nexon_api_data


class DataRetentionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.prev_db_path = os.environ.get("HABIT_LAB_DB_PATH")
        os.environ["HABIT_LAB_DB_PATH"] = str(Path(self.tmp.name) / "test.sqlite3")
        init_db()

    def tearDown(self) -> None:
        if self.prev_db_path is None:
            os.environ.pop("HABIT_LAB_DB_PATH", None)
        else:
            os.environ["HABIT_LAB_DB_PATH"] = self.prev_db_path
        self.tmp.cleanup()

    def test_purge_removes_only_stale_nexon_source_data(self) -> None:
        old_at = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
        fresh_at = datetime.now(timezone.utc).isoformat()
        with connect() as conn:
            conn.execute(
                """
                INSERT INTO matches_raw (ouid, match_type, match_id, match_date, payload_json, payload_hash, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("old", 52, "old-match", old_at, "{}", "old-hash", old_at),
            )
            conn.execute(
                """
                INSERT INTO matches_raw (ouid, match_type, match_id, match_date, payload_json, payload_hash, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("fresh", 52, "fresh-match", fresh_at, "{}", "fresh-hash", fresh_at),
            )
            conn.execute(
                "INSERT INTO user_lookup_cache (nickname, ouid, source, updated_at) VALUES (?, ?, ?, ?)",
                ("old-user", "old-ouid", "nexon_open_api", old_at),
            )
            conn.execute(
                "INSERT INTO user_lookup_cache (nickname, ouid, source, updated_at) VALUES (?, ?, ?, ?)",
                ("fresh-user", "fresh-ouid", "nexon_open_api", fresh_at),
            )
            conn.execute(
                """
                INSERT INTO official_rankers (
                  mode, rank_no, nickname, ouid, elo, win_rate, win_count, draw_count, loss_count,
                  formation, team_color, fetched_at, source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ("1vs1", 1, "old-ranker", "old-ranker-ouid", 1000, 0.5, 1, 0, 1, "4-2-2-2", "", old_at, "test"),
            )
            conn.execute(
                """
                INSERT INTO official_rankers (
                  mode, rank_no, nickname, ouid, elo, win_rate, win_count, draw_count, loss_count,
                  formation, team_color, fetched_at, source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ("2vs2", 1, "fresh-ranker", "fresh-ranker-ouid", 1000, 0.5, 1, 0, 1, "4-2-2-2", "", fresh_at, "test"),
            )
            conn.execute(
                """
                INSERT INTO analytics_events (event_name, distinct_id, session_id, path, screen, referrer, properties_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ("page_view", "user", "session", "/", "home", "", "{}", old_at),
            )
            conn.commit()

        summary = purge_stale_nexon_api_data(days=30)

        self.assertEqual(summary["matches_raw"], 1)
        self.assertEqual(summary["user_lookup_cache"], 1)
        self.assertEqual(summary["official_rankers"], 1)
        with connect() as conn:
            counts = {
                "matches_raw": conn.execute("SELECT COUNT(*) FROM matches_raw").fetchone()[0],
                "user_lookup_cache": conn.execute("SELECT COUNT(*) FROM user_lookup_cache").fetchone()[0],
                "official_rankers": conn.execute("SELECT COUNT(*) FROM official_rankers").fetchone()[0],
                "analytics_events": conn.execute("SELECT COUNT(*) FROM analytics_events").fetchone()[0],
            }
        self.assertEqual(counts["matches_raw"], 1)
        self.assertEqual(counts["user_lookup_cache"], 1)
        self.assertEqual(counts["official_rankers"], 1)
        self.assertEqual(counts["analytics_events"], 1)


if __name__ == "__main__":
    unittest.main()
