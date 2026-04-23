from __future__ import annotations

from typing import Any


def normalize_tactic_style_name(value: Any) -> str:
    style = str(value or "").strip()
    if style == "느린 빌드업":
        return "짧은 패스"
    return style


def with_legacy_buildup_target(delta: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(delta)
    if isinstance(normalized.get("buildup_play_style_target"), str):
        normalized["buildup_play_style_target"] = normalize_tactic_style_name(normalized["buildup_play_style_target"])
        normalized.setdefault("buildup_style_target", normalized["buildup_play_style_target"])
    elif isinstance(normalized.get("buildup_style_target"), str):
        normalized["buildup_style_target"] = normalize_tactic_style_name(normalized["buildup_style_target"])
        normalized.setdefault("buildup_play_style_target", normalized["buildup_style_target"])
    return normalized


ISSUE_TACTIC_MAPPINGS: dict[str, tuple[str, dict[str, Any]]] = {
    "HIGH_LATE_CONCEDE": (
        "Stabilize defensive block in late game",
        {"defense_style_target": "후퇴", "defense_depth_delta": -1, "defense_width_delta": -1, "cdm_stay_back": True},
    ),
    "LOW_FINISHING": (
        "Prioritize high-quality shots in box",
        {"buildup_play_style_target": "밸런스", "chance_creation_style_target": "밸런스", "box_players_delta": 1, "attack_width_delta": -1},
    ),
    "POOR_SHOT_SELECTION": (
        "Reduce low-value shots and improve build-up patience",
        {"buildup_play_style_target": "짧은 패스", "chance_creation_style_target": "밸런스", "box_players_delta": -1, "attack_width_delta": -1},
    ),
    "OFFSIDE_RISK": (
        "Delay forward runs and reduce risky through balls",
        {"attack_width_delta": -1, "quick_attack_off": ["박스 안 침투", "스트라이커 추가"]},
    ),
    "BUILDUP_INEFFICIENCY": (
        "Improve passing stability before final third",
        {"buildup_play_style_target": "짧은 패스", "chance_creation_style_target": "밸런스", "attack_width_delta": -1, "box_players_delta": -1},
    ),
    "DEFENSE_DUEL_WEAKNESS": (
        "Reinforce first defensive contact and line compactness",
        {"defense_style_target": "밸런스", "defense_width_delta": -1, "defense_depth_delta": -1},
    ),
    "CHANCE_CREATION_LOW": (
        "Increase chance volume with wider attack and more box entries",
        {"buildup_play_style_target": "밸런스", "chance_creation_style_target": "긴 패스", "attack_width_delta": 1, "box_players_delta": 1},
    ),
    "POSSESSION_CONTROL_RISK": (
        "Stabilize possession with safer circulation",
        {"buildup_play_style_target": "짧은 패스", "chance_creation_style_target": "밸런스", "attack_width_delta": -1},
    ),
}


def get_issue_tactic_mapping(issue_code: str) -> tuple[str, dict[str, Any]]:
    direction, delta = ISSUE_TACTIC_MAPPINGS[issue_code]
    return direction, with_legacy_buildup_target(delta)
