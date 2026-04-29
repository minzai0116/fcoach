from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable

from app.services.analysis_models import MatchStats


def compute_metrics(matches: Iterable[MatchStats]) -> dict[str, float]:
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


def time_bucket_counts(minutes: Iterable[float]) -> list[dict[str, Any]]:
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
    return [{"label": label, "count": counts[idx]} for idx, (_, _, label) in enumerate(buckets)]


def shot_zone_summary(points: list[dict[str, float | bool]]) -> dict[str, float]:
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


def goal_type_summary(type_codes: list[int]) -> list[dict[str, Any]]:
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


def goal_profile_summary(rows: list[MatchStats]) -> dict[str, Any]:
    total_goals = sum(row.goals_for for row in rows)
    heading_goals = sum(row.goals_heading for row in rows)
    freekick_goals = sum(row.goals_freekick for row in rows)
    penaltykick_goals = sum(row.goals_penaltykick for row in rows)
    in_penalty_goals = sum(row.goals_in_penalty for row in rows)
    out_penalty_goals = sum(row.goals_out_penalty for row in rows)

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
        "footedness_note": "FC Online Open API는 득점의 왼발/오른발 구분 필드를 직접 제공하지 않습니다.",
    }


def _is_in_box(x_value: float, y_value: float) -> bool:
    return 13.0 <= x_value <= 87.0 and y_value >= 73.0


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
