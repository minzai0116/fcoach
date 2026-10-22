from __future__ import annotations

import os
import tempfile
import unittest
from dataclasses import replace
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from app.db import connect, init_db, purge_stale_nexon_api_data
from app.models import AnalysisRunRequest
from app.services.analysis import _extract_user_match, get_latest_analysis, run_analysis
from app.services.analysis_models import MatchStats
from app.services.position_coaching import build_position_coaching


POSITIONS = {0: "GK", 6: "CB", 18: "CAM", 25: "ST", 28: "SUB"}


def sample(position: int = 18, **overrides) -> MatchStats:
    player = {
        "sp_id": 12345, "sp_grade": 5, "sp_position": position, "rating": 6,
        "pass_try": 10, "pass_success": 6, "shots": 2, "effective_shots": 0,
        "tackle_try": 4, "tackle_success": 1, "dribble_try": 5, "dribble_success": 1,
        **overrides,
    }
    return MatchStats(
        match_date="2026-10-06T00:00:00+00:00", result="패", opponent_nickname="상대",
        goals_for=0, goals_against=1, shots=2, shots_on_target=0, offside=0,
        xg_for=.24, xg_against=.3, late_goals_against=0, in_box_shots=1, total_shots_detail=2,
        possession=50, pass_try=10, pass_success=6, through_pass_try=0, through_pass_success=0,
        tackle_try=4, tackle_success=1, shots_for_points=[], goals_for_minutes=[],
        goals_against_minutes=[], goals_for_types=[], player_stats=[player],
    )


def coach(rows, history=None):
    return build_position_coaching(rows, {"players": []}, POSITIONS, history_rows=history)


class PositionCoachingTest(unittest.TestCase):
    def test_rate_precision_matches_the_displayed_success_and_attempt_counts(self):
        result = coach([sample(pass_try=544, pass_success=281)])
        passing = next(m for m in result['players'][0]['measurements'] if m['metric'] == 'pass')
        self.assertEqual(round(passing['value'] * 100, 1), 51.7)

    def test_pitch_lineup_uses_one_latest_selected_match_instead_of_union(self):
        older = replace(sample(18), match_date="2026-10-05T00:00:00+00:00", match_id="old")
        latest = replace(sample(25, sp_id=98765), match_id="latest")
        latest.player_stats += [{**latest.player_stats[0], "sp_position": 28}]
        result = coach([latest, older])
        self.assertEqual(result['latest_lineup']['match_id'], 'latest')
        self.assertEqual(result['latest_lineup']['players'], [{'sp_id': 98765, 'sp_grade': 5, 'sp_position': 25}])
        self.assertEqual(len(result['players']), 2)
        self.assertIsNone(coach([])['latest_lineup'])

    def test_same_player_in_different_positions_is_not_merged(self):
        result = coach([sample(18)] * 5 + [sample(25, pass_success=10, effective_shots=2)] * 5)
        players = {p["position_name"]: p for p in result["players"]}
        self.assertEqual(players["CAM"]["appearances"], 5)
        self.assertEqual(players["ST"]["appearances"], 5)
        self.assertEqual(players["CAM"]["findings"], [])
        self.assertNotIn("pass", [f["metric"] for f in players["ST"]["findings"]])

    def test_rates_weight_attempts_and_keep_zero_attempts_unjudged(self):
        result = coach([sample(pass_try=100, pass_success=80, shots=0)] + [sample(pass_try=1, pass_success=0, shots=0)] * 4)
        metrics = {m["metric"]: m for m in result["players"][0]["measurements"]}
        self.assertAlmostEqual(metrics["pass"]["value"], 80 / 104, places=4)
        self.assertIsNone(metrics["shot"]["value"])
        self.assertEqual(metrics["shot"]["status"], "insufficient")

    def test_forfeits_unused_substitutes_and_duplicates_do_not_inflate_samples(self):
        row = sample()
        row.player_stats += [dict(row.player_stats[0]), {**row.player_stats[0], "sp_position": 28}]
        result = coach([row] * 4 + [replace(sample(), match_end_type=1)])
        self.assertEqual(result["sample_count"], 4)
        self.assertEqual(result["players"][0]["appearances"], 4)
        self.assertEqual(result["players"][0]["findings"], [])

    def test_missing_metrics_are_not_zero_successes(self):
        result = coach([sample(pass_observed=0)] * 10)
        player = result["players"][0]
        metric = next(m for m in player["measurements"] if m["metric"] == "pass")
        self.assertIsNone(metric["value"])
        self.assertNotIn("pass", [f["metric"] for f in player["findings"]])

    def test_raw_missing_status_marks_metric_unavailable(self):
        payload = {"matchInfo": [
            {"ouid": "user", "matchDetail": {"matchEndType": 0}, "player": [
                {"spId": 12345, "spGrade": 5, "spPosition": 18, "status": {"passTry": 10, "spRating": 6}},
            ]}, {"ouid": "other"},
        ]}
        row = _extract_user_match(payload, "user")
        self.assertEqual(row.player_stats[0]["pass_observed"], 0)
        self.assertEqual(coach([row] * 5)["players"][0]["findings"], [])

    def test_nexon_timestamp_keeps_utc_offset_for_browser_display(self):
        payload = {"matchDate": "2026-10-06T02:12:33", "matchInfo": [{"ouid": "user"}, {"ouid": "other"}]}
        self.assertEqual(_extract_user_match(payload, "user").match_date, "2026-10-06T02:12:33+00:00")

    def test_only_observed_match_information_is_exposed(self):
        result = coach([sample()] * 5)
        self.assertNotIn("tactic_slot", result)
        self.assertNotIn("equipment", result["players"][0])
        self.assertEqual(result["players"][0]["findings"], [])
        self.assertTrue(all(m["reference"] is None for m in result["players"][0]["measurements"]))

    def test_small_gap_does_not_trigger_pass_correction(self):
        result = coach([sample(pass_try=100, pass_success=81)] * 5)
        self.assertNotIn("pass", [f["metric"] for f in result["players"][0]["findings"]])

    def test_manager_mode_uses_observation_instead_of_manual_controls(self):
        result = build_position_coaching([sample()] * 5, {"players": []}, POSITIONS, match_type=52)
        self.assertEqual(result["mode"], "observation")
        self.assertTrue(all("직접 조작을 교정하지 않습니다" in f["adjustment"] for f in result["players"][0]["findings"]))

    def test_missing_position_metadata_does_not_invent_midfield_role(self):
        result = build_position_coaching([sample()] * 5, {"players": []}, {})
        self.assertEqual(result["players"][0]["findings"], [])


class CoachingPersistenceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"HABIT_LAB_DB_PATH": str(Path(self.tmp.name) / "test.sqlite3")})
        self.env.start()
        init_db()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    @patch("app.services.analysis._spid_name_map", return_value={12345: "테스트 선수"})
    @patch("app.services.analysis._position_name_map", return_value=POSITIONS)
    @patch("app.services.analysis._season_meta_map", return_value={})
    @patch("app.services.analysis._load_official_rankers", return_value=[])
    @patch("app.services.analysis.build_action_explanation", return_value={})
    @patch("app.services.analysis._load_rows_for_analysis", return_value=([sample()] * 5, 0, None, False))
    def test_run_latest_and_retention_keep_context_consistent(self, *mocks):
        result = run_analysis("test-ouid", 50, 5)
        with patch("app.services.analysis.list_match_stats", return_value=[sample()] * 5):
            latest = get_latest_analysis("test-ouid", 50, 5)
        self.assertEqual(latest["coaching"], result["coaching"])
        old_at = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
        with closing(connect()) as conn, conn:
            conn.execute("UPDATE user_metrics_snapshot SET created_at = ?", (old_at,))
        with patch("app.services.analysis.list_match_stats", return_value=[sample()] * 5):
            self.assertIsNone(get_latest_analysis("test-ouid", 50, 5)["coaching"])
        purge_stale_nexon_api_data()
        with closing(connect()) as conn, conn:
            self.assertIsNone(conn.execute("SELECT coaching_json FROM user_metrics_snapshot").fetchone()[0])

    def test_existing_schema_is_upgraded_idempotently(self):
        with closing(connect()) as conn, conn:
            conn.execute("ALTER TABLE user_metrics_snapshot DROP COLUMN coaching_json")
        init_db()
        init_db()
        with closing(connect()) as conn, conn:
            columns = [r[1] for r in conn.execute("PRAGMA table_info(user_metrics_snapshot)")]
        self.assertEqual(columns.count("coaching_json"), 1)

    def test_busy_analysis_does_not_return_other_tactic_settings(self):
        from app.main import analysis_run
        request = Request({"type": "http", "client": ("127.0.0.1", 1), "headers": []})
        req = AnalysisRunRequest(ouid="test-ouid", match_type=50, window=5, current_tactic={"defense_depth": 6})
        with patch("app.main._enforce_rate_limit"), patch("app.main.cache.acquire_lock", return_value=None), patch("app.main.cache.get_json", return_value={"request_fingerprint": "another-tactic"}):
            with self.assertRaises(HTTPException) as error:
                analysis_run(request, req)
        self.assertEqual(error.exception.status_code, 429)
