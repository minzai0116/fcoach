from __future__ import annotations

from datetime import timedelta

BENCHMARKS = {
    50: {
        "win_rate": 0.52,
        "shot_on_target_rate": 0.42,
        "offside_avg": 0.9,
        "late_concede_ratio": 0.30,
        "goals_per_sot": 0.42,
        "in_box_shot_ratio": 0.58,
        "pass_success_rate": 0.83,
        "through_pass_success_rate": 0.31,
        "tackle_success_rate": 0.41,
        "shots_per_match": 7.8,
        "xg_for_per_match": 1.55,
        "goals_against_per_match": 1.20,
        "possession_avg": 50.0,
    },
    60: {
        "win_rate": 0.50,
        "shot_on_target_rate": 0.40,
        "offside_avg": 1.0,
        "late_concede_ratio": 0.33,
        "goals_per_sot": 0.40,
        "in_box_shot_ratio": 0.56,
        "pass_success_rate": 0.81,
        "through_pass_success_rate": 0.29,
        "tackle_success_rate": 0.39,
        "shots_per_match": 7.3,
        "xg_for_per_match": 1.45,
        "goals_against_per_match": 1.28,
        "possession_avg": 50.0,
    },
    52: {
        "win_rate": 0.50,
        "shot_on_target_rate": 0.40,
        "offside_avg": 1.0,
        "late_concede_ratio": 0.33,
        "goals_per_sot": 0.40,
        "in_box_shot_ratio": 0.56,
        "pass_success_rate": 0.81,
        "through_pass_success_rate": 0.29,
        "tackle_success_rate": 0.39,
        "shots_per_match": 7.3,
        "xg_for_per_match": 1.45,
        "goals_against_per_match": 1.28,
        "possession_avg": 50.0,
    },
}

STATIC_BENCHMARK_SOURCE = "ranker_proxy_v1"
OFFICIAL_BENCHMARK_SOURCE = "official_rank_1vs1"
ISSUE_MIN_ACTION_SCORE = 5.0

CONFIDENCE_BASE = 0.35
CONFIDENCE_SAMPLE_WEIGHT = 0.40
CONFIDENCE_SEVERITY_WEIGHT = 0.25
CONFIDENCE_TACTIC_MISSING_PENALTY = 0.90
CONFIDENCE_SAMPLE_FULL_MATCHES = 15.0

SPID_META_URL = "https://open.api.nexon.com/static/fconline/meta/spid.json"
SPPOSITION_META_URL = "https://open.api.nexon.com/static/fconline/meta/spposition.json"
SEASON_META_URL = "https://open.api.nexon.com/static/fconline/meta/seasonid.json"

MATCH_REFRESH_THRESHOLD = timedelta(minutes=15)
MATCH_CACHE_TTL_SEC_DEFAULT = 1800
MATCH_HEAD_PROBE_TTL_SEC = 45
OFFICIAL_RANKER_FALLBACK_CACHE_TTL = timedelta(minutes=5)
