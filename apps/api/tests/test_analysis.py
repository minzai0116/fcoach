import unittest

from app.services.analysis import MatchStats, _compute_metrics, _issue_scores, _player_report_summary


def _sample_match(result: str, goals_for: float, goals_against: float, late_concede: float, shots: float, sot: float) -> MatchStats:
    return MatchStats(
        match_date="2026-03-01T12:00:00+00:00",
        result=result,
        opponent_nickname="상대",
        goals_for=goals_for,
        goals_against=goals_against,
        shots=shots,
        shots_on_target=sot,
        offside=1.0,
        xg_for=goals_for + 0.4,
        xg_against=goals_against + 0.2,
        late_goals_against=late_concede,
        in_box_shots=max(0.0, shots - 1.0),
        total_shots_detail=shots,
        possession=50.0,
        pass_try=120.0,
        pass_success=100.0,
        through_pass_try=12.0,
        through_pass_success=4.0,
        tackle_try=18.0,
        tackle_success=8.0,
        shots_for_points=[{"x": 0.9, "y": 0.5, "is_goal": bool(goals_for > 0)}],
        goals_for_minutes=[12.0] if goals_for > 0 else [],
        goals_against_minutes=[70.0] if goals_against > 0 else [],
        goals_for_types=[1] if goals_for > 0 else [],
    )


class AnalysisTest(unittest.TestCase):
    def test_compute_metrics_window(self) -> None:
        rows = [
            _sample_match("승", 2, 1, 1, 8, 4),
            _sample_match("패", 0, 2, 1, 4, 1),
        ]
        metrics = _compute_metrics(rows)
        self.assertEqual(metrics["match_count"], 2.0)
        self.assertEqual(metrics["win_rate"], 0.5)
        self.assertAlmostEqual(metrics["shot_on_target_rate"], 5 / 12, places=4)

    def test_issue_scores_non_negative(self) -> None:
        metrics = {
            "match_count": 10.0,
            "late_concede_ratio": 0.45,
            "shot_on_target_rate": 0.25,
            "goals_per_sot": 0.22,
            "in_box_shot_ratio": 0.34,
            "offside_avg": 1.8,
        }
        benchmark = {
            "late_concede_ratio": 0.3,
            "shot_on_target_rate": 0.4,
            "goals_per_sot": 0.4,
            "in_box_shot_ratio": 0.56,
            "pass_success_rate": 0.81,
            "through_pass_success_rate": 0.29,
            "tackle_success_rate": 0.39,
            "shots_per_match": 7.3,
            "xg_for_per_match": 1.45,
            "goals_against_per_match": 1.28,
            "possession_avg": 50.0,
            "offside_avg": 1.0,
        }
        issues = _issue_scores(metrics, benchmark)
        self.assertTrue(all(score >= 0 for score in issues.values()))
        self.assertLessEqual(len(issues), 4)
        self.assertGreater(sum(1 for score in issues.values() if score > 0), 0)

    def test_issue_scores_with_no_matches(self) -> None:
        metrics = {
            "match_count": 0.0,
            "late_concede_ratio": 0.0,
            "shot_on_target_rate": 0.0,
            "goals_per_sot": 0.0,
            "in_box_shot_ratio": 0.0,
            "offside_avg": 0.0,
        }
        benchmark = {
            "late_concede_ratio": 0.3,
            "shot_on_target_rate": 0.4,
            "goals_per_sot": 0.4,
            "in_box_shot_ratio": 0.56,
            "pass_success_rate": 0.81,
            "through_pass_success_rate": 0.29,
            "tackle_success_rate": 0.39,
            "shots_per_match": 7.3,
            "xg_for_per_match": 1.45,
            "goals_against_per_match": 1.28,
            "possession_avg": 50.0,
            "offside_avg": 1.0,
        }
        issues = _issue_scores(metrics, benchmark)
        self.assertEqual(issues.get("MAINTAIN_PERFORMANCE"), 0.0)

    def test_player_report_summary_aggregates(self) -> None:
        rows = [
            MatchStats(
                match_date="2026-03-01T12:00:00+00:00",
                result="승",
                opponent_nickname="상대A",
                goals_for=2,
                goals_against=1,
                shots=8,
                shots_on_target=4,
                offside=1,
                xg_for=1.6,
                xg_against=1.2,
                late_goals_against=0,
                in_box_shots=6,
                total_shots_detail=8,
                possession=52,
                pass_try=120,
                pass_success=103,
                through_pass_try=14,
                through_pass_success=5,
                tackle_try=18,
                tackle_success=8,
                shots_for_points=[],
                goals_for_minutes=[],
                goals_against_minutes=[],
                goals_for_types=[],
                player_stats=[
                    {
                        "sp_id": 100000041,
                        "sp_position": 21,
                        "goals": 1,
                        "assists": 1,
                        "shots": 4,
                        "effective_shots": 2,
                        "pass_try": 20,
                        "pass_success": 16,
                        "tackle_try": 2,
                        "tackle_success": 1,
                        "rating": 7.2,
                    }
                ],
            ),
            MatchStats(
                match_date="2026-03-02T12:00:00+00:00",
                result="무",
                opponent_nickname="상대B",
                goals_for=1,
                goals_against=1,
                shots=7,
                shots_on_target=3,
                offside=0,
                xg_for=1.4,
                xg_against=1.0,
                late_goals_against=1,
                in_box_shots=5,
                total_shots_detail=7,
                possession=49,
                pass_try=110,
                pass_success=95,
                through_pass_try=12,
                through_pass_success=4,
                tackle_try=16,
                tackle_success=7,
                shots_for_points=[],
                goals_for_minutes=[],
                goals_against_minutes=[],
                goals_for_types=[],
                player_stats=[
                    {
                        "sp_id": 100000041,
                        "sp_position": 21,
                        "goals": 1,
                        "assists": 0,
                        "shots": 3,
                        "effective_shots": 1,
                        "pass_try": 18,
                        "pass_success": 15,
                        "tackle_try": 1,
                        "tackle_success": 0,
                        "rating": 7.0,
                    }
                ],
            ),
        ]
        report = _player_report_summary(rows)
        self.assertEqual(report["sample_matches"], 2)
        self.assertEqual(report["player_count"], 1)
        first = report["players"][0]
        self.assertEqual(first["sp_id"], 100000041)
        self.assertEqual(first["appearances"], 2)
        self.assertEqual(first["goals"], 2.0)
        self.assertAlmostEqual(first["pass_success_rate"], 31 / 38, places=4)
        self.assertEqual(first["role_group"], "ATT")
        self.assertEqual(first["impact_model"], "role_weighted_v2")
        self.assertGreaterEqual(first["impact_score"], 0.0)
        self.assertLessEqual(first["impact_score"], 100.0)

    def test_player_report_summary_role_weighted_score(self) -> None:
        rows = [
            MatchStats(
                match_date="2026-03-01T12:00:00+00:00",
                result="승",
                opponent_nickname="상대A",
                goals_for=2,
                goals_against=1,
                shots=9,
                shots_on_target=5,
                offside=1,
                xg_for=1.8,
                xg_against=1.1,
                late_goals_against=0,
                in_box_shots=7,
                total_shots_detail=9,
                possession=53,
                pass_try=128,
                pass_success=108,
                through_pass_try=16,
                through_pass_success=6,
                tackle_try=19,
                tackle_success=8,
                shots_for_points=[],
                goals_for_minutes=[],
                goals_against_minutes=[],
                goals_for_types=[],
                player_stats=[
                    {
                        "sp_id": 100000041,
                        "sp_position": 25,  # ST
                        "goals": 1,
                        "assists": 0,
                        "shots": 4,
                        "effective_shots": 2,
                        "pass_try": 14,
                        "pass_success": 10,
                        "tackle_try": 1,
                        "tackle_success": 0,
                        "rating": 7.1,
                    },
                    {
                        "sp_id": 100000999,
                        "sp_position": 6,  # LCB
                        "goals": 0,
                        "assists": 0,
                        "shots": 0,
                        "effective_shots": 0,
                        "pass_try": 26,
                        "pass_success": 24,
                        "tackle_try": 6,
                        "tackle_success": 5,
                        "rating": 7.0,
                    },
                ],
            ),
            MatchStats(
                match_date="2026-03-02T12:00:00+00:00",
                result="무",
                opponent_nickname="상대B",
                goals_for=1,
                goals_against=1,
                shots=6,
                shots_on_target=3,
                offside=0,
                xg_for=1.1,
                xg_against=1.0,
                late_goals_against=0,
                in_box_shots=4,
                total_shots_detail=6,
                possession=48,
                pass_try=112,
                pass_success=95,
                through_pass_try=13,
                through_pass_success=4,
                tackle_try=18,
                tackle_success=8,
                shots_for_points=[],
                goals_for_minutes=[],
                goals_against_minutes=[],
                goals_for_types=[],
                player_stats=[
                    {
                        "sp_id": 100000041,
                        "sp_position": 25,  # ST
                        "goals": 0,
                        "assists": 1,
                        "shots": 2,
                        "effective_shots": 1,
                        "pass_try": 12,
                        "pass_success": 9,
                        "tackle_try": 0,
                        "tackle_success": 0,
                        "rating": 6.9,
                    },
                    {
                        "sp_id": 100000999,
                        "sp_position": 6,  # LCB
                        "goals": 0,
                        "assists": 0,
                        "shots": 0,
                        "effective_shots": 0,
                        "pass_try": 23,
                        "pass_success": 21,
                        "tackle_try": 7,
                        "tackle_success": 5,
                        "rating": 7.2,
                    },
                ],
            ),
        ]
        report = _player_report_summary(rows)
        entries = {item["sp_id"]: item for item in report["players"]}
        st = entries[100000041]
        cb = entries[100000999]
        self.assertEqual(st["role_group"], "ATT")
        self.assertEqual(cb["role_group"], "DEF")
        self.assertGreater(st["impact_score"], 0.0)
        self.assertGreater(cb["impact_score"], 0.0)
        self.assertGreaterEqual(st["impact_confidence"], 0.35)
        self.assertGreaterEqual(cb["impact_confidence"], 0.35)

if __name__ == "__main__":
    unittest.main()
