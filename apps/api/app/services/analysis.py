from __future__ import annotations

import json
import math
import os
import unicodedata
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Iterable

import requests

from app.db import connect, upsert_matches, utc_now_iso
from app.services.action_explainer import build_action_explanation
from app.services.cache import CacheClient
from app.services.openapi_client import NexonOpenApiClient, OpenApiRateLimitError
from app.services.ranker_source import fetch_official_rankers, list_official_rankers


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
_MATCH_CACHE = CacheClient()
_OFFICIAL_RANKER_FALLBACK_CACHE_AT: datetime | None = None
_OFFICIAL_RANKER_FALLBACK_CACHE_ROWS: list[dict[str, Any]] = []
_OFFICIAL_RANKER_FALLBACK_CACHE_TTL = timedelta(minutes=5)


def _is_truthy(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _match_cache_ttl_sec() -> int:
    raw = os.getenv("HABIT_LAB_MATCH_CACHE_TTL_SEC", str(MATCH_CACHE_TTL_SEC_DEFAULT)).strip()
    try:
        return max(120, min(86_400, int(raw)))
    except Exception:
        return MATCH_CACHE_TTL_SEC_DEFAULT


def _match_cache_key(ouid: str, match_type: int) -> str:
    return f"matches_raw:{ouid}:{int(match_type)}"


def _normalize_nickname(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value or "")
    return normalized.replace("\u200b", "").replace("\ufeff", "").strip().lower()


def _load_official_rankers(limit: int = 80) -> list[dict[str, Any]]:
    global _OFFICIAL_RANKER_FALLBACK_CACHE_AT, _OFFICIAL_RANKER_FALLBACK_CACHE_ROWS
    safe_limit = max(1, min(100, int(limit)))
    try:
        rows = list_official_rankers(mode="1vs1", limit=safe_limit)
    except Exception:
        rows = []
    if rows:
        return rows

    now = datetime.now(timezone.utc)
    if (
        _OFFICIAL_RANKER_FALLBACK_CACHE_AT is not None
        and now - _OFFICIAL_RANKER_FALLBACK_CACHE_AT <= _OFFICIAL_RANKER_FALLBACK_CACHE_TTL
        and _OFFICIAL_RANKER_FALLBACK_CACHE_ROWS
    ):
        return _OFFICIAL_RANKER_FALLBACK_CACHE_ROWS[:safe_limit]

    try:
        fetched = fetch_official_rankers(mode="1vs1", pages=1, timeout_sec=12)[:safe_limit]
    except Exception:
        return []

    fetched_at = now.isoformat()
    fallback_rows = [
        {
            "mode": "1vs1",
            "rank_no": int(row.get("rank_no", 0)),
            "nickname": str(row.get("nickname", "")),
            "ouid": None,
            "elo": float(row.get("elo", 0.0)),
            "win_rate": float(row.get("win_rate", 0.0)),
            "win_count": int(row.get("win_count", 0)),
            "draw_count": int(row.get("draw_count", 0)),
            "loss_count": int(row.get("loss_count", 0)),
            "formation": str(row.get("formation", "")),
            "team_color": str(row.get("team_color", "")),
            "fetched_at": fetched_at,
            "source": "fconline_datacenter_live",
        }
        for row in fetched
    ]
    _OFFICIAL_RANKER_FALLBACK_CACHE_AT = now
    _OFFICIAL_RANKER_FALLBACK_CACHE_ROWS = fallback_rows
    return fallback_rows[:safe_limit]


@dataclass
class MatchStats:
    match_date: str
    result: str
    opponent_nickname: str
    goals_for: float
    goals_against: float
    shots: float
    shots_on_target: float
    offside: float
    xg_for: float
    xg_against: float
    late_goals_against: float
    in_box_shots: float
    total_shots_detail: float
    possession: float
    pass_try: float
    pass_success: float
    through_pass_try: float
    through_pass_success: float
    tackle_try: float
    tackle_success: float
    shots_for_points: list[dict[str, float | bool]]
    goals_for_minutes: list[float]
    goals_against_minutes: list[float]
    goals_for_types: list[int]
    shots_on_target_against: float = 0.0
    goals_heading: float = 0.0
    goals_freekick: float = 0.0
    goals_penaltykick: float = 0.0
    goals_in_penalty: float = 0.0
    goals_out_penalty: float = 0.0
    controller: str = ""
    player_stats: list[dict[str, float | int]] = field(default_factory=list)


def _sync_fetch_limits(window_size: int, has_cached_rows: bool) -> list[int]:
    if has_cached_rows:
        return [max(window_size, 12)]
    # Cold-start 환경(예: 서버리스 새 인스턴스)에서는 작은 배치부터 시도해 429 가능성을 낮춘다.
    primary = min(12, max(5, window_size))
    return [primary, 5]


def _safe_get_json(url: str) -> Any:
    try:
        response = requests.get(url, timeout=5)
        if response.status_code != 200:
            return None
        return response.json()
    except Exception:
        return None


@lru_cache(maxsize=1)
def _spid_name_map() -> dict[int, str]:
    payload = _safe_get_json(SPID_META_URL)
    if not isinstance(payload, list):
        return {}
    mapping: dict[int, str] = {}
    for row in payload:
        if not isinstance(row, dict):
            continue
        spid = _to_int(row.get("id"))
        name = str(row.get("name", "")).strip()
        if spid is None or not name:
            continue
        mapping[spid] = name
    return mapping


@lru_cache(maxsize=1)
def _position_name_map() -> dict[int, str]:
    payload = _safe_get_json(SPPOSITION_META_URL)
    if not isinstance(payload, list):
        return {}
    mapping: dict[int, str] = {}
    for row in payload:
        if not isinstance(row, dict):
            continue
        pos = _to_int(row.get("spposition"))
        desc = str(row.get("desc", "")).strip()
        if pos is None or not desc:
            continue
        mapping[pos] = desc
    return mapping


@lru_cache(maxsize=1)
def _season_meta_map() -> dict[int, dict[str, str]]:
    payload = _safe_get_json(SEASON_META_URL)
    if not isinstance(payload, list):
        return {}
    mapping: dict[int, dict[str, str]] = {}
    for row in payload:
        if not isinstance(row, dict):
            continue
        season_id = _to_int(row.get("seasonId"))
        name = str(row.get("className", "")).strip() or f"시즌 {season_id}"
        image = str(row.get("seasonImg", "")).strip()
        if season_id is None or not name:
            continue
        mapping[season_id] = {"name": name, "image": image}
    return mapping


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _clamp_tactic_1_10(value: Any, fallback: int) -> int:
    try:
        numeric = int(value)
    except Exception:
        numeric = fallback
    return max(1, min(10, numeric))


def _goal_time_to_minute(raw_value: Any) -> float:
    try:
        value = int(float(raw_value))
    except Exception:
        return 0.0
    if value <= 0:
        return 0.0
    second_half_marker = 1 << 24
    second_half_offset = 0
    if value >= second_half_marker:
        value -= second_half_marker
        second_half_offset = 45
    minute_in_half = value // 100 if value >= 100 else value
    minute_in_half = max(0, minute_in_half)
    # FC Online goalTime can be logged in a compressed half-time scale (0~30).
    # Expand to football minute scale (0~45) so late-game buckets are visible.
    if minute_in_half <= 30:
        expanded_minute = minute_in_half * 1.5
    else:
        expanded_minute = float(minute_in_half)
    return float(second_half_offset + expanded_minute)


def _normalize_xy(x_value: Any, y_value: Any) -> tuple[float, float]:
    x = _to_float(x_value)
    y = _to_float(y_value)
    if x > 1.5 or y > 1.5:
        x /= 100.0
        y /= 100.0
    x = max(0.0, min(1.0, x))
    y = max(0.0, min(1.0, y))
    return x, y


def _is_in_box(x_value: float, y_value: float) -> bool:
    # The API can return either normalized (0-1) or percent-like coordinates.
    if x_value > 1.5 or y_value > 1.5:
        return x_value >= 83 and 18 <= y_value <= 82
    return x_value >= 0.83 and 0.18 <= y_value <= 0.82


def _to_int(value: Any) -> int | None:
    try:
        return int(value)
    except Exception:
        return None


def _parse_iso_datetime(value: str) -> datetime | None:
    text = value.strip()
    if not text:
        return None
    try:
        normalized = text.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _player_image_urls(sp_id: int) -> dict[str, str]:
    pid = sp_id % 1_000_000
    return {
        "face_img": f"https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/players/p{pid}.png",
        "action_img": f"https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/playersAction/p{sp_id}.png",
        "fallback_img": "https://ssl.nexon.com/s2/game/fc/mobile/squadMaker/default/d_player.png",
    }


def _extract_user_match(payload: dict[str, Any], ouid: str) -> MatchStats | None:
    match_info = payload.get("matchInfo")
    if not isinstance(match_info, list):
        return None

    user = None
    opp = None
    for item in match_info:
        if not isinstance(item, dict):
            continue
        if str(item.get("ouid", "")) == ouid:
            user = item
        else:
            opp = item
    if user is None or opp is None:
        return None

    user_detail = user.get("matchDetail", {}) if isinstance(user.get("matchDetail"), dict) else {}
    opp_detail = opp.get("matchDetail", {}) if isinstance(opp.get("matchDetail"), dict) else {}
    user_shoot = user.get("shoot", {}) if isinstance(user.get("shoot"), dict) else {}
    opp_shoot = opp.get("shoot", {}) if isinstance(opp.get("shoot"), dict) else {}
    user_pass = user.get("pass", {}) if isinstance(user.get("pass"), dict) else {}
    user_defence = user.get("defence", {}) if isinstance(user.get("defence"), dict) else {}

    result = str(user_detail.get("matchResult", ""))
    goals_for = _to_float(user_shoot.get("goalTotal"))
    goals_against = _to_float(opp_shoot.get("goalTotal"))
    shots = _to_float(user_shoot.get("shootTotal"))
    shots_on_target = _to_float(user_shoot.get("effectiveShootTotal"))
    offside = _to_float(user_detail.get("offsideCount"))

    user_shot_detail = user.get("shootDetail") if isinstance(user.get("shootDetail"), list) else []
    opp_shot_detail = opp.get("shootDetail") if isinstance(opp.get("shootDetail"), list) else []
    user_players = user.get("player") if isinstance(user.get("player"), list) else []

    in_box_shots = 0.0
    total_shots_detail = 0.0
    shots_for_points: list[dict[str, float | bool]] = []
    goals_for_minutes: list[float] = []
    goals_for_types: list[int] = []
    for shot in user_shot_detail:
        if not isinstance(shot, dict):
            continue
        total_shots_detail += 1
        shot_x = _to_float(shot.get("x"))
        shot_y = _to_float(shot.get("y"))
        if _is_in_box(shot_x, shot_y):
            in_box_shots += 1
        norm_x, norm_y = _normalize_xy(shot.get("x"), shot.get("y"))
        is_goal = _to_float(shot.get("result")) == 3 or str(shot.get("spResult", "")) in {"goal", "3"}
        shots_for_points.append({"x": norm_x, "y": norm_y, "is_goal": bool(is_goal)})
        if is_goal:
            goals_for_minutes.append(_goal_time_to_minute(shot.get("goalTime")))
            shot_type = _to_int(shot.get("type"))
            if shot_type is not None:
                goals_for_types.append(shot_type)

    late_goals_against = 0.0
    goals_against_minutes: list[float] = []
    for shot in opp_shot_detail:
        if not isinstance(shot, dict):
            continue
        is_goal = _to_float(shot.get("result")) == 3 or str(shot.get("spResult", "")) in {"goal", "3"}
        if not is_goal:
            continue
        goal_time = _goal_time_to_minute(shot.get("goalTime"))
        goals_against_minutes.append(goal_time)
        if goal_time >= 60:
            late_goals_against += 1

    xg_for = shots * 0.12 + shots_on_target * 0.20
    xg_against = _to_float(opp_shoot.get("shootTotal")) * 0.12 + _to_float(opp_shoot.get("effectiveShootTotal")) * 0.20

    player_stats: list[dict[str, float | int]] = []
    for player in user_players:
        if not isinstance(player, dict):
            continue
        status = player.get("status") if isinstance(player.get("status"), dict) else {}
        sp_id = _to_int(player.get("spId"))
        sp_position = _to_int(player.get("spPosition"))
        if sp_id is None or sp_position is None:
            continue
        player_stats.append(
            {
                "sp_id": int(sp_id),
                "sp_position": int(sp_position),
                "sp_grade": _to_float(player.get("spGrade")),
                "goals": _to_float(status.get("goal")),
                "assists": _to_float(status.get("assist")),
                "shots": _to_float(status.get("shoot")),
                "effective_shots": _to_float(status.get("effectiveShoot")),
                "pass_try": _to_float(status.get("passTry")),
                "pass_success": _to_float(status.get("passSuccess")),
                "tackle_try": _to_float(status.get("tackleTry")),
                "tackle_success": _to_float(status.get("tackle")),
                "intercept": _to_float(status.get("intercept")),
                "block_try": _to_float(status.get("blockTry")),
                "block_success": _to_float(status.get("block")),
                "dribble_try": _to_float(status.get("dribbleTry")),
                "dribble_success": _to_float(status.get("dribbleSuccess")),
                "defending_actions": _to_float(status.get("defending")),
                "rating": _to_float(status.get("spRating")),
            }
        )

    return MatchStats(
        match_date=str(payload.get("matchDate", utc_now_iso())),
        result=result,
        opponent_nickname=str(opp.get("nickname", "")).strip(),
        goals_for=goals_for,
        goals_against=goals_against,
        shots=shots,
        shots_on_target=shots_on_target,
        offside=offside,
        xg_for=xg_for,
        xg_against=xg_against,
        late_goals_against=late_goals_against,
        in_box_shots=in_box_shots,
        total_shots_detail=total_shots_detail,
        possession=_to_float(user_detail.get("possession"), default=-1.0),
        pass_try=_to_float(user_pass.get("passTry")),
        pass_success=_to_float(user_pass.get("passSuccess")),
        through_pass_try=_to_float(user_pass.get("throughPassTry")),
        through_pass_success=_to_float(user_pass.get("throughPassSuccess")),
        tackle_try=_to_float(user_defence.get("tackleTry")),
        tackle_success=_to_float(user_defence.get("tackleSuccess")),
        shots_for_points=shots_for_points,
        goals_for_minutes=goals_for_minutes,
        goals_against_minutes=goals_against_minutes,
        goals_for_types=goals_for_types,
        shots_on_target_against=_to_float(opp_shoot.get("effectiveShootTotal")),
        goals_heading=_to_float(user_shoot.get("goalHeading")),
        goals_freekick=_to_float(user_shoot.get("goalFreekick")),
        goals_penaltykick=_to_float(user_shoot.get("goalPenaltyKick")),
        goals_in_penalty=_to_float(user_shoot.get("goalInPenalty")),
        goals_out_penalty=_to_float(user_shoot.get("goalOutPenalty")),
        controller=str(user_detail.get("controller", "")),
        player_stats=player_stats,
    )


def _smooth_issue_score(gap: float, scale: float) -> float:
    if gap <= 0:
        return 0.0
    return min(99.0, round((1.0 - math.exp(-(gap / max(scale, 1e-6)))) * 100.0, 2))


def _issue_scores(metrics: dict[str, float], benchmark: dict[str, float]) -> dict[str, float]:
    if metrics.get("match_count", 0.0) <= 0:
        return {"MAINTAIN_PERFORMANCE": 0.0}

    candidate_gap = {
        "HIGH_LATE_CONCEDE": metrics["late_concede_ratio"] - benchmark["late_concede_ratio"],
        "LOW_FINISHING": benchmark.get("goals_per_sot", 0.4) - metrics.get("goals_per_sot", 0.0),
        "POOR_SHOT_SELECTION": (
            (benchmark.get("in_box_shot_ratio", 0.56) - metrics.get("in_box_shot_ratio", 0.0)) * 0.65
            + (benchmark["shot_on_target_rate"] - metrics["shot_on_target_rate"]) * 0.35
        ),
        "OFFSIDE_RISK": metrics["offside_avg"] - benchmark["offside_avg"],
        "BUILDUP_INEFFICIENCY": (
            (benchmark.get("pass_success_rate", 0.81) - metrics.get("pass_success_rate", 0.0)) * 0.45
            + (benchmark.get("through_pass_success_rate", 0.29) - metrics.get("through_pass_success_rate", 0.0)) * 0.55
        ),
        "DEFENSE_DUEL_WEAKNESS": (
            (benchmark.get("tackle_success_rate", 0.39) - metrics.get("tackle_success_rate", 0.0)) * 0.6
            + (metrics.get("goals_against_per_match", 0.0) - benchmark.get("goals_against_per_match", 1.28)) * 0.4
        ),
        "CHANCE_CREATION_LOW": (
            (benchmark.get("shots_per_match", 7.3) - metrics.get("shots_per_match", 0.0)) * 0.45
            + (benchmark.get("xg_for_per_match", 1.45) - metrics.get("xg_for_per_match", 0.0)) * 0.55
        ),
        "POSSESSION_CONTROL_RISK": benchmark.get("possession_avg", 50.0) - metrics.get("possession_avg", 0.0),
    }
    scale = {
        "HIGH_LATE_CONCEDE": 0.18,
        "LOW_FINISHING": 0.16,
        "POOR_SHOT_SELECTION": 0.13,
        "OFFSIDE_RISK": 0.65,
        "BUILDUP_INEFFICIENCY": 0.10,
        "DEFENSE_DUEL_WEAKNESS": 0.20,
        "CHANCE_CREATION_LOW": 0.55,
        "POSSESSION_CONTROL_RISK": 6.0,
    }
    candidates = {
        issue_code: _smooth_issue_score(candidate_gap[issue_code], scale[issue_code])
        for issue_code in candidate_gap
    }
    ranked = sorted(candidates.items(), key=lambda item: item[1], reverse=True)
    selected = [(issue_code, score) for issue_code, score in ranked if score >= 3.0][:4]
    if not selected:
        return {"MAINTAIN_PERFORMANCE": 0.0}
    return {issue_code: round(score, 2) for issue_code, score in selected}


def _apply_tactic_delta(issue_code: str, current_tactic: dict[str, Any] | None) -> tuple[str, dict[str, Any]]:
    mappings: dict[str, tuple[str, dict[str, Any]]] = {
        "HIGH_LATE_CONCEDE": (
            "Stabilize defensive block in late game",
            {"defense_style_target": "후퇴", "defense_depth_delta": -1, "defense_width_delta": -1, "cdm_stay_back": True},
        ),
        "LOW_FINISHING": (
            "Prioritize high-quality shots in box",
            {"buildup_style_target": "밸런스", "box_players_delta": 1, "attack_width_delta": -1},
        ),
        "POOR_SHOT_SELECTION": (
            "Reduce low-value shots and improve build-up patience",
            {"buildup_style_target": "느린 빌드업", "box_players_delta": -1, "attack_width_delta": -1},
        ),
        "OFFSIDE_RISK": (
            "Delay forward runs and reduce risky through balls",
            {"attack_width_delta": -1, "quick_attack_off": ["박스 안 침투", "스트라이커 추가"]},
        ),
        "BUILDUP_INEFFICIENCY": (
            "Improve passing stability before final third",
            {"buildup_style_target": "밸런스", "attack_width_delta": -1, "box_players_delta": -1},
        ),
        "DEFENSE_DUEL_WEAKNESS": (
            "Reinforce first defensive contact and line compactness",
            {"defense_style_target": "밸런스", "defense_width_delta": -1, "defense_depth_delta": -1},
        ),
        "CHANCE_CREATION_LOW": (
            "Increase chance volume with wider attack and more box entries",
            {"buildup_style_target": "빠른 빌드업", "attack_width_delta": 1, "box_players_delta": 1},
        ),
        "POSSESSION_CONTROL_RISK": (
            "Stabilize possession with safer circulation",
            {"buildup_style_target": "느린 빌드업", "attack_width_delta": -1},
        ),
    }
    direction, delta = mappings[issue_code]
    if not current_tactic:
        return direction, delta

    next_values = {}
    numeric_mappings = [
        ("defense_depth", "defense_depth_delta"),
        ("defense_width", "defense_width_delta"),
        ("attack_width", "attack_width_delta"),
        ("box_players", "box_players_delta"),
    ]
    for field_name, delta_key in numeric_mappings:
        if delta_key in delta and field_name in current_tactic:
            target_key = f"{field_name}_target"
            next_values[target_key] = _clamp_tactic_1_10(
                _clamp_tactic_1_10(current_tactic.get(field_name), 5) + int(delta[delta_key]),
                5,
            )
    if next_values:
        delta = {**delta, **next_values}
    return direction, delta


def _issue_label(issue_code: str) -> str:
    labels = {
        "HIGH_LATE_CONCEDE": "후반 실점 리스크",
        "LOW_FINISHING": "마무리 효율 저하",
        "POOR_SHOT_SELECTION": "슈팅 선택 품질 저하",
        "OFFSIDE_RISK": "오프사이드 빈도 리스크",
        "BUILDUP_INEFFICIENCY": "빌드업 효율 저하",
        "DEFENSE_DUEL_WEAKNESS": "수비 경합 약세",
        "CHANCE_CREATION_LOW": "찬스 생성량 저하",
        "POSSESSION_CONTROL_RISK": "점유 안정성 리스크",
        "MAINTAIN_PERFORMANCE": "고우선순위 이슈 없음",
    }
    return labels.get(issue_code, issue_code)


def _confidence_detail(match_count: float, issue_score: float, tactic_input_known: bool = True) -> dict[str, float]:
    sample_score = max(0.0, min(1.0, match_count / CONFIDENCE_SAMPLE_FULL_MATCHES))
    severity_score = max(0.0, min(1.0, issue_score / 100.0))
    confidence = CONFIDENCE_BASE + CONFIDENCE_SAMPLE_WEIGHT * sample_score + CONFIDENCE_SEVERITY_WEIGHT * severity_score
    if issue_score < 10:
        confidence *= 0.90
    if issue_score < 1:
        confidence *= 0.85
    if not tactic_input_known:
        confidence *= CONFIDENCE_TACTIC_MISSING_PENALTY
        confidence = min(confidence, 0.88)
    confidence = max(0.0, min(0.95, confidence))
    return {
        "base_score": CONFIDENCE_BASE,
        "sample_weight": CONFIDENCE_SAMPLE_WEIGHT,
        "severity_weight": CONFIDENCE_SEVERITY_WEIGHT,
        "tactic_missing_penalty": CONFIDENCE_TACTIC_MISSING_PENALTY,
        "sample_score": round(sample_score, 2),
        "severity_score": round(severity_score, 2),
        "tactic_input_known": 1.0 if tactic_input_known else 0.0,
        "final_confidence": round(confidence, 2),
    }


def _benchmark_compare(issue_code: str, metrics: dict[str, float], benchmark: dict[str, float], benchmark_source: str) -> dict[str, Any]:
    if issue_code == "HIGH_LATE_CONCEDE":
        user_value = metrics["late_concede_ratio"]
        benchmark_value = benchmark["late_concede_ratio"]
        metric_name = "late_concede_ratio"
    elif issue_code == "LOW_FINISHING":
        user_value = metrics.get("goals_per_sot", 0.0)
        benchmark_value = benchmark.get("goals_per_sot", 0.4)
        metric_name = "goals_per_sot"
    elif issue_code == "POOR_SHOT_SELECTION":
        user_value = metrics.get("in_box_shot_ratio", 0.0)
        benchmark_value = benchmark.get("in_box_shot_ratio", 0.56)
        metric_name = "in_box_shot_ratio"
    elif issue_code == "OFFSIDE_RISK":
        user_value = metrics["offside_avg"]
        benchmark_value = benchmark["offside_avg"]
        metric_name = "offside_avg"
    elif issue_code == "BUILDUP_INEFFICIENCY":
        user_value = metrics.get("through_pass_success_rate", 0.0)
        benchmark_value = benchmark.get("through_pass_success_rate", 0.29)
        metric_name = "through_pass_success_rate"
    elif issue_code == "DEFENSE_DUEL_WEAKNESS":
        user_value = metrics.get("tackle_success_rate", 0.0)
        benchmark_value = benchmark.get("tackle_success_rate", 0.39)
        metric_name = "tackle_success_rate"
    elif issue_code == "CHANCE_CREATION_LOW":
        user_value = metrics.get("xg_for_per_match", 0.0)
        benchmark_value = benchmark.get("xg_for_per_match", 1.45)
        metric_name = "xg_for_per_match"
    elif issue_code == "POSSESSION_CONTROL_RISK":
        user_value = metrics.get("possession_avg", 0.0)
        benchmark_value = benchmark.get("possession_avg", 50.0)
        metric_name = "possession_avg"
    else:
        user_value = metrics["win_rate"]
        benchmark_value = benchmark["win_rate"]
        metric_name = "win_rate"

    return {
        "metric_name": metric_name,
        "user_value": round(user_value, 4),
        "benchmark_value": round(benchmark_value, 4),
        "gap_value": round(user_value - benchmark_value, 4),
        "source": benchmark_source,
    }


def _metric_gap_table(metrics: dict[str, float], benchmark: dict[str, float], benchmark_source: str) -> list[dict[str, Any]]:
    rows = [
        ("win_rate", "승률", metrics["win_rate"], benchmark["win_rate"], True),
        ("shot_on_target_rate", "유효슈팅 비율", metrics["shot_on_target_rate"], benchmark["shot_on_target_rate"], True),
        ("goals_per_sot", "유효슈팅 대비 득점률", metrics.get("goals_per_sot", 0.0), benchmark.get("goals_per_sot", 0.4), True),
        ("in_box_shot_ratio", "박스 안 슈팅 비중", metrics.get("in_box_shot_ratio", 0.0), benchmark.get("in_box_shot_ratio", 0.56), True),
        ("pass_success_rate", "패스 성공률", metrics.get("pass_success_rate", 0.0), benchmark.get("pass_success_rate", 0.81), True),
        (
            "through_pass_success_rate",
            "스루패스 성공률",
            metrics.get("through_pass_success_rate", 0.0),
            benchmark.get("through_pass_success_rate", 0.29),
            True,
        ),
        ("tackle_success_rate", "태클 성공률", metrics.get("tackle_success_rate", 0.0), benchmark.get("tackle_success_rate", 0.39), True),
        ("xg_for_per_match", "경기당 xG", metrics.get("xg_for_per_match", 0.0), benchmark.get("xg_for_per_match", 1.45), True),
        ("shots_per_match", "경기당 슈팅수", metrics.get("shots_per_match", 0.0), benchmark.get("shots_per_match", 7.3), True),
        ("possession_avg", "평균 점유율", metrics.get("possession_avg", 0.0), benchmark.get("possession_avg", 50.0), True),
        ("offside_avg", "오프사이드 평균", metrics["offside_avg"], benchmark["offside_avg"], False),
        ("late_concede_ratio", "후반 실점 비율", metrics["late_concede_ratio"], benchmark["late_concede_ratio"], False),
        (
            "goals_against_per_match",
            "경기당 실점",
            metrics.get("goals_against_per_match", 0.0),
            benchmark.get("goals_against_per_match", 1.28),
            False,
        ),
    ]
    return [
        {
            "metric_name": metric_name,
            "metric_label": metric_label,
            "user_value": round(user_value, 4),
            "benchmark_value": round(benchmark_value, 4),
            "gap_value": round(user_value - benchmark_value, 4),
            "higher_is_better": higher_is_better,
            "source": benchmark_source,
        }
        for metric_name, metric_label, user_value, benchmark_value, higher_is_better in rows
    ]


def _maintain_action(metrics: dict[str, float], benchmark_source: str, metric_gap_table: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "rank": 1,
        "action_code": "MAINTAIN_PERFORMANCE",
        "title": _issue_label("MAINTAIN_PERFORMANCE"),
        "description": "고우선순위 이슈가 없어 현재 전술 유지 후 다음 5경기를 모니터링하세요.",
        "evidence": {
            "issue_score": 0.0,
            "benchmark_compare": {
                "metric_name": "overall",
                "user_value": round(metrics["win_rate"], 4),
                "benchmark_value": 0.5,
                "gap_value": round(metrics["win_rate"] - 0.5, 4),
                "source": benchmark_source,
            },
            "confidence_detail": {
                "base_score": CONFIDENCE_BASE,
                "sample_weight": CONFIDENCE_SAMPLE_WEIGHT,
                "severity_weight": CONFIDENCE_SEVERITY_WEIGHT,
                "tactic_missing_penalty": CONFIDENCE_TACTIC_MISSING_PENALTY,
                "sample_score": round(max(0.0, min(1.0, metrics["match_count"] / CONFIDENCE_SAMPLE_FULL_MATCHES)), 2),
                "severity_score": 0.0,
                "final_confidence": 0.45,
            },
            "coach_explanation": {
                "coach_message": "고우선순위 리스크가 없어 전술을 유지하고 표본을 추가 확보하세요.",
                "root_cause": "현재 핵심 지표가 급격히 이탈하지 않았습니다.",
                "execution_checklist": [
                    "현재 전술을 5경기 유지",
                    "경기당 실점/득점 추세만 모니터링",
                    "연패 시점에만 재분석",
                ],
                "in_game_signals": [
                    "전반 슈팅 수와 유효슈팅 비율이 급락하면 해당 경기는 유지하고 종료 후 재진단",
                    "후반 집중력 저하가 2경기 연속이면 다음 경기에서 수비 깊이 1단계 조정",
                ],
                "failure_patterns": [
                    "2경기 연속 대량 실점 시 유지 전략 중단",
                ],
                "expected_effect": "표본이 늘수록 추천 신뢰도가 상승합니다.",
                "source": "rules",
            },
            "metric_gap_table": metric_gap_table,
            "metrics": metrics,
        },
        "tactic_direction": "현재 전술 유지 및 추가 표본 확보",
        "tactic_delta": {},
        "confidence": 0.45,
    }


def _compute_metrics(matches: Iterable[MatchStats]) -> dict[str, float]:
    rows = list(matches)
    count = len(rows)
    if count == 0:
        return {
            "match_count": 0.0,
            "win_rate": 0.0,
            "goals_for": 0.0,
            "goals_against": 0.0,
            "xg_for": 0.0,
            "xg_against": 0.0,
            "shot_on_target_rate": 0.0,
            "goals_per_sot": 0.0,
            "goals_per_shot": 0.0,
            "pass_success_rate": 0.0,
            "through_pass_success_rate": 0.0,
            "tackle_success_rate": 0.0,
            "offside_avg": 0.0,
            "late_concede_ratio": 0.0,
            "in_box_shot_ratio": 0.0,
            "shots_total": 0.0,
            "shots_on_target_total": 0.0,
            "shots_per_match": 0.0,
            "xg_for_per_match": 0.0,
            "goals_against_per_match": 0.0,
            "possession_avg": 0.0,
        }
    wins = sum(1 for row in rows if row.result == "승")
    goals_for = sum(row.goals_for for row in rows)
    goals_against = sum(row.goals_against for row in rows)
    xg_for = sum(row.xg_for for row in rows)
    xg_against = sum(row.xg_against for row in rows)
    total_shots = sum(row.shots for row in rows)
    total_sot = sum(row.shots_on_target for row in rows)
    total_offside = sum(row.offside for row in rows)
    late_concede = sum(row.late_goals_against for row in rows)
    in_box_shots = sum(row.in_box_shots for row in rows)
    detailed_shots = sum(row.total_shots_detail for row in rows)
    pass_try_total = sum(row.pass_try for row in rows)
    pass_success_total = sum(row.pass_success for row in rows)
    through_pass_try_total = sum(row.through_pass_try for row in rows)
    through_pass_success_total = sum(row.through_pass_success for row in rows)
    tackle_try_total = sum(row.tackle_try for row in rows)
    tackle_success_total = sum(row.tackle_success for row in rows)
    valid_possessions = [row.possession for row in rows if row.possession >= 0]
    possession_total = sum(valid_possessions)
    possession_count = len(valid_possessions)
    return {
        "match_count": float(count),
        "win_rate": wins / count,
        "goals_for": goals_for,
        "goals_against": goals_against,
        "xg_for": xg_for,
        "xg_against": xg_against,
        "shot_on_target_rate": total_sot / total_shots if total_shots > 0 else 0.0,
        "goals_per_sot": goals_for / total_sot if total_sot > 0 else 0.0,
        "goals_per_shot": goals_for / total_shots if total_shots > 0 else 0.0,
        "pass_success_rate": pass_success_total / pass_try_total if pass_try_total > 0 else 0.0,
        "through_pass_success_rate": through_pass_success_total / through_pass_try_total if through_pass_try_total > 0 else 0.0,
        "tackle_success_rate": tackle_success_total / tackle_try_total if tackle_try_total > 0 else 0.0,
        "offside_avg": total_offside / count,
        "late_concede_ratio": late_concede / goals_against if goals_against > 0 else 0.0,
        "in_box_shot_ratio": in_box_shots / detailed_shots if detailed_shots > 0 else 0.0,
        "shots_total": total_shots,
        "shots_on_target_total": total_sot,
        "shots_per_match": total_shots / count,
        "xg_for_per_match": xg_for / count,
        "goals_against_per_match": goals_against / count,
        "possession_avg": possession_total / possession_count if possession_count > 0 else 0.0,
    }


def _time_bucket_counts(minutes: Iterable[float]) -> list[dict[str, Any]]:
    buckets = [
        (0, 15, "0-15"),
        (15, 30, "15-30"),
        (30, 45, "30-45"),
        (45, 60, "45-60"),
        (60, 75, "60-75"),
        (75, 200, "75+"),
    ]
    counts = [0, 0, 0, 0, 0, 0]
    for minute in minutes:
        for idx, (left, right, _) in enumerate(buckets):
            if left <= minute < right:
                counts[idx] += 1
                break
    return [
        {"label": label, "count": counts[idx]}
        for idx, (_, _, label) in enumerate(buckets)
    ]


def _shot_zone_summary(points: list[dict[str, float | bool]]) -> dict[str, float]:
    if not points:
        return {
            "left_ratio": 0.0,
            "center_ratio": 0.0,
            "right_ratio": 0.0,
            "in_box_ratio": 0.0,
            "outside_box_ratio": 0.0,
            "total_shots": 0.0,
        }
    left = 0
    center = 0
    right = 0
    in_box = 0
    # Center lane is intentionally narrow (0.45~0.55) to avoid over-clustering in
    # long-term samples where central shots dominate around y=0.5.
    center_left = 0.45
    center_right = 0.55
    for point in points:
        x = float(point.get("x", 0.0))
        y = float(point.get("y", 0.0))
        if y < center_left:
            left += 1
        elif y <= center_right:
            center += 1
        else:
            right += 1
        if _is_in_box(x, y):
            in_box += 1
    total = float(len(points))
    return {
        "left_ratio": left / total,
        "center_ratio": center / total,
        "right_ratio": right / total,
        "in_box_ratio": in_box / total,
        "outside_box_ratio": 1.0 - (in_box / total),
        "total_shots": total,
    }


def _goal_type_label(type_code: int) -> str:
    labels = {
        1: "일반 슈팅 (normal)",
        2: "감아차기 (finesse)",
        3: "헤더 (header)",
        4: "로빙슛 (lob)",
        5: "플레어슛 (flare)",
        6: "낮은 슛 (low)",
        7: "발리슛 (volley)",
        8: "프리킥 (free-kick)",
        9: "패널티킥 (penalty)",
        10: "무회전슛 (knuckle)",
        11: "바이시클킥 (bicycle)",
        12: "파워슛 (super)",
    }
    return labels.get(type_code, f"미정의 슈팅 타입 {type_code} (공식 문서 미기재)")


def _goal_type_summary(type_codes: list[int]) -> list[dict[str, Any]]:
    if not type_codes:
        return []
    counts: dict[int, int] = defaultdict(int)
    for code in type_codes:
        counts[code] += 1
    total = sum(counts.values())
    ranked = sorted(counts.items(), key=lambda item: item[1], reverse=True)[:5]
    return [
        {
            "type_code": code,
            "label": _goal_type_label(code),
            "count": count,
            "ratio": round(count / total, 4) if total > 0 else 0.0,
        }
        for code, count in ranked
    ]


def _goal_profile_summary(rows: list[MatchStats]) -> dict[str, Any]:
    total_goals = sum(row.goals_for for row in rows)
    heading_goals = sum(row.goals_heading for row in rows)
    freekick_goals = sum(row.goals_freekick for row in rows)
    penaltykick_goals = sum(row.goals_penaltykick for row in rows)
    in_penalty_goals = sum(row.goals_in_penalty for row in rows)
    out_penalty_goals = sum(row.goals_out_penalty for row in rows)
    footedness_note = "FC Online Open API는 득점의 왼발/오른발 구분 필드를 직접 제공하지 않습니다."

    def ratio(value: float) -> float:
        if total_goals <= 0:
            return 0.0
        return round(value / total_goals, 4)

    return {
        "total_goals": round(total_goals, 2),
        "heading_goals": round(heading_goals, 2),
        "freekick_goals": round(freekick_goals, 2),
        "penaltykick_goals": round(penaltykick_goals, 2),
        "in_penalty_goals": round(in_penalty_goals, 2),
        "out_penalty_goals": round(out_penalty_goals, 2),
        "heading_ratio": ratio(heading_goals),
        "freekick_ratio": ratio(freekick_goals),
        "penaltykick_ratio": ratio(penaltykick_goals),
        "in_penalty_ratio": ratio(in_penalty_goals),
        "out_penalty_ratio": ratio(out_penalty_goals),
        "footedness_note": footedness_note,
    }


_ATTACK_POSITIONS = {"ST", "CF", "LF", "RF", "LS", "RS", "LW", "RW", "LWF", "RWF"}
_MIDFIELD_POSITIONS = {"CAM", "LAM", "RAM", "CM", "LCM", "RCM", "CDM", "LDM", "RDM", "LM", "RM"}
_DEFENSE_POSITIONS = {"CB", "LCB", "RCB", "LB", "RB", "LWB", "RWB", "SW"}
_PLAYER_ROLE_WEIGHTS: dict[str, dict[str, float]] = {
    "ATT": {
        "goals_per_match": 0.30,
        "assists_per_match": 0.12,
        "effective_shots_per_match": 0.22,
        "shot_accuracy": 0.16,
        "avg_rating": 0.14,
        "dribble_success_rate": 0.06,
    },
    "MID": {
        "assists_per_match": 0.16,
        "pass_success_rate": 0.25,
        "dribble_success_rate": 0.13,
        "tackle_success_rate": 0.12,
        "intercepts_per_match": 0.12,
        "effective_shots_per_match": 0.08,
        "shot_accuracy": 0.06,
        "goals_per_match": 0.08,
        "avg_rating": 0.10,
    },
    "DEF": {
        "tackle_success_rate": 0.27,
        "tackles_per_match": 0.18,
        "intercepts_per_match": 0.23,
        "blocks_per_match": 0.16,
        "pass_success_rate": 0.08,
        "avg_rating": 0.06,
        "assists_per_match": 0.01,
        "goals_per_match": 0.01,
    },
    "GK": {
        "save_rate_proxy": 0.45,
        "save_events_per_match": 0.20,
        "avg_rating": 0.18,
        "pass_success_rate": 0.12,
        "intercepts_per_match": 0.05,
    },
    "SUB": {
        "assists_per_match": 0.16,
        "pass_success_rate": 0.25,
        "dribble_success_rate": 0.13,
        "tackle_success_rate": 0.12,
        "intercepts_per_match": 0.12,
        "effective_shots_per_match": 0.08,
        "shot_accuracy": 0.06,
        "goals_per_match": 0.08,
        "avg_rating": 0.10,
    },
}


def _safe_divide(numerator: float, denominator: float) -> float:
    if denominator <= 0:
        return 0.0
    return numerator / denominator


def _player_role(position_name: str) -> str:
    position = position_name.strip().upper()
    if position == "SUB":
        return "SUB"
    if position == "GK":
        return "GK"
    if position in _ATTACK_POSITIONS:
        return "ATT"
    if position in _MIDFIELD_POSITIONS:
        return "MID"
    if position in _DEFENSE_POSITIONS:
        return "DEF"
    if "DM" in position or "CM" in position or "AM" in position:
        return "MID"
    if position.endswith("B") or "WB" in position:
        return "DEF"
    if "W" in position or "F" in position:
        return "ATT"
    return "MID"


def _quantile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    if len(sorted_values) == 1:
        return sorted_values[0]
    index = (len(sorted_values) - 1) * q
    lower_index = int(math.floor(index))
    upper_index = int(math.ceil(index))
    if lower_index == upper_index:
        return sorted_values[lower_index]
    weight = index - lower_index
    return sorted_values[lower_index] * (1.0 - weight) + sorted_values[upper_index] * weight


def _robust_bounds(values: list[float]) -> tuple[float, float]:
    if not values:
        return 0.0, 1.0
    if len(values) >= 5:
        low = _quantile(values, 0.1)
        high = _quantile(values, 0.9)
    elif len(values) >= 2:
        low = min(values)
        high = max(values)
    else:
        center = values[0]
        span = max(0.1, abs(center) * 0.15)
        return center - span, center + span
    if high - low < 1e-6:
        span = max(0.1, abs(high) * 0.1)
        return low - span, high + span
    return low, high


def _normalize_to_unit(value: float, low: float, high: float) -> float:
    if high <= low:
        return 0.5
    return max(0.0, min(1.0, (value - low) / (high - low)))


def _player_report_summary(rows: list[MatchStats]) -> dict[str, Any]:
    def participated_in_match(player: dict[str, float | int]) -> bool:
        rating = _to_float(player.get("rating"), default=0.0)
        if rating > 0:
            return True
        activity_keys = (
            "goals",
            "assists",
            "shots",
            "effective_shots",
            "pass_try",
            "pass_success",
            "tackle_try",
            "tackle_success",
        )
        return any(_to_float(player.get(key)) > 0 for key in activity_keys)

    aggregates: dict[tuple[int, int], dict[str, Any]] = {}
    controller_breakdown: dict[str, int] = defaultdict(int)
    for row in rows:
        controller = row.controller.strip() or "unknown"
        controller_breakdown[controller] += 1
        seen_keys: set[tuple[int, int]] = set()
        for player in row.player_stats:
            sp_id = _to_int(player.get("sp_id"))
            sp_position = _to_int(player.get("sp_position"))
            sp_grade = _to_int(player.get("sp_grade")) or 0
            if sp_id is None or sp_position is None:
                continue
            key = (sp_id, sp_grade)
            if key not in aggregates:
                aggregates[key] = {
                    "appearances": 0.0,
                    "goals": 0.0,
                    "assists": 0.0,
                    "shots": 0.0,
                    "effective_shots": 0.0,
                    "pass_try": 0.0,
                    "pass_success": 0.0,
                    "tackle_try": 0.0,
                    "tackle_success": 0.0,
                    "intercept": 0.0,
                    "block_try": 0.0,
                    "block_success": 0.0,
                    "dribble_try": 0.0,
                    "dribble_success": 0.0,
                    "defending_actions": 0.0,
                    "gk_conceded": 0.0,
                    "gk_saved": 0.0,
                    "rating_sum": 0.0,
                    "rating_count": 0.0,
                    "last_position": float(sp_position),
                    "position_counts": {},
                }
            target = aggregates[key]
            target["last_position"] = float(sp_position)
            target["goals"] += _to_float(player.get("goals"))
            target["assists"] += _to_float(player.get("assists"))
            target["shots"] += _to_float(player.get("shots"))
            target["effective_shots"] += _to_float(player.get("effective_shots"))
            target["pass_try"] += _to_float(player.get("pass_try"))
            target["pass_success"] += _to_float(player.get("pass_success"))
            target["tackle_try"] += _to_float(player.get("tackle_try"))
            target["tackle_success"] += _to_float(player.get("tackle_success"))
            target["intercept"] += _to_float(player.get("intercept"))
            target["block_try"] += _to_float(player.get("block_try"))
            target["block_success"] += _to_float(player.get("block_success"))
            target["dribble_try"] += _to_float(player.get("dribble_try"))
            target["dribble_success"] += _to_float(player.get("dribble_success"))
            target["defending_actions"] += _to_float(player.get("defending_actions"))
            rating = _to_float(player.get("rating"), default=-1.0)
            if rating >= 0:
                target["rating_sum"] += rating
                target["rating_count"] += 1
            if key not in seen_keys and participated_in_match(player):
                target["appearances"] += 1
                if sp_position == 0:
                    goals_conceded = max(0.0, row.goals_against)
                    shots_on_target_against = max(0.0, row.shots_on_target_against)
                    target["gk_conceded"] += goals_conceded
                    target["gk_saved"] += max(0.0, shots_on_target_against - goals_conceded)
                position_counts = target.get("position_counts")
                if isinstance(position_counts, dict):
                    position_counts[sp_position] = _to_float(position_counts.get(sp_position)) + 1.0
                seen_keys.add(key)

    spid_names = _spid_name_map()
    position_names = _position_name_map()
    season_meta = _season_meta_map()
    raw_players: list[dict[str, Any]] = []
    metric_pools_global: dict[str, list[float]] = defaultdict(list)
    metric_pools_by_role: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for (sp_id, sp_grade), value in aggregates.items():
        appearances_actual = max(0.0, value["appearances"])
        appearances = max(1.0, appearances_actual)
        avg_rating = value["rating_sum"] / value["rating_count"] if value["rating_count"] > 0 else 0.0
        pass_success_rate = value["pass_success"] / value["pass_try"] if value["pass_try"] > 0 else 0.0
        tackle_success_rate = value["tackle_success"] / value["tackle_try"] if value["tackle_try"] > 0 else 0.0
        primary_position = _to_int(value.get("last_position"))
        position_counts = value.get("position_counts")
        if isinstance(position_counts, dict) and position_counts:
            primary_position = max(
                position_counts.items(),
                key=lambda item: (
                    _to_float(item[1]),
                    0 if str(position_names.get(_to_int(item[0]) or -1, "")).upper() != "SUB" else -1,
                ),
            )[0]
        sp_position = int(primary_position) if primary_position is not None else -1
        position_name = position_names.get(sp_position, str(sp_position))
        role_group = _player_role(position_name)
        goalie_saved = max(0.0, _to_float(value.get("gk_saved")))
        goalie_conceded = max(0.0, _to_float(value.get("gk_conceded")))
        defending_actions = max(0.0, _to_float(value.get("defending_actions")))
        saves_proxy = max(goalie_saved, defending_actions)
        impact_metrics = {
            "goals_per_match": _safe_divide(value["goals"], appearances),
            "assists_per_match": _safe_divide(value["assists"], appearances),
            "effective_shots_per_match": _safe_divide(value["effective_shots"], appearances),
            "shot_accuracy": _safe_divide(value["effective_shots"], value["shots"]),
            "pass_success_rate": pass_success_rate,
            "tackle_success_rate": tackle_success_rate,
            "tackles_per_match": _safe_divide(value["tackle_success"], appearances),
            "intercepts_per_match": _safe_divide(value["intercept"], appearances),
            "blocks_per_match": _safe_divide(value["block_success"], appearances),
            "dribble_success_rate": _safe_divide(value["dribble_success"], value["dribble_try"]),
            "save_events_per_match": _safe_divide(saves_proxy, appearances),
            "save_rate_proxy": _safe_divide(saves_proxy, saves_proxy + goalie_conceded),
            "avg_rating": avg_rating,
        }
        for metric_name, metric_value in impact_metrics.items():
            metric_pools_global[metric_name].append(metric_value)
            metric_pools_by_role[role_group][metric_name].append(metric_value)
        season_id = sp_id // 1_000_000
        raw_players.append(
            {
                "sp_id": sp_id,
                "player_name": spid_names.get(sp_id, f"spId {sp_id}"),
                "season_id": season_id,
                "season_name": season_meta.get(season_id, {}).get("name", f"시즌 {season_id}"),
                "season_img": season_meta.get(season_id, {}).get("image", ""),
                **_player_image_urls(sp_id),
                "sp_position": sp_position,
                "position_name": position_name,
                "sp_grade": sp_grade,
                "appearances": int(appearances_actual),
                "goals": round(value["goals"], 2),
                "assists": round(value["assists"], 2),
                "goal_involvements": round(value["goals"] + value["assists"], 2),
                "shots": round(value["shots"], 2),
                "effective_shots": round(value["effective_shots"], 2),
                "pass_success_rate": round(pass_success_rate, 4),
                "tackle_success_rate": round(tackle_success_rate, 4),
                "avg_rating": round(avg_rating, 3),
                "_role_group": role_group,
                "_appearances_actual": appearances_actual,
                "_impact_metrics": impact_metrics,
            }
        )

    bounds_cache: dict[tuple[str, str], tuple[float, float]] = {}
    for role_group, weights in _PLAYER_ROLE_WEIGHTS.items():
        for metric_name in weights:
            role_values = metric_pools_by_role.get(role_group, {}).get(metric_name, [])
            pool = role_values if len(role_values) >= 3 else metric_pools_global.get(metric_name, role_values)
            bounds_cache[(role_group, metric_name)] = _robust_bounds(pool)

    players: list[dict[str, Any]] = []
    sample_match_count = max(1.0, float(len(rows)))
    for raw_player in raw_players:
        role_group = str(raw_player.pop("_role_group", "MID"))
        appearances_actual = _to_float(raw_player.pop("_appearances_actual", 0.0))
        impact_metrics = raw_player.pop("_impact_metrics", {})
        if not isinstance(impact_metrics, dict):
            impact_metrics = {}
        weights = _PLAYER_ROLE_WEIGHTS.get(role_group, _PLAYER_ROLE_WEIGHTS["MID"])
        weighted_score = 0.0
        impact_components: list[dict[str, Any]] = []
        for metric_name, weight in weights.items():
            value = _to_float(impact_metrics.get(metric_name))
            low, high = bounds_cache.get((role_group, metric_name), (0.0, 1.0))
            normalized = _normalize_to_unit(value, low, high)
            contribution = normalized * weight
            weighted_score += contribution
            impact_components.append(
                {
                    "metric": metric_name,
                    "weight": round(weight, 3),
                    "raw": round(value, 4),
                    "normalized": round(normalized, 4),
                    "weighted_score": round(contribution, 4),
                }
            )
        impact_components.sort(key=lambda item: _to_float(item.get("weighted_score")), reverse=True)

        sample_reference = max(3.0, sample_match_count * 0.35)
        sample_factor = 0.0 if appearances_actual <= 0 else min(1.0, math.sqrt(appearances_actual / sample_reference))
        reliability_scale = 0.65 + 0.35 * sample_factor
        impact_score = weighted_score * 100.0 * reliability_scale
        raw_player["role_group"] = role_group
        raw_player["impact_model"] = "role_weighted_v2"
        raw_player["impact_confidence"] = round(0.35 + 0.65 * sample_factor, 3)
        raw_player["impact_components"] = impact_components
        raw_player["impact_score"] = round(impact_score, 3)
        players.append(raw_player)

    players.sort(key=lambda item: (-int(item["appearances"]), -float(item["impact_score"]), -float(item["goal_involvements"])))
    preferred_top = [player for player in players if str(player.get("position_name", "")).upper() != "SUB"]
    top_players = (preferred_top or players)[:11]

    top_scorer = max(players, key=lambda item: float(item["goals"]), default=None)
    top_assister = max(players, key=lambda item: float(item["assists"]), default=None)
    most_used = max(players, key=lambda item: int(item["appearances"]), default=None)

    return {
        "sample_matches": len(rows),
        "controller_breakdown": dict(sorted(controller_breakdown.items(), key=lambda item: item[1], reverse=True)),
        "player_count": len(players),
        "top_players": top_players,
        "players": players[:18],
        "top_scorer": top_scorer,
        "top_assister": top_assister,
        "most_used": most_used,
    }


def _build_visual_summary(rows: list[MatchStats]) -> dict[str, Any]:
    shot_points: list[dict[str, float | bool]] = []
    goals_for_minutes: list[float] = []
    goals_against_minutes: list[float] = []
    goals_for_types: list[int] = []
    for row in rows:
        shot_points.extend(row.shots_for_points)
        goals_for_minutes.extend(row.goals_for_minutes)
        goals_against_minutes.extend(row.goals_against_minutes)
        goals_for_types.extend(row.goals_for_types)
    if len(shot_points) > 180:
        shot_points = shot_points[:180]
    return {
        "shot_map": shot_points,
        "shot_zone": _shot_zone_summary(shot_points),
        "goal_timing_for": _time_bucket_counts(goals_for_minutes),
        "goal_timing_against": _time_bucket_counts(goals_against_minutes),
        "goal_profile": _goal_profile_summary(rows),
        "player_report": _player_report_summary(rows),
        "goal_type_for": _goal_type_summary(goals_for_types),
        "goal_type_note": "공식 Open API shootDetail.type 코드(1~12) 기준으로 라벨링하며, 문서에 없는 코드는 미정의 타입으로 표시합니다. 왼발/오른발 직접 필드는 제공되지 않습니다.",
    }


def _recent_match_summary(rows: list[MatchStats], limit: int = 5) -> list[dict[str, Any]]:
    return [
        {
            "match_date": row.match_date,
            "opponent_nickname": row.opponent_nickname or "알 수 없음",
            "result": row.result or "-",
            "score_for": round(row.goals_for, 2),
            "score_against": round(row.goals_against, 2),
            "controller": row.controller or "unknown",
        }
        for row in rows[:limit]
    ]


def _participant_row(user: dict[str, Any], opp: dict[str, Any]) -> dict[str, Any] | None:
    user_detail = user.get("matchDetail", {}) if isinstance(user.get("matchDetail"), dict) else {}
    opp_shoot = opp.get("shoot", {}) if isinstance(opp.get("shoot"), dict) else {}
    user_shoot = user.get("shoot", {}) if isinstance(user.get("shoot"), dict) else {}
    user_pass = user.get("pass", {}) if isinstance(user.get("pass"), dict) else {}
    user_defence = user.get("defence", {}) if isinstance(user.get("defence"), dict) else {}
    opp_shot_detail = opp.get("shootDetail") if isinstance(opp.get("shootDetail"), list) else []
    user_shot_detail = user.get("shootDetail") if isinstance(user.get("shootDetail"), list) else []

    ouid = str(user.get("ouid", "")).strip()
    if not ouid:
        return None
    nickname = str(user.get("nickname", "")).strip()

    shots = _to_float(user_shoot.get("shootTotal"))
    shots_on_target = _to_float(user_shoot.get("effectiveShootTotal"))
    goals_for = _to_float(user_shoot.get("goalTotal"))
    goals_against = _to_float(opp_shoot.get("goalTotal"))
    late_goals_against = 0.0
    in_box_shots = 0.0
    total_shots_detail = 0.0
    for shot in user_shot_detail:
        if not isinstance(shot, dict):
            continue
        total_shots_detail += 1
        if _is_in_box(_to_float(shot.get("x")), _to_float(shot.get("y"))):
            in_box_shots += 1
    for shot in opp_shot_detail:
        if not isinstance(shot, dict):
            continue
        is_goal = _to_float(shot.get("result")) == 3 or str(shot.get("spResult", "")) in {"goal", "3"}
        if not is_goal:
            continue
        if _goal_time_to_minute(shot.get("goalTime")) >= 60:
            late_goals_against += 1

    return {
        "ouid": ouid,
        "nickname": nickname,
        "match_count": 1.0,
        "win_count": 1.0 if str(user_detail.get("matchResult", "")) == "승" else 0.0,
        "goals_for": goals_for,
        "goals_against": goals_against,
        "xg_for": shots * 0.12 + shots_on_target * 0.20,
        "shots": shots,
        "shots_on_target": shots_on_target,
        "in_box_shots": in_box_shots,
        "total_shots_detail": total_shots_detail,
        "offside_total": _to_float(user_detail.get("offsideCount")),
        "late_goals_against": late_goals_against,
        "pass_try": _to_float(user_pass.get("passTry")),
        "pass_success": _to_float(user_pass.get("passSuccess")),
        "through_pass_try": _to_float(user_pass.get("throughPassTry")),
        "through_pass_success": _to_float(user_pass.get("throughPassSuccess")),
        "tackle_try": _to_float(user_defence.get("tackleTry")),
        "tackle_success": _to_float(user_defence.get("tackleSuccess")),
        "possession_total": _to_float(user_detail.get("possession")) if user_detail.get("possession") is not None else 0.0,
        "possession_count": 1.0 if user_detail.get("possession") is not None else 0.0,
    }


def _collect_user_profiles(match_type: int, limit_rows: int = 3000) -> list[dict[str, Any]]:
    conn = connect()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT payload_json
            FROM matches_raw
            WHERE match_type = ?
            ORDER BY match_date DESC, id DESC
            LIMIT ?
            """,
            (match_type, limit_rows),
        )
        aggregates: dict[str, dict[str, Any]] = defaultdict(
            lambda: {
                "nickname": "",
                "match_count": 0.0,
                "win_count": 0.0,
                "goals_for": 0.0,
                "goals_against": 0.0,
                "xg_for": 0.0,
                "shots": 0.0,
                "shots_on_target": 0.0,
                "in_box_shots": 0.0,
                "total_shots_detail": 0.0,
                "offside_total": 0.0,
                "late_goals_against": 0.0,
                "pass_try": 0.0,
                "pass_success": 0.0,
                "through_pass_try": 0.0,
                "through_pass_success": 0.0,
                "tackle_try": 0.0,
                "tackle_success": 0.0,
                "possession_total": 0.0,
                "possession_count": 0.0,
            }
        )
        for raw_row in cur.fetchall():
            payload = json.loads(raw_row["payload_json"])
            match_info = payload.get("matchInfo")
            if not isinstance(match_info, list) or len(match_info) < 2:
                continue
            for idx, item in enumerate(match_info[:2]):
                if not isinstance(item, dict):
                    continue
                opp = match_info[1 - idx]
                if not isinstance(opp, dict):
                    continue
                parsed = _participant_row(item, opp)
                if parsed is None:
                    continue
                target = aggregates[str(parsed["ouid"])]
                if parsed.get("nickname") and not target["nickname"]:
                    target["nickname"] = str(parsed["nickname"])
                for key in (
                    "match_count",
                    "win_count",
                    "goals_for",
                    "goals_against",
                    "xg_for",
                    "shots",
                    "shots_on_target",
                    "in_box_shots",
                    "total_shots_detail",
                    "offside_total",
                    "late_goals_against",
                    "pass_try",
                    "pass_success",
                    "through_pass_try",
                    "through_pass_success",
                    "tackle_try",
                    "tackle_success",
                    "possession_total",
                    "possession_count",
                ):
                    target[key] += float(parsed[key])

        profiles: list[dict[str, Any]] = []
        for ouid, values in aggregates.items():
            match_count = values["match_count"]
            if match_count <= 0:
                continue
            win_rate = values["win_count"] / match_count
            shot_on_target_rate = values["shots_on_target"] / values["shots"] if values["shots"] > 0 else 0.0
            offside_avg = values["offside_total"] / match_count
            late_concede_ratio = values["late_goals_against"] / values["goals_against"] if values["goals_against"] > 0 else 0.0
            xg_for_per_match = values["xg_for"] / match_count
            goals_per_sot = values["goals_for"] / values["shots_on_target"] if values["shots_on_target"] > 0 else 0.0
            in_box_shot_ratio = values["in_box_shots"] / values["total_shots_detail"] if values["total_shots_detail"] > 0 else 0.0
            pass_success_rate = values["pass_success"] / values["pass_try"] if values["pass_try"] > 0 else 0.0
            through_pass_success_rate = (
                values["through_pass_success"] / values["through_pass_try"] if values["through_pass_try"] > 0 else 0.0
            )
            tackle_success_rate = values["tackle_success"] / values["tackle_try"] if values["tackle_try"] > 0 else 0.0
            shots_per_match = values["shots"] / match_count
            goals_against_per_match = values["goals_against"] / match_count
            possession_avg = values["possession_total"] / values["possession_count"] if values["possession_count"] > 0 else 0.0
            profiles.append(
                {
                    "ouid": ouid,
                    "nickname": str(values.get("nickname", "")),
                    "match_count": match_count,
                    "win_rate": win_rate,
                    "shot_on_target_rate": shot_on_target_rate,
                    "offside_avg": offside_avg,
                    "late_concede_ratio": late_concede_ratio,
                    "xg_for_per_match": xg_for_per_match,
                    "goals_per_sot": goals_per_sot,
                    "in_box_shot_ratio": in_box_shot_ratio,
                    "pass_success_rate": pass_success_rate,
                    "through_pass_success_rate": through_pass_success_rate,
                    "tackle_success_rate": tackle_success_rate,
                    "shots_per_match": shots_per_match,
                    "goals_against_per_match": goals_against_per_match,
                    "possession_avg": possession_avg,
                }
            )
        return profiles
    finally:
        conn.close()


def _resolve_benchmark(
    match_type: int,
    official_rankers: list[dict[str, Any]] | None = None,
    ranker_profiles: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, float], dict[str, Any]]:
    if official_rankers is None:
        official_rankers = _load_official_rankers(limit=50)
    rank_map = {str(row["ouid"]): int(row["rank_no"]) for row in official_rankers if row.get("ouid")}
    rank_map_by_nickname: dict[str, int] = {}
    for row in official_rankers:
        normalized_nickname = _normalize_nickname(str(row.get("nickname", "")))
        if not normalized_nickname:
            continue
        rank_map_by_nickname[normalized_nickname] = int(row["rank_no"])
    total_rankers = len(official_rankers)
    mapped_ouid_count = len(rank_map)
    mapped_nickname_count = len(rank_map_by_nickname)
    if not rank_map and not rank_map_by_nickname:
        return BENCHMARKS.get(match_type, BENCHMARKS[50]), {
            "source": STATIC_BENCHMARK_SOURCE,
            "cohort_size": 0,
            "note": "fallback_static_benchmark_sync_rankers_first",
            "total_rankers": total_rankers,
            "mapped_ouid_count": mapped_ouid_count,
            "mapped_nickname_count": mapped_nickname_count,
        }

    if ranker_profiles is None:
        ranker_profiles = [
            profile
            for profile in _collect_user_profiles(match_type=50)
            if str(profile["ouid"]) in rank_map
            or _normalize_nickname(str(profile.get("nickname", ""))) in rank_map_by_nickname
        ]
    else:
        ranker_profiles = [
            profile
            for profile in ranker_profiles
            if str(profile["ouid"]) in rank_map
            or _normalize_nickname(str(profile.get("nickname", ""))) in rank_map_by_nickname
        ]

    def rank_no(profile: dict[str, Any]) -> int:
        by_ouid = rank_map.get(str(profile["ouid"]))
        if by_ouid is not None:
            return by_ouid
        return rank_map_by_nickname.get(_normalize_nickname(str(profile.get("nickname", ""))), 999999)

    stable_profiles = [profile for profile in ranker_profiles if float(profile["match_count"]) >= 3.0 and rank_no(profile) < 999999]
    if len(stable_profiles) < 5:
        return BENCHMARKS.get(match_type, BENCHMARKS[50]), {
            "source": STATIC_BENCHMARK_SOURCE,
            "cohort_size": len(stable_profiles),
            "note": "fallback_static_benchmark_insufficient_ranker_profile",
            "total_rankers": total_rankers,
            "mapped_ouid_count": mapped_ouid_count,
            "mapped_nickname_count": mapped_nickname_count,
        }

    stable_profiles.sort(key=rank_no)
    selected = stable_profiles[: min(30, len(stable_profiles))]
    total_matches = sum(float(row["match_count"]) for row in selected)
    shot_numerator = sum(float(row["shot_on_target_rate"]) * float(row["match_count"]) for row in selected)
    offside_total = sum(float(row["offside_avg"]) * float(row["match_count"]) for row in selected)
    late_denominator = sum(max(1.0, float(row["match_count"])) for row in selected)
    late_numerator = sum(float(row["late_concede_ratio"]) * max(1.0, float(row["match_count"])) for row in selected)
    benchmark = {
        "win_rate": sum(float(row["win_rate"]) * float(row["match_count"]) for row in selected) / total_matches if total_matches > 0 else 0.5,
        "shot_on_target_rate": shot_numerator / total_matches if total_matches > 0 else 0.4,
        "offside_avg": offside_total / total_matches if total_matches > 0 else 1.0,
        "late_concede_ratio": late_numerator / late_denominator if late_denominator > 0 else 0.33,
        "goals_per_sot": (
            sum(float(row.get("goals_per_sot", 0.0)) * float(row["match_count"]) for row in selected) / total_matches
            if total_matches > 0
            else 0.4
        ),
        "in_box_shot_ratio": (
            sum(float(row.get("in_box_shot_ratio", 0.0)) * float(row["match_count"]) for row in selected) / total_matches
            if total_matches > 0
            else 0.56
        ),
        "pass_success_rate": (
            sum(float(row.get("pass_success_rate", 0.0)) * float(row["match_count"]) for row in selected) / total_matches
            if total_matches > 0
            else 0.81
        ),
        "through_pass_success_rate": (
            sum(float(row.get("through_pass_success_rate", 0.0)) * float(row["match_count"]) for row in selected) / total_matches
            if total_matches > 0
            else 0.29
        ),
        "tackle_success_rate": (
            sum(float(row.get("tackle_success_rate", 0.0)) * float(row["match_count"]) for row in selected) / total_matches
            if total_matches > 0
            else 0.39
        ),
        "shots_per_match": (
            sum(float(row.get("shots_per_match", 0.0)) * float(row["match_count"]) for row in selected) / total_matches
            if total_matches > 0
            else 7.3
        ),
        "xg_for_per_match": (
            sum(float(row.get("xg_for_per_match", 0.0)) * float(row["match_count"]) for row in selected) / total_matches
            if total_matches > 0
            else 1.45
        ),
        "goals_against_per_match": (
            sum(float(row.get("goals_against_per_match", 0.0)) * float(row["match_count"]) for row in selected) / total_matches
            if total_matches > 0
            else 1.28
        ),
        "possession_avg": (
            sum(float(row.get("possession_avg", 0.0)) * float(row["match_count"]) for row in selected) / total_matches
            if total_matches > 0
            else 50.0
        ),
    }
    return benchmark, {
        "source": OFFICIAL_BENCHMARK_SOURCE,
        "cohort_size": len(selected),
        "note": "official_rankers_top_1vs1_based_benchmark",
        "total_rankers": total_rankers,
        "mapped_ouid_count": mapped_ouid_count,
        "mapped_nickname_count": mapped_nickname_count,
    }


def _similar_rankers(
    target_metrics: dict[str, float],
    top_k: int = 3,
    official_rankers: list[dict[str, Any]] | None = None,
    ranker_profiles: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    if official_rankers is None:
        official_rankers = _load_official_rankers(limit=80)
    official_by_ouid = {str(row["ouid"]): row for row in official_rankers if row.get("ouid")}
    official_by_nickname: dict[str, dict[str, Any]] = {}
    for row in official_rankers:
        normalized_nickname = _normalize_nickname(str(row.get("nickname", "")))
        if not normalized_nickname:
            continue
        official_by_nickname[normalized_nickname] = row
    if not official_by_ouid and not official_by_nickname:
        return []

    if ranker_profiles is None:
        ranker_profiles = [
            profile
            for profile in _collect_user_profiles(match_type=50, limit_rows=3000)
            if str(profile["ouid"]) in official_by_ouid
            or _normalize_nickname(str(profile.get("nickname", ""))) in official_by_nickname
        ]
    else:
        ranker_profiles = [
            profile
            for profile in ranker_profiles
            if str(profile["ouid"]) in official_by_ouid
            or _normalize_nickname(str(profile.get("nickname", ""))) in official_by_nickname
        ]
    pool = [profile for profile in ranker_profiles if float(profile["match_count"]) >= 3.0]
    if len(pool) < 5:
        pool = [profile for profile in ranker_profiles if float(profile["match_count"]) >= 1.0]
    if not pool:
        fallback_candidates: list[dict[str, Any]] = []
        target_win_rate = float(target_metrics.get("win_rate", 0.0))
        for row in official_rankers:
            nickname = str(row.get("nickname", "")).strip()
            if not nickname:
                continue
            rank_no = int(row.get("rank_no", 999999))
            candidate_win_rate = float(row.get("win_rate", 0.0))
            win_gap = round(target_win_rate - candidate_win_rate, 4)
            sample_matches = int(row.get("win_count", 0)) + int(row.get("draw_count", 0)) + int(row.get("loss_count", 0))
            sample_matches = max(1, sample_matches)
            distance = abs(target_win_rate - candidate_win_rate)
            similarity = 1.0 / (1.0 + distance * 4.0)
            fallback_candidates.append(
                {
                    "ranker_proxy_rank": rank_no,
                    "ouid": str(row.get("ouid") or f"nickname:{_normalize_nickname(nickname)}"),
                    "nickname": nickname,
                    "similarity": round(similarity, 4),
                    "match_count": sample_matches,
                    "win_rate": round(candidate_win_rate, 4),
                    "reliability": round(min(0.45, sample_matches / 40.0), 2),
                    "source": f"{OFFICIAL_BENCHMARK_SOURCE}_meta_only",
                    "formation": str(row.get("formation", "")),
                    "team_color": str(row.get("team_color", "")),
                    "gaps": {
                        "win_rate": win_gap,
                    },
                    "metric_comparisons": [
                        {
                            "metric_name": "win_rate",
                            "metric_label": "승률",
                            "higher_is_better": True,
                            "user_value": round(target_win_rate, 4),
                            "candidate_value": round(candidate_win_rate, 4),
                            "gap_value": win_gap,
                        }
                    ],
                }
            )
        fallback_candidates.sort(key=lambda row: (-row["similarity"], row["ranker_proxy_rank"]))
        return fallback_candidates[:top_k]

    def feature_vector(profile: dict[str, Any]) -> list[float]:
        return [
            float(profile["win_rate"]),
            float(profile["shot_on_target_rate"]),
            min(float(profile.get("goals_per_sot", 0.0)), 1.0),
            min(float(profile.get("in_box_shot_ratio", 0.0)), 1.0),
            min(float(profile.get("pass_success_rate", 0.0)), 1.0),
            min(float(profile.get("through_pass_success_rate", 0.0)), 1.0),
            min(float(profile.get("tackle_success_rate", 0.0)), 1.0),
            min(float(profile["offside_avg"]) / 3.0, 1.0),
            float(profile["late_concede_ratio"]),
            min(float(profile["xg_for_per_match"]) / 3.0, 1.0),
        ]

    target_vector = feature_vector(
        {
            "win_rate": target_metrics.get("win_rate", 0.0),
            "shot_on_target_rate": target_metrics.get("shot_on_target_rate", 0.0),
            "goals_per_sot": target_metrics.get("goals_per_sot", 0.0),
            "in_box_shot_ratio": target_metrics.get("in_box_shot_ratio", 0.0),
            "pass_success_rate": target_metrics.get("pass_success_rate", 0.0),
            "through_pass_success_rate": target_metrics.get("through_pass_success_rate", 0.0),
            "tackle_success_rate": target_metrics.get("tackle_success_rate", 0.0),
            "offside_avg": target_metrics.get("offside_avg", 0.0),
            "late_concede_ratio": target_metrics.get("late_concede_ratio", 0.0),
            "xg_for_per_match": target_metrics.get("xg_for", 0.0) / max(1.0, target_metrics.get("match_count", 1.0)),
        }
    )

    similar: list[dict[str, Any]] = []
    for candidate in pool:
        candidate_vector = feature_vector(candidate)
        distance = sum((left - right) ** 2 for left, right in zip(target_vector, candidate_vector)) ** 0.5
        similarity = 1.0 / (1.0 + distance)
        normalized_nickname = _normalize_nickname(str(candidate.get("nickname", "")))
        meta = official_by_ouid.get(str(candidate["ouid"])) or official_by_nickname.get(normalized_nickname, {})
        rank_no = int(meta.get("rank_no", 999999))
        target_xg_per_match = target_metrics.get("xg_for", 0.0) / max(1.0, target_metrics.get("match_count", 1.0))
        similar.append(
            {
                "ranker_proxy_rank": rank_no,
                "ouid": str(meta.get("ouid") or candidate["ouid"] or f"nickname:{normalized_nickname}"),
                "nickname": str(meta.get("nickname", candidate.get("nickname", ""))),
                "similarity": round(similarity, 4),
                "match_count": int(candidate["match_count"]),
                "win_rate": round(float(candidate["win_rate"]), 4),
                "reliability": round(min(1.0, float(candidate["match_count"]) / 15.0), 2),
                "source": OFFICIAL_BENCHMARK_SOURCE if meta.get("ouid") else f"{OFFICIAL_BENCHMARK_SOURCE}_nickname_proxy",
                "formation": str(meta.get("formation", "")),
                "team_color": str(meta.get("team_color", "")),
                "gaps": {
                    "win_rate": round(float(target_metrics.get("win_rate", 0.0)) - float(candidate["win_rate"]), 4),
                    "shot_on_target_rate": round(float(target_metrics.get("shot_on_target_rate", 0.0)) - float(candidate["shot_on_target_rate"]), 4),
                    "goals_per_sot": round(float(target_metrics.get("goals_per_sot", 0.0)) - float(candidate.get("goals_per_sot", 0.0)), 4),
                    "in_box_shot_ratio": round(
                        float(target_metrics.get("in_box_shot_ratio", 0.0)) - float(candidate.get("in_box_shot_ratio", 0.0)),
                        4,
                    ),
                    "pass_success_rate": round(
                        float(target_metrics.get("pass_success_rate", 0.0)) - float(candidate.get("pass_success_rate", 0.0)),
                        4,
                    ),
                    "through_pass_success_rate": round(
                        float(target_metrics.get("through_pass_success_rate", 0.0))
                        - float(candidate.get("through_pass_success_rate", 0.0)),
                        4,
                    ),
                    "tackle_success_rate": round(
                        float(target_metrics.get("tackle_success_rate", 0.0)) - float(candidate.get("tackle_success_rate", 0.0)),
                        4,
                    ),
                    "offside_avg": round(float(target_metrics.get("offside_avg", 0.0)) - float(candidate["offside_avg"]), 4),
                    "late_concede_ratio": round(float(target_metrics.get("late_concede_ratio", 0.0)) - float(candidate["late_concede_ratio"]), 4),
                    "xg_for_per_match": round(target_xg_per_match - float(candidate["xg_for_per_match"]), 4),
                },
                "metric_comparisons": [
                    {
                        "metric_name": "win_rate",
                        "metric_label": "승률",
                        "higher_is_better": True,
                        "user_value": round(float(target_metrics.get("win_rate", 0.0)), 4),
                        "candidate_value": round(float(candidate["win_rate"]), 4),
                        "gap_value": round(float(target_metrics.get("win_rate", 0.0)) - float(candidate["win_rate"]), 4),
                    },
                    {
                        "metric_name": "shot_on_target_rate",
                        "metric_label": "유효슈팅 비율",
                        "higher_is_better": True,
                        "user_value": round(float(target_metrics.get("shot_on_target_rate", 0.0)), 4),
                        "candidate_value": round(float(candidate["shot_on_target_rate"]), 4),
                        "gap_value": round(float(target_metrics.get("shot_on_target_rate", 0.0)) - float(candidate["shot_on_target_rate"]), 4),
                    },
                    {
                        "metric_name": "goals_per_sot",
                        "metric_label": "유효슈팅 대비 득점률",
                        "higher_is_better": True,
                        "user_value": round(float(target_metrics.get("goals_per_sot", 0.0)), 4),
                        "candidate_value": round(float(candidate.get("goals_per_sot", 0.0)), 4),
                        "gap_value": round(
                            float(target_metrics.get("goals_per_sot", 0.0)) - float(candidate.get("goals_per_sot", 0.0)),
                            4,
                        ),
                    },
                    {
                        "metric_name": "in_box_shot_ratio",
                        "metric_label": "박스 안 슈팅 비중",
                        "higher_is_better": True,
                        "user_value": round(float(target_metrics.get("in_box_shot_ratio", 0.0)), 4),
                        "candidate_value": round(float(candidate.get("in_box_shot_ratio", 0.0)), 4),
                        "gap_value": round(
                            float(target_metrics.get("in_box_shot_ratio", 0.0))
                            - float(candidate.get("in_box_shot_ratio", 0.0)),
                            4,
                        ),
                    },
                    {
                        "metric_name": "offside_avg",
                        "metric_label": "오프사이드 평균",
                        "higher_is_better": False,
                        "user_value": round(float(target_metrics.get("offside_avg", 0.0)), 4),
                        "candidate_value": round(float(candidate["offside_avg"]), 4),
                        "gap_value": round(float(target_metrics.get("offside_avg", 0.0)) - float(candidate["offside_avg"]), 4),
                    },
                    {
                        "metric_name": "pass_success_rate",
                        "metric_label": "패스 성공률",
                        "higher_is_better": True,
                        "user_value": round(float(target_metrics.get("pass_success_rate", 0.0)), 4),
                        "candidate_value": round(float(candidate.get("pass_success_rate", 0.0)), 4),
                        "gap_value": round(
                            float(target_metrics.get("pass_success_rate", 0.0)) - float(candidate.get("pass_success_rate", 0.0)),
                            4,
                        ),
                    },
                    {
                        "metric_name": "through_pass_success_rate",
                        "metric_label": "스루패스 성공률",
                        "higher_is_better": True,
                        "user_value": round(float(target_metrics.get("through_pass_success_rate", 0.0)), 4),
                        "candidate_value": round(float(candidate.get("through_pass_success_rate", 0.0)), 4),
                        "gap_value": round(
                            float(target_metrics.get("through_pass_success_rate", 0.0))
                            - float(candidate.get("through_pass_success_rate", 0.0)),
                            4,
                        ),
                    },
                    {
                        "metric_name": "tackle_success_rate",
                        "metric_label": "태클 성공률",
                        "higher_is_better": True,
                        "user_value": round(float(target_metrics.get("tackle_success_rate", 0.0)), 4),
                        "candidate_value": round(float(candidate.get("tackle_success_rate", 0.0)), 4),
                        "gap_value": round(
                            float(target_metrics.get("tackle_success_rate", 0.0)) - float(candidate.get("tackle_success_rate", 0.0)),
                            4,
                        ),
                    },
                    {
                        "metric_name": "late_concede_ratio",
                        "metric_label": "후반 실점 비율",
                        "higher_is_better": False,
                        "user_value": round(float(target_metrics.get("late_concede_ratio", 0.0)), 4),
                        "candidate_value": round(float(candidate["late_concede_ratio"]), 4),
                        "gap_value": round(float(target_metrics.get("late_concede_ratio", 0.0)) - float(candidate["late_concede_ratio"]), 4),
                    },
                    {
                        "metric_name": "xg_for_per_match",
                        "metric_label": "경기당 xG",
                        "higher_is_better": True,
                        "user_value": round(target_xg_per_match, 4),
                        "candidate_value": round(float(candidate["xg_for_per_match"]), 4),
                        "gap_value": round(target_xg_per_match - float(candidate["xg_for_per_match"]), 4),
                    },
                ],
            }
        )

    similar.sort(key=lambda row: (-row["similarity"], row["ranker_proxy_rank"]))
    return similar[:top_k]


def list_match_stats(ouid: str, match_type: int) -> list[MatchStats]:
    conn = connect()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT payload_json
            FROM matches_raw
            WHERE ouid = ? AND match_type = ?
            ORDER BY match_date DESC, id DESC
            """,
            (ouid, match_type),
        )
        stats: list[MatchStats] = []
        for row in cur.fetchall():
            payload = json.loads(row["payload_json"])
            parsed = _extract_user_match(payload, ouid)
            if parsed is not None:
                stats.append(parsed)
        return stats
    finally:
        conn.close()


def _list_match_stats_from_cache(ouid: str, match_type: int) -> list[MatchStats]:
    payload = _MATCH_CACHE.get_json(_match_cache_key(ouid, match_type))
    if not isinstance(payload, list):
        return []
    stats: list[MatchStats] = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        raw_payload = row.get("payload")
        if not isinstance(raw_payload, dict):
            continue
        parsed = _extract_user_match(raw_payload, ouid)
        if parsed is not None:
            stats.append(parsed)
    return stats


def _save_match_rows_to_cache(ouid: str, match_type: int, match_rows: list[dict[str, Any]]) -> None:
    if not match_rows:
        return
    _MATCH_CACHE.set_json(_match_cache_key(ouid, match_type), match_rows[:120], ttl_sec=_match_cache_ttl_sec())


def _latest_known_match_ids(ouid: str, match_type: int, limit: int) -> list[str]:
    conn = connect()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT match_id
            FROM matches_raw
            WHERE ouid = ? AND match_type = ?
            ORDER BY match_date DESC, id DESC
            LIMIT ?
            """,
            (ouid, match_type, limit),
        )
        return [str(row["match_id"]) for row in cur.fetchall() if row["match_id"]]
    finally:
        conn.close()


def _detect_new_match_head(ouid: str, match_type: int, known_match_ids: set[str]) -> bool:
    if not known_match_ids:
        return True
    cache_key = f"match_head_probe:{ouid}:{match_type}"
    cached = _MATCH_CACHE.get_json(cache_key)
    if isinstance(cached, dict):
        latest_match_id = str(cached.get("latest_match_id", "")).strip()
        if latest_match_id:
            return latest_match_id not in known_match_ids
    api = NexonOpenApiClient(timeout_sec=8, retries=1)
    latest_ids = api.fetch_match_ids(ouid=ouid, match_type=match_type, limit=min(max(len(known_match_ids) + 1, 3), 10))
    latest_match_id = latest_ids[0] if latest_ids else ""
    _MATCH_CACHE.set_json(
        cache_key,
        {"latest_match_id": latest_match_id, "checked_at": utc_now_iso()},
        ttl_sec=MATCH_HEAD_PROBE_TTL_SEC,
    )
    return bool(latest_match_id and latest_match_id not in known_match_ids)


def _refresh_match_rows(
    ouid: str,
    match_type: int,
    window_size: int,
    existing_rows: list[MatchStats],
) -> tuple[list[MatchStats], int]:
    api = NexonOpenApiClient(timeout_sec=15, retries=2)
    has_enough_rows = len(existing_rows) >= max(window_size, 12)
    known_match_ids = set(_latest_known_match_ids(ouid, match_type, limit=max(window_size, 12))) if existing_rows else set()
    refreshed_match_rows = 0
    sync_error: Exception | None = None
    for fetch_limit in _sync_fetch_limits(window_size=window_size, has_cached_rows=bool(existing_rows)):
        try:
            if known_match_ids and has_enough_rows:
                match_rows = api.collect_incremental_match_rows(
                    ouid=ouid,
                    match_type=match_type,
                    known_match_ids=known_match_ids,
                    limit=fetch_limit,
                )
            else:
                match_rows = api.collect_match_rows(ouid=ouid, match_type=match_type, limit=fetch_limit)
            if match_rows:
                refreshed_match_rows = upsert_matches(ouid=ouid, match_type=match_type, rows=match_rows)
                _save_match_rows_to_cache(ouid, match_type, match_rows)
            rows = list_match_stats(ouid, match_type)
            if not rows:
                rows = _list_match_stats_from_cache(ouid, match_type)
            sync_error = None
            return rows, refreshed_match_rows
        except requests.HTTPError as exc:
            sync_error = exc
            status_code = exc.response.status_code if exc.response is not None else None
            if status_code == 429:
                continue
            raise
    if sync_error is not None:
        raise sync_error
    return existing_rows, refreshed_match_rows


def _load_rows_for_analysis(
    ouid: str,
    match_type: int,
    window_size: int,
    live_sync_enabled: bool,
    manual_refresh_probe: bool = False,
) -> tuple[list[MatchStats], int, str | None, bool]:
    db_rows = list_match_stats(ouid, match_type)
    cache_rows = _list_match_stats_from_cache(ouid, match_type) if not db_rows else []
    rows = db_rows or cache_rows
    refreshed_match_rows = 0
    refresh_warning: str | None = None
    using_cache_only = not db_rows and bool(cache_rows)
    latest_before = rows[0].match_date if rows else None
    latest_before_dt = _parse_iso_datetime(latest_before) if latest_before else None
    should_refresh = not rows or using_cache_only
    if rows and latest_before_dt is not None:
        should_refresh = should_refresh or (datetime.now(timezone.utc) - latest_before_dt >= MATCH_REFRESH_THRESHOLD)
    if rows and latest_before_dt is None:
        should_refresh = True
    if len(rows) < max(window_size, 12):
        should_refresh = True
    if manual_refresh_probe and rows and live_sync_enabled and not should_refresh:
        try:
            known_match_ids = set(_latest_known_match_ids(ouid, match_type, limit=max(window_size, 12)))
            should_refresh = _detect_new_match_head(ouid=ouid, match_type=match_type, known_match_ids=known_match_ids)
        except OpenApiRateLimitError as exc:
            wait_seconds = int(round(exc.wait_seconds or 0))
            refresh_warning = (
                f"Nexon Open API 호출 제한으로 최신 동기화 여부를 확인하지 못했습니다. "
                f"{wait_seconds}초 후 다시 시도해주세요."
                if wait_seconds > 0
                else "Nexon Open API 호출 제한으로 최신 동기화 여부를 확인하지 못했습니다. 잠시 후 다시 시도해주세요."
            )
        except Exception:
            pass

    if should_refresh and live_sync_enabled:
        try:
            rows, refreshed_match_rows = _refresh_match_rows(
                ouid=ouid,
                match_type=match_type,
                window_size=window_size,
                existing_rows=rows,
            )
        except OpenApiRateLimitError as exc:
            wait_seconds = int(round(exc.wait_seconds or 0))
            refresh_warning = (
                f"Nexon Open API 호출 제한으로 최신 동기화에 실패했습니다. "
                f"{wait_seconds}초 후 다시 시도해주세요."
                if wait_seconds > 0
                else "Nexon Open API 호출 제한으로 최신 동기화에 실패했습니다. 잠시 후 다시 시도해주세요."
            )
            rows = list_match_stats(ouid, match_type)
            if not rows:
                rows = _list_match_stats_from_cache(ouid, match_type)
        except requests.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else None
            api_error_name = ""
            api_error_message = ""
            if exc.response is not None:
                try:
                    payload = exc.response.json()
                    if isinstance(payload, dict):
                        err = payload.get("error")
                        if isinstance(err, dict):
                            api_error_name = str(err.get("name", "")).strip()
                            api_error_message = str(err.get("message", "")).strip()
                except Exception:
                    pass
            if status_code == 429:
                refresh_warning = "Nexon Open API 호출 제한(429)으로 최신 동기화에 실패했습니다. 잠시 후 재시도해주세요."
            elif status_code is not None and status_code >= 500:
                refresh_warning = f"Nexon Open API 서버 응답 오류({status_code})로 최신 동기화에 실패했습니다."
            elif status_code is not None:
                refresh_warning = f"Nexon Open API 요청 오류({status_code})로 최신 동기화에 실패했습니다."
            else:
                refresh_warning = "Nexon Open API 통신 오류로 최신 동기화에 실패했습니다."
            if api_error_name or api_error_message:
                detail_parts = [part for part in (api_error_name, api_error_message) if part]
                refresh_warning = f"{refresh_warning} [{' / '.join(detail_parts)}]"
            rows = list_match_stats(ouid, match_type)
            if not rows:
                rows = _list_match_stats_from_cache(ouid, match_type)
        except Exception as exc:
            refresh_warning = (
                "최신 경기 동기화에 실패해 저장된 데이터로 분석했습니다."
                f" ({type(exc).__name__})"
            )
            rows = list_match_stats(ouid, match_type)
            if not rows:
                rows = _list_match_stats_from_cache(ouid, match_type)
    elif should_refresh and not rows:
        refresh_warning = "저장된 경기 데이터가 없어 최신 동기화가 필요합니다. 잠시 후 다시 시도해주세요."

    if not rows and refresh_warning:
        refresh_warning = f"{refresh_warning} 해당 모드에서 저장된 경기 데이터가 없습니다."
    if not rows and not refresh_warning:
        refresh_warning = "해당 모드에서 조회 가능한 경기 데이터가 없습니다."
    return rows, refreshed_match_rows, refresh_warning, should_refresh


def run_analysis(
    ouid: str,
    match_type: int,
    window_size: int,
    current_tactic: dict[str, Any] | None = None,
    force_bootstrap_sync: bool = False,
    manual_refresh_probe: bool = False,
) -> dict[str, Any]:
    tactic_input_known = isinstance(current_tactic, dict) and len(current_tactic) > 0
    live_sync_enabled = (
        force_bootstrap_sync
        or manual_refresh_probe
        or _is_truthy(os.getenv("HABIT_LAB_ENABLE_LIVE_MATCH_SYNC", "0"))
    )
    rows, refreshed_match_rows, refresh_warning, should_refresh = _load_rows_for_analysis(
        ouid=ouid,
        match_type=match_type,
        window_size=window_size,
        live_sync_enabled=live_sync_enabled,
        manual_refresh_probe=manual_refresh_probe,
    )
    playable_controllers = {"keyboard", "gamepad"}
    playable_rows = [row for row in rows if row.controller.strip().lower() in playable_controllers]
    use_playable_only = len(playable_rows) >= min(5, window_size)
    base_rows = playable_rows if use_playable_only else rows
    selected = base_rows[:window_size]
    metrics = _compute_metrics(selected)
    visuals = _build_visual_summary(selected)
    official_rankers = _load_official_rankers(limit=80)
    official_ranker_ouids = {str(row["ouid"]) for row in official_rankers if row.get("ouid")}
    official_ranker_nicknames = set()
    for row in official_rankers:
        normalized_nickname = _normalize_nickname(str(row.get("nickname", "")))
        if normalized_nickname:
            official_ranker_nicknames.add(normalized_nickname)
    ranker_profiles: list[dict[str, Any]] = []
    if official_ranker_ouids or official_ranker_nicknames:
        profiles = _collect_user_profiles(match_type=50, limit_rows=3000)
        ranker_profiles = [
            profile
            for profile in profiles
            if str(profile["ouid"]) in official_ranker_ouids
            or _normalize_nickname(str(profile.get("nickname", ""))) in official_ranker_nicknames
        ]

    benchmark, benchmark_meta = _resolve_benchmark(
        match_type=match_type,
        official_rankers=official_rankers,
        ranker_profiles=ranker_profiles,
    )
    benchmark_source = str(benchmark_meta.get("source", STATIC_BENCHMARK_SOURCE))
    metric_gap_table = _metric_gap_table(metrics, benchmark, benchmark_source)
    issues = _issue_scores(metrics, benchmark)
    similar_rankers = _similar_rankers(
        target_metrics=metrics,
        top_k=3,
        official_rankers=official_rankers,
        ranker_profiles=ranker_profiles,
    )
    created_at = utc_now_iso()

    actions = []
    if metrics["match_count"] < 5:
        actions.append(
            {
                "rank": 1,
                "action_code": "INSUFFICIENT_DATA",
                "title": "안정 진단을 위한 표본 부족",
                "description": "선택한 모드에서 최소 5경기 이상 수집 후 전술 변경을 권장합니다.",
                "evidence": {
                    "required_match_count": 5,
                    "current_match_count": metrics["match_count"],
                    "metric_gap_table": metric_gap_table,
                    "benchmark_meta": benchmark_meta,
                    "similar_rankers": similar_rankers,
                },
                "tactic_direction": "표본 확보 우선",
                "tactic_delta": {},
                "confidence": 0.0,
            }
        )
    else:
        ranked = sorted(issues.items(), key=lambda item: item[1], reverse=True)
        actionable = [(issue_code, score) for issue_code, score in ranked if score >= ISSUE_MIN_ACTION_SCORE][:3]
        if not actionable:
            actions.append(_maintain_action(metrics, benchmark_source, metric_gap_table))
        else:
            for idx, (issue_code, issue_score) in enumerate(actionable, start=1):
                direction, delta = _apply_tactic_delta(issue_code, current_tactic)
                confidence_detail = _confidence_detail(
                    metrics["match_count"],
                    issue_score,
                    tactic_input_known=tactic_input_known,
                )
                benchmark_compare = _benchmark_compare(issue_code, metrics, benchmark, benchmark_source)
                coach_explanation = build_action_explanation(
                    issue_code=issue_code,
                    issue_label=_issue_label(issue_code),
                    benchmark_compare=benchmark_compare,
                    tactic_delta=delta,
                    tactic_input_known=tactic_input_known,
                )
                description = (
                    f"다음 5경기 동안 '{_issue_label(issue_code)}' 개선을 최우선으로 적용하세요."
                    if tactic_input_known
                    else f"다음 5경기 동안 '{_issue_label(issue_code)}' 개선을 위한 테스트 플랜으로 적용하세요."
                )
                actions.append(
                    {
                        "rank": idx,
                        "action_code": issue_code,
                        "title": _issue_label(issue_code),
                        "description": description,
                        "evidence": {
                            "issue_score": issue_score,
                            "benchmark": benchmark,
                            "benchmark_meta": benchmark_meta,
                            "benchmark_compare": benchmark_compare,
                            "metric_gap_table": metric_gap_table,
                            "confidence_detail": confidence_detail,
                            "coach_explanation": coach_explanation,
                            "similar_rankers": similar_rankers,
                            "metrics": metrics,
                            "tactic_input_mode": "provided" if tactic_input_known else "missing",
                        },
                        "tactic_direction": direction,
                        "tactic_delta": delta,
                        "confidence": confidence_detail["final_confidence"],
                    }
                )

    conn = connect()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO user_metrics_snapshot (
                ouid, match_type, window_size, match_count, win_rate, goals_for, goals_against,
                xg_for, xg_against, issue_scores_json, kpis_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ouid,
                match_type,
                window_size,
                int(metrics["match_count"]),
                metrics["win_rate"],
                metrics["goals_for"],
                metrics["goals_against"],
                metrics["xg_for"],
                metrics["xg_against"],
                json.dumps(issues, ensure_ascii=True),
                json.dumps(metrics, ensure_ascii=True),
                created_at,
            ),
        )
        cur.execute(
            "DELETE FROM action_cards WHERE ouid = ? AND match_type = ? AND window_size = ?",
            (ouid, match_type, window_size),
        )
        for action in actions:
            cur.execute(
                """
                INSERT INTO action_cards (
                    ouid, match_type, window_size, action_rank, action_code, title, description,
                    evidence_json, tactic_direction, tactic_delta_json, confidence, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ouid,
                    match_type,
                    window_size,
                    action["rank"],
                    action["action_code"],
                    action["title"],
                    action["description"],
                    json.dumps(action["evidence"], ensure_ascii=True),
                    action["tactic_direction"],
                    json.dumps(action["tactic_delta"], ensure_ascii=True),
                    action["confidence"],
                    created_at,
                ),
            )
        conn.commit()
    finally:
        conn.close()

    return {
        "ouid": ouid,
        "match_type": match_type,
        "window_size": window_size,
        "sample_scope": "playable_only" if use_playable_only else "all_controllers",
        "sample_count": len(selected),
        "tactic_input_mode": "provided" if tactic_input_known else "missing",
        "latest_match_date": (
            selected[0].match_date
            if selected
            else (base_rows[0].match_date if base_rows else (rows[0].match_date if rows else None))
        ),
        "recent_matches": _recent_match_summary(selected if selected else base_rows),
        "sync_attempted": should_refresh,
        "sync_new_rows": refreshed_match_rows,
        "sync_warning": refresh_warning,
        "created_at": created_at,
        "benchmark": benchmark,
        "benchmark_meta": benchmark_meta,
        "metric_gap_table": metric_gap_table,
        "similar_rankers": similar_rankers,
        "metrics": metrics,
        "visuals": visuals,
        "issues": issues,
        "actions": actions,
    }


def get_latest_analysis(ouid: str, match_type: int, window_size: int) -> dict[str, Any] | None:
    conn = connect()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT *
            FROM user_metrics_snapshot
            WHERE ouid = ? AND match_type = ? AND window_size = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            """,
            (ouid, match_type, window_size),
        )
        row = cur.fetchone()
        if row is None:
            return None
        rows = list_match_stats(ouid, match_type)
        if not rows:
            rows = _list_match_stats_from_cache(ouid, match_type)
        playable_controllers = {"keyboard", "gamepad"}
        playable_rows = [item for item in rows if item.controller.strip().lower() in playable_controllers]
        base_rows = playable_rows if len(playable_rows) >= min(5, window_size) else rows
        selected = base_rows[:window_size]
        return {
            "ouid": row["ouid"],
            "match_type": row["match_type"],
            "window_size": row["window_size"],
            "match_count": row["match_count"],
            "win_rate": row["win_rate"],
            "goals_for": row["goals_for"],
            "goals_against": row["goals_against"],
            "xg_for": row["xg_for"],
            "xg_against": row["xg_against"],
            "issue_scores": json.loads(row["issue_scores_json"]),
            "kpis": json.loads(row["kpis_json"]),
            "created_at": row["created_at"],
            "latest_match_date": (
                selected[0].match_date
                if selected
                else (base_rows[0].match_date if base_rows else (rows[0].match_date if rows else None))
            ),
            "recent_matches": _recent_match_summary(selected if selected else base_rows),
        }
    finally:
        conn.close()


def get_latest_actions(ouid: str, match_type: int, window_size: int) -> list[dict[str, Any]]:
    conn = connect()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT *
            FROM action_cards
            WHERE ouid = ? AND match_type = ? AND window_size = ?
            ORDER BY created_at DESC, action_rank ASC
            """,
            (ouid, match_type, window_size),
        )
        rows = cur.fetchall()
        return [
            {
                "action_rank": row["action_rank"],
                "action_code": row["action_code"],
                "title": row["title"],
                "description": row["description"],
                "evidence": json.loads(row["evidence_json"]),
                "tactic_direction": row["tactic_direction"],
                "tactic_delta": json.loads(row["tactic_delta_json"]),
                "confidence": row["confidence"],
                "created_at": row["created_at"],
            }
            for row in rows
        ]
    finally:
        conn.close()


def create_experiment(payload: dict[str, Any]) -> dict[str, Any]:
    run_id = str(uuid.uuid4())
    started_at = payload.get("started_at") or utc_now_iso()
    conn = connect()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO experiment_runs (
              id, ouid, match_type, action_code, action_title, window_size,
              started_at, ended_at, status, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                payload["ouid"],
                payload["match_type"],
                payload["action_code"],
                payload["action_title"],
                payload["window_size"],
                started_at,
                payload.get("ended_at"),
                "running" if not payload.get("ended_at") else "completed",
                payload.get("notes"),
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return {"experiment_id": run_id, "status": "created"}


def evaluate_latest_experiment(ouid: str, match_type: int) -> dict[str, Any] | None:
    conn = connect()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT *
            FROM experiment_runs
            WHERE ouid = ? AND match_type = ?
            ORDER BY started_at DESC
            LIMIT 1
            """,
            (ouid, match_type),
        )
        run = cur.fetchone()
        if run is None:
            return None
        window_size = int(run["window_size"])
        started_at = str(run["started_at"])
        live_sync_enabled = _is_truthy(os.getenv("HABIT_LAB_ENABLE_LIVE_MATCH_SYNC", "0"))
        rows = list_match_stats(ouid, match_type)
        if not rows:
            rows = _list_match_stats_from_cache(ouid, match_type)
        refreshed_match_rows = 0
        refresh_warning: str | None = None
        latest_before = rows[0].match_date if rows else None
        latest_before_dt = _parse_iso_datetime(latest_before) if latest_before else None
        should_refresh = not rows
        if rows and latest_before_dt is not None:
            should_refresh = datetime.now(timezone.utc) - latest_before_dt >= MATCH_REFRESH_THRESHOLD
        if rows and latest_before_dt is None:
            should_refresh = True
        if len(rows) < max(window_size, 12):
            should_refresh = True

        if should_refresh and live_sync_enabled:
            try:
                api = NexonOpenApiClient(timeout_sec=15, retries=2)
                sync_error: Exception | None = None
                for fetch_limit in _sync_fetch_limits(window_size=window_size, has_cached_rows=bool(rows)):
                    try:
                        match_rows = api.collect_match_rows(ouid=ouid, match_type=match_type, limit=fetch_limit)
                        if match_rows:
                            refreshed_match_rows = upsert_matches(ouid=ouid, match_type=match_type, rows=match_rows)
                            _save_match_rows_to_cache(ouid, match_type, match_rows)
                            rows = list_match_stats(ouid, match_type)
                            if not rows:
                                rows = _list_match_stats_from_cache(ouid, match_type)
                        sync_error = None
                        break
                    except requests.HTTPError as exc:
                        sync_error = exc
                        status_code = exc.response.status_code if exc.response is not None else None
                        if status_code == 429:
                            continue
                        raise
                if sync_error is not None:
                    raise sync_error
            except OpenApiRateLimitError as exc:
                wait_seconds = int(round(exc.wait_seconds or 0))
                refresh_warning = (
                    f"Nexon Open API 호출 제한으로 최신 동기화에 실패했습니다. "
                    f"{wait_seconds}초 후 다시 시도해주세요."
                    if wait_seconds > 0
                    else "Nexon Open API 호출 제한으로 최신 동기화에 실패했습니다. 잠시 후 다시 시도해주세요."
                )
                rows = list_match_stats(ouid, match_type)
                if not rows:
                    rows = _list_match_stats_from_cache(ouid, match_type)
            except requests.HTTPError as exc:
                status_code = exc.response.status_code if exc.response is not None else None
                if status_code == 429:
                    refresh_warning = "Nexon Open API 호출 제한(429)으로 최신 동기화에 실패했습니다. 잠시 후 재시도해주세요."
                elif status_code is not None and status_code >= 500:
                    refresh_warning = f"Nexon Open API 서버 응답 오류({status_code})로 최신 동기화에 실패했습니다."
                elif status_code is not None:
                    refresh_warning = f"Nexon Open API 요청 오류({status_code})로 최신 동기화에 실패했습니다."
                else:
                    refresh_warning = "Nexon Open API 통신 오류로 최신 동기화에 실패했습니다."
                rows = list_match_stats(ouid, match_type)
                if not rows:
                    rows = _list_match_stats_from_cache(ouid, match_type)
            except Exception as exc:
                refresh_warning = (
                    "최신 경기 동기화에 실패해 저장된 데이터로 평가했습니다."
                    f" ({type(exc).__name__})"
                )
                rows = list_match_stats(ouid, match_type)
                if not rows:
                    rows = _list_match_stats_from_cache(ouid, match_type)
        elif should_refresh and not rows:
            refresh_warning = "저장된 경기 데이터가 없어 최신 동기화가 필요합니다. 잠시 후 다시 시도해주세요."
        if not rows and refresh_warning:
            refresh_warning = f"{refresh_warning} 해당 모드에서 저장된 경기 데이터가 없습니다."
        if not rows and not refresh_warning:
            refresh_warning = "해당 모드에서 조회 가능한 경기 데이터가 없습니다."

        playable_controllers = {"keyboard", "gamepad"}
        playable_rows = [row for row in rows if row.controller.strip().lower() in playable_controllers]
        use_playable_only = len(playable_rows) >= min(5, window_size)
        base_rows = playable_rows if use_playable_only else rows

        started_at_dt = _parse_iso_datetime(started_at)
        if started_at_dt is None:
            pre_rows = [row for row in base_rows if row.match_date < started_at][:window_size]
            post_rows = [row for row in base_rows if row.match_date >= started_at][:window_size]
        else:
            pre_rows = []
            post_rows = []
            for row in base_rows:
                row_dt = _parse_iso_datetime(row.match_date)
                if row_dt is None:
                    continue
                if row_dt < started_at_dt:
                    pre_rows.append(row)
                else:
                    post_rows.append(row)
            pre_rows = pre_rows[:window_size]
            post_rows = post_rows[:window_size]

        if not post_rows:
            missing_post_message = "실험 시작 이후 수집된 경기가 아직 없어 POST 구간 지표가 0으로 표시됩니다."
            refresh_warning = f"{refresh_warning} {missing_post_message}".strip() if refresh_warning else missing_post_message

        pre = _compute_metrics(pre_rows)
        post = _compute_metrics(post_rows)
        delta = {
            key: round(post[key] - pre[key], 4)
            for key in ("win_rate", "goals_for", "goals_against", "xg_for", "xg_against", "shot_on_target_rate", "offside_avg")
        }

        evaluated_at = utc_now_iso()
        cur.execute(
            """
            INSERT INTO experiment_eval (
              experiment_id, ouid, match_type, pre_window_json, post_window_json, delta_json, evaluated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run["id"],
                ouid,
                match_type,
                json.dumps(pre, ensure_ascii=True),
                json.dumps(post, ensure_ascii=True),
                json.dumps(delta, ensure_ascii=True),
                evaluated_at,
            ),
        )
        conn.commit()
        return {
            "experiment_id": run["id"],
            "window_size": window_size,
            "started_at": started_at,
            "sample_scope": "playable_only" if use_playable_only else "all_controllers",
            "pre_match_count": len(pre_rows),
            "post_match_count": len(post_rows),
            "sync_attempted": should_refresh,
            "sync_new_rows": refreshed_match_rows,
            "sync_warning": refresh_warning,
            "pre": pre,
            "post": post,
            "delta": delta,
            "evaluated_at": evaluated_at,
        }
    finally:
        conn.close()
