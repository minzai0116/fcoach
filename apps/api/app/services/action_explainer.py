from __future__ import annotations

import json
import os
from typing import Any

import requests


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except Exception:
        return 0.0


_RATE_METRICS = {
    "win_rate",
    "shot_on_target_rate",
    "goals_per_sot",
    "pass_success_rate",
    "through_pass_success_rate",
    "tackle_success_rate",
    "late_concede_ratio",
    "in_box_shot_ratio",
}
_LOWER_IS_BETTER_METRICS = {"late_concede_ratio", "offside_avg", "goals_against_per_match"}
_METRIC_LABELS = {
    "win_rate": "승률",
    "shot_on_target_rate": "유효슈팅 비율",
    "goals_per_sot": "유효슈팅 대비 득점률",
    "in_box_shot_ratio": "박스 안 슈팅 비중",
    "pass_success_rate": "패스 성공률",
    "through_pass_success_rate": "스루패스 성공률",
    "tackle_success_rate": "태클 성공률",
    "late_concede_ratio": "60분 이후 실점 비중",
    "offside_avg": "경기당 오프사이드",
    "shots_per_match": "경기당 슈팅",
    "xg_for_per_match": "경기당 기대 득점",
    "goals_against_per_match": "경기당 실점",
    "possession_avg": "평균 점유율",
}
_ISSUE_IMPACTS = {
    "HIGH_LATE_CONCEDE": "경기 후반에 실점이 몰리면 앞서 만든 리드를 지키지 못하고 승점을 잃기 쉽습니다.",
    "LOW_FINISHING": "유효슈팅을 만들고도 득점으로 연결하지 못해 공격 기회가 결과로 남지 않고 있습니다.",
    "POOR_SHOT_SELECTION": "박스 밖이나 각도가 좋지 않은 슈팅 비중이 높아 유효슈팅과 득점 기대값이 함께 떨어질 수 있습니다.",
    "OFFSIDE_RISK": "침투 타이밍이 빠르거나 패스 선택이 늦어 유효한 공격 전개가 중간에 끊기고 있습니다.",
    "BUILDUP_INEFFICIENCY": "전진 패스가 자주 끊겨 공격 진영까지 안정적으로 공을 운반하지 못하고 있습니다.",
    "DEFENSE_DUEL_WEAKNESS": "태클 성공률과 별개로 경기당 실점이 높아, 경합 이후 세컨드볼과 뒷공간 대응을 점검할 필요가 있습니다.",
    "CHANCE_CREATION_LOW": "슈팅까지 이어지는 공격 횟수와 기대 득점이 부족해 득점 기회 자체가 적습니다.",
    "POSSESSION_CONTROL_RISK": "공을 안정적으로 소유하는 시간이 짧아 공격을 준비하기 전에 수비로 전환되는 장면이 많습니다.",
}


def _format_metric(metric_name: str, value: float) -> str:
    if metric_name in _RATE_METRICS:
        return f"{value * 100:.1f}%"
    if metric_name == "possession_avg":
        return f"{value:.1f}%"
    return f"{value:.2f}"


def _baseline_explanation(
    issue_code: str,
    issue_label: str,
    benchmark_compare: dict[str, Any],
    tactic_delta: dict[str, Any],
    tactic_input_known: bool,
) -> dict[str, Any]:
    metric_name = str(benchmark_compare.get("metric_name", ""))
    user_value = _safe_float(benchmark_compare.get("user_value"))
    benchmark_value = _safe_float(benchmark_compare.get("benchmark_value"))
    metric_label = _METRIC_LABELS.get(metric_name, metric_name or "핵심 지표")
    higher_is_better = metric_name not in _LOWER_IS_BETTER_METRICS
    current_text = _format_metric(metric_name, user_value)
    benchmark_text = _format_metric(metric_name, benchmark_value)
    direction_text = "높아지는지" if higher_is_better else "낮아지는지"
    gap_direction = "낮습니다" if user_value < benchmark_value else "높습니다"

    primary_change = []
    for key, value in tactic_delta.items():
        if key.endswith("_target") or key.endswith("_delta"):
            primary_change.append(f"{key}={value}")
    if not primary_change:
        primary_change = ["큰 수치 변경 없이 플레이 습관 우선 교정"]

    coach_message = (
        f"현재 {metric_label}은 {current_text}이며 비교 기준 {benchmark_text}보다 {gap_direction}. "
        f"같은 설정으로 최소 3경기를 플레이하면서 이 수치가 {direction_text} 확인하세요."
    )

    execution_checklist = (
        [
            "경기 시작 전 권장 전술값을 적용하고 해당 경기 동안 유지",
            "경기 시작 15분은 무리한 침투/중거리보다 안정 전개 우선",
            "첫 2경기는 결과보다 경기당 xG/유효슈팅 추세를 우선 확인",
            f"권장 변경값 적용: {', '.join(primary_change[:3])}",
        ]
        if tactic_input_known
        else [
            "권장 방향 중 1개 플랜만 선택해 최소 3경기 이상 유지",
            "경기 중 실시간 전술 변경은 최소화",
            "첫 2경기는 승패보다 xG/유효슈팅 추세를 확인",
            f"권장 테스트 포인트: {', '.join(primary_change[:3])}",
        ]
    )

    expected_effect = (
        f"다음 진단에서 {metric_label}이 현재 {current_text}에서 비교 기준 {benchmark_text} 방향으로 움직이면 개선 중입니다. "
        "차이가 절반 이상 줄면 같은 플랜을 유지하세요."
    )

    generic = {
        "coach_message": coach_message,
        "root_cause": f"{metric_label}: 현재 {current_text} / 비교 기준 {benchmark_text}",
        "problem_detail": _ISSUE_IMPACTS.get(issue_code, f"{metric_label}이 비교 기준에서 벗어나 경기 결과에 영향을 주고 있습니다."),
        "improvement_goal": f"{metric_label}을 {benchmark_text} 방향으로 개선",
        "progress_check": expected_effect,
        "execution_checklist": execution_checklist,
        "in_game_signals": [
            "전반 30분까지 유효 슈팅 2회 미만이면 해당 경기는 유지하고 종료 후 다음 경기 전술 재조정 검토",
            "상대 압박이 강하면 해당 경기에서는 방향 전환 패스 비중만 늘리고 전술 수치는 유지",
        ],
        "failure_patterns": [
            "2경기 연속 실점 타이밍이 동일하면 다음 경기 시작 전 수비 폭/깊이 재조정",
            "중앙 턴오버 반복 시 경기 중 변경 없이 다음 경기에서 박스 침투 인원 1단계 하향",
        ],
        "expected_effect": expected_effect,
    }

    issue_overrides: dict[str, dict[str, Any]] = {
        "CHANCE_CREATION_LOW": {
            "execution_checklist": [
                "공을 빼앗은 뒤 첫 전진 패스는 중앙과 측면 중 열린 쪽으로 빠르게 선택",
                "박스 근처에서는 무리한 중거리 슛보다 컷백 또는 추가 패스 1회를 우선",
                "같은 공격 설정으로 최소 3경기를 유지하며 경기당 슈팅과 기대 득점을 기록",
            ],
            "in_game_signals": [
                "전반 25분까지 슈팅 3회 미만이면 해당 경기는 유지하고 다음 경기 시작 전에 공격 폭/박스 침투 상향 검토",
                "중앙 패턴이 막히면 측면 빌드업 후 컷백 패턴 2회 이상 시도",
            ],
            "failure_patterns": [
                "슈팅 수는 늘었는데 유효슈팅이 늘지 않으면 다음 경기에서 공격 폭을 1단계 낮춤",
                "xG 증가 없이 점유율만 상승하면 다음 경기 시작 전에 전개 템포 1단계 상향",
            ],
        },
        "LOW_FINISHING": {
            "execution_checklist": [
                "박스 안에서 수비수와 거리를 만든 뒤 슈팅",
                "각도가 좁으면 즉시 슛보다 중앙으로 추가 패스 1회 시도",
                "최소 3경기 동안 유효슈팅 수와 실제 득점을 함께 기록",
            ],
            "in_game_signals": [
                "박스 안 진입 후 즉시 슛보다 1회 추가 연계 후 슛 우선",
                "유효슈팅 대비 득점률이 2경기 연속 하락하면 다음 경기 시작 전 박스 침투 인원 재조정",
            ],
            "failure_patterns": [
                "중거리 슈팅 비중이 40%를 넘으면 다음 경기에서 빌드업 인내도 상향",
                "득점이 없는데 xG만 높으면 다음 경기 시작 전에 패널티 박스 중앙 점유 동선 보강",
            ],
        },
        "OFFSIDE_RISK": {
            "execution_checklist": [
                "침투 선수가 수비 라인과 나란해진 뒤 패스 입력",
                "연속 침투보다 발밑 패스와 2대1 패턴을 섞어 사용",
                "최소 3경기 동안 경기당 오프사이드와 스루패스 성공률을 함께 기록",
            ],
            "in_game_signals": [
                "오프사이드 2회 누적 시 해당 경기에서는 침투 타이밍만 1박자 지연하고 전술은 유지",
                "스루패스 연속 실패 시 측면-하프스페이스 경유 패턴 전환",
            ],
            "failure_patterns": [
                "오프사이드는 줄었는데 찬스가 급감하면 다음 경기에서 공격 폭 1단계 복원",
            ],
        },
        "HIGH_LATE_CONCEDE": {
            "execution_checklist": [
                "60분 이후 풀백 두 명이 동시에 올라가지 않도록 공격 가담을 제한",
                "중앙 수비형 미드필더 한 명은 후방에 남겨 역습 통로 차단",
                "최소 3경기 동안 60분 이후 실점과 경기당 실점을 따로 기록",
            ],
            "in_game_signals": [
                "60분 이후 연속 박스 진입 허용 시 해당 경기는 유지하고 다음 경기 시작 전 수비 깊이 하향 검토",
                "역습 실점이 반복되면 CDM 후방대기 유지 + 풀백 오버랩 억제",
            ],
            "failure_patterns": [
                "후반 실점은 줄었는데 공격이 멈추면 다음 경기에서 공격 폭 1단계 복원",
            ],
        },
        "POOR_SHOT_SELECTION": {
            "execution_checklist": [
                "박스 밖에서는 바로 슛보다 박스 안 진입 패스를 한 번 더 시도",
                "수비수가 정면을 막고 있으면 방향 전환 후 슈팅 각도를 확보",
                "최소 3경기 동안 박스 안 슈팅 비중과 유효슈팅 비율을 함께 기록",
            ],
        },
        "BUILDUP_INEFFICIENCY": {
            "execution_checklist": [
                "첫 패스가 막히면 중앙 강행 대신 반대 측면으로 전환",
                "스루패스는 침투 공간이 열린 장면에서만 사용하고 발밑 패스를 섞기",
                "최소 3경기 동안 패스 성공률과 스루패스 성공률을 함께 기록",
            ],
        },
        "DEFENSE_DUEL_WEAKNESS": {
            "execution_checklist": [
                "수비수가 먼저 달려들기보다 패스 길을 막고 상대의 다음 터치를 기다리기",
                "중앙 수비가 끌려나가면 수비형 미드필더로 먼저 압박해 뒷공간 보호",
                "최소 3경기 동안 경기당 실점과 태클 성공률을 함께 기록",
            ],
        },
        "POSSESSION_CONTROL_RISK": {
            "execution_checklist": [
                "공을 받은 직후 전진 길이 없으면 가까운 선수에게 안전하게 연결",
                "한쪽 측면이 막히면 수비형 미드필더를 거쳐 반대편으로 전환",
                "최소 3경기 동안 점유율과 패스 성공률을 함께 기록",
            ],
        },
    }
    return {**generic, **issue_overrides.get(issue_code, {})}


def _maybe_llm_enrich(base: dict[str, Any], issue_code: str, issue_label: str) -> dict[str, Any]:
    if os.getenv("HABIT_LAB_LLM_ENABLED", "0").strip() != "1":
        return base
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        return base
    model = os.getenv("OPENROUTER_MODEL", "openrouter/free").strip()
    prompt = (
        "너는 FC 온라인 개인 코치다. JSON만 출력해라. "
        "키는 coach_message, execution_checklist(3), in_game_signals(2), failure_patterns(2), expected_effect. "
        f"현재 이슈는 {issue_label}({issue_code})이고, 기존 제안은 {json.dumps(base, ensure_ascii=False)}"
    )
    try:
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
            },
            timeout=8,
        )
        response.raise_for_status()
        content = (
            response.json()
            .get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        parsed = json.loads(content) if isinstance(content, str) else {}
        if isinstance(parsed, dict):
            merged = {**base, **parsed}
            merged["source"] = "llm+rules"
            return merged
    except Exception:
        return base
    return base


def build_action_explanation(
    issue_code: str,
    issue_label: str,
    benchmark_compare: dict[str, Any],
    tactic_delta: dict[str, Any],
    tactic_input_known: bool = True,
) -> dict[str, Any]:
    base = _baseline_explanation(
        issue_code,
        issue_label,
        benchmark_compare,
        tactic_delta,
        tactic_input_known=tactic_input_known,
    )
    enriched = _maybe_llm_enrich(base, issue_code, issue_label)
    if "source" not in enriched:
        enriched["source"] = "rules"
    return enriched
