from __future__ import annotations

from dataclasses import replace
import unittest

from app.services.analysis import _extract_user_match
from app.services.passing_coaching import PASS_TYPES, build_passing_coaching, extract_pass_breakdown
from tests.test_position_coaching import sample


def passing_row(**pairs):
    breakdown = {key: {"trials": pairs.get(key, (0, 0))[0], "success": pairs.get(key, (0, 0))[1]} for key in PASS_TYPES}
    breakdown["overall"] = {field: sum(item[field] for item in breakdown.values()) for field in ("trials", "success")}
    return replace(sample(), pass_breakdown=breakdown)


class PassingCoachingTest(unittest.TestCase):
    def test_weighted_rates_shares_and_failure_volume_priority(self):
        rows = [passing_row(short=(90, 85), through=(20, 10), long=(10, 2))] * 5
        rows[0] = passing_row(short=(900, 850), through=(200, 100), long=(100, 20))
        result = build_passing_coaching(rows, 60)
        types = {item["metric"]: item for item in result["types"]}
        self.assertEqual(result["overall"]["trials"], 1680)
        self.assertEqual(types["through"]["success_rate"], .5)
        self.assertAlmostEqual(types["through"]["usage_share"], 280 / 1680, places=6)
        self.assertAlmostEqual(types["through"]["failure_share"], 140 / 322, places=6)
        self.assertEqual(types["through"]["loss_per_100_passes"], round(140 / 1680 * 100, 2))
        self.assertEqual(result["priorities"], [])
        self.assertNotIn("short", [item["metric"] for item in result["priorities"]])

    def test_missing_inconsistent_and_forfeit_rows_do_not_mix_denominators(self):
        valid = passing_row(short=(10, 8), long=(5, 1))
        missing = passing_row(short=(1000, 900))
        del missing.pass_breakdown["through"]
        inconsistent = passing_row(short=(1000, 900))
        inconsistent.pass_breakdown["overall"]["success"] = 800
        result = build_passing_coaching([valid] * 5 + [missing, inconsistent, replace(valid, match_end_type=1)], 60)
        self.assertEqual(result["sample_count"], 7)
        self.assertEqual(result["observed_matches"], 5)
        self.assertEqual(result["excluded_matches"], 2)
        self.assertEqual(result["overall"]["trials"], 75)

    def test_rare_low_success_type_is_not_a_correction(self):
        result = build_passing_coaching([passing_row(short=(100, 90), lobbed_through=(1, 0))] * 5, 60)
        item = next(item for item in result["types"] if item["metric"] == "lobbed_through")
        self.assertEqual(item["success_rate"], 0)
        self.assertEqual(item["status"], "insufficient")
        self.assertNotIn("lobbed_through", [item["metric"] for item in result["priorities"]])

    def test_uncategorized_difference_is_retained_without_inventing_type(self):
        row = passing_row(short=(10, 8), long=(5, 1))
        row.pass_breakdown["overall"] = {"trials": 18, "success": 10}
        result = build_passing_coaching([row] * 5, 60)
        self.assertEqual(result["observed_matches"], 5)
        self.assertEqual(result["remainder"], {"trials": 15, "success": 5, "failures": 10})
        self.assertEqual(sum(item["trials"] for item in result["types"]) + result["remainder"]["trials"], result["overall"]["trials"])

    def test_zero_denominators_and_no_failures_are_not_zero_percent(self):
        empty = build_passing_coaching([passing_row()] * 5, 60)
        self.assertIsNone(empty["overall"]["success_rate"])
        self.assertTrue(all(item["usage_share"] is None for item in empty["types"]))
        perfect = build_passing_coaching([passing_row(short=(100, 100))] * 5, 60)
        self.assertTrue(all(item["failure_share"] is None for item in perfect["types"]))
        self.assertEqual(perfect["priorities"], [])

    def test_extraction_rejects_missing_invalid_and_impossible_counts(self):
        values = {"passTry": 10, "passSuccess": 8, "shortPassTry": 5,
                  "longPassTry": 2, "longPassSuccess": 3, "throughPassTry": True, "throughPassSuccess": 0,
                  "lobbedThroughPassTry": 3, "lobbedThroughPassSuccess": float("nan")}
        self.assertEqual(extract_pass_breakdown(values), {"overall": {"trials": 10, "success": 8}})

    def test_raw_team_types_are_never_attributed_to_individual_player(self):
        payload = {"matchInfo": [{"ouid": "user", "matchDetail": {"matchEndType": 0},
                    "pass": {"passTry": 100, "passSuccess": 90, "throughPassTry": 20, "throughPassSuccess": 15},
                    "player": [{"spId": 12345, "spPosition": 18, "spGrade": 5, "status": {"passTry": 10, "passSuccess": 6}}]},
                   {"ouid": "other"}]}
        row = _extract_user_match(payload, "user")
        self.assertEqual(row.pass_breakdown["through"]["success"], 15)
        self.assertNotIn("through", row.player_stats[0])
        self.assertEqual(row.player_stats[0]["pass_success"], 6)

    def test_manager_mode_does_not_offer_manual_pass_actions(self):
        result = build_passing_coaching([passing_row(short=(100, 90), through=(20, 5))] * 5, 52,
            history_rows=[replace(passing_row(short=(100, 90), through=(20, 20)), match_date="2026-10-05T00:00:00Z")] * 5)
        self.assertTrue(result["priorities"])
        self.assertTrue(all("직접 조작을 교정하지 않습니다" in item["adjustment"] for item in result["priorities"]))


if __name__ == "__main__":
    unittest.main()
