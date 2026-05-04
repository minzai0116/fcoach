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


def _fmt(value: Any, digits: int = 3) -> str:
    return f"{_safe_float(value):.{digits}f}"


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
    gap_value = _safe_float(benchmark_compare.get("gap_value"))

    primary_change = []
    for key, value in tactic_delta.items():
        if key.endswith("_target") or key.endswith("_delta"):
            primary_change.append(f"{key}={value}")
    if not primary_change:
        primary_change = ["큰 수치 변경 없이 플레이 습관 우선 교정"]

    coach_message = (
        f"{issue_label} 기준 지표가 랭커 기준 대비 {_fmt(gap_value)} 차이입니다. "
        "다음 플레이 구간 동안 단일 플랜으로 고정 운영하고, 한 경기 내 전술 변경은 하지 마세요."
        if tactic_input_known
        else f"{issue_label} 기준 지표가 랭커 기준 대비 {_fmt(gap_value)} 차이입니다. "
        "현재 전술 입력이 없어 권장 방향 테스트안으로 제시합니다. 최소 3경기 이상 같은 플랜을 유지해 추세를 확인하세요."
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
        "다음 진단에서 핵심 지표가 기준에 30~50% 수준으로 근접하면 플랜 유지"
        if tactic_input_known
        else "다음 진단에서 핵심 지표가 개선 추세를 보이면, 그때 고급 전술 입력 기반 정밀 조정으로 전환"
    )

    generic = {
        "coach_message": coach_message,
        "root_cause": f"핵심 지표({metric_name}) 내 값 {_fmt(user_value)} / 기준 {_fmt(benchmark_value)}",
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
            "in_game_signals": [
                "오프사이드 2회 누적 시 해당 경기에서는 침투 타이밍만 1박자 지연하고 전술은 유지",
                "스루패스 연속 실패 시 측면-하프스페이스 경유 패턴 전환",
            ],
            "failure_patterns": [
                "오프사이드는 줄었는데 찬스가 급감하면 다음 경기에서 공격 폭 1단계 복원",
            ],
        },
        "HIGH_LATE_CONCEDE": {
            "in_game_signals": [
                "60분 이후 연속 박스 진입 허용 시 해당 경기는 유지하고 다음 경기 시작 전 수비 깊이 하향 검토",
                "역습 실점이 반복되면 CDM 후방대기 유지 + 풀백 오버랩 억제",
            ],
            "failure_patterns": [
                "후반 실점은 줄었는데 공격이 멈추면 다음 경기에서 공격 폭 1단계 복원",
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
