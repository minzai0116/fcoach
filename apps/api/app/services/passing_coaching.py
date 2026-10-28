from __future__ import annotations

import math
from typing import Any

from app.services.analysis_models import MatchStats
from app.services.match_selection import eligible_match_rows
from app.services.comparison_evidence import compare_rates, rate_sample, previous_matches
from app.services.coaching_data import number


PASS_TYPES = {
    "short": ("짧은 패스", "shortPass"),
    "long": ("긴 패스", "longPass"),
    "bouncing_lob": ("바운싱 롭 패스", "bouncingLobPass"),
    "driven_ground": ("드라이브 땅볼 패스", "drivenGroundPass"),
    "through": ("스루 패스", "throughPass"),
    "lobbed_through": ("로빙 스루 패스", "lobbedThroughPass"),
}
_MIN_TRIALS = 20
_ADJUSTMENTS = {
    "short": "받는 선수 앞에 수비수가 있으면 같은 패스를 반복하지 말고 옆 지원 선수에게 연결하세요. 패스 전에 받는 선수의 몸 방향과 연결 경로를 확인하세요.",
    "long": "중앙 압박을 벗어나려는 긴 패스는 반대편 받는 선수가 비었을 때 선택하세요. 경합 상황으로 보내는 횟수를 줄이고 가까운 선수에게 한 번 연결한 뒤 전환해 보세요.",
    "bouncing_lob": "수비수와 받는 선수가 겹쳐 있을 때 바운싱 롭 패스를 강행하지 말고 가까운 땅볼 패스로 연결하세요. 받는 선수 앞에 공간이 확보된 상황부터 시도하세요.",
    "driven_ground": "받는 선수까지의 직선 경로가 열렸을 때 드라이브 땅볼 패스를 선택하세요. 수비수가 경로를 막거나 받는 선수가 등을 지고 있으면 짧은 패스로 연결하세요.",
    "through": "침투 선수가 움직이기 전에 스루 패스를 보내지 말고, 움직임과 수비수 사이 경로를 확인한 뒤 보내세요. 패스 경로가 막히면 짧은 패스로 소유를 유지하세요.",
    "lobbed_through": "수비 뒷공간과 받는 선수의 침투가 함께 확보된 상황에서 로빙 스루 패스를 선택하세요. 수비수가 먼저 도달할 상황이면 땅볼 연결로 전환하세요.",
}


def extract_pass_breakdown(payload: dict[str, Any]) -> dict[str, dict[str, float]]:
    result = {}
    for metric, prefix in [("overall", "pass"), *((key, value[1]) for key, value in PASS_TYPES.items())]:
        trials, success = payload.get(f"{prefix}Try"), payload.get(f"{prefix}Success")
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= 0 for v in (trials, success)):
            continue
        if success <= trials:
            result[metric] = {"trials": trials, "success": success}
    return result


def build_passing_coaching(rows: list[MatchStats], match_type: int, *, include_forfeits: bool = False, history_rows: list[MatchStats] | None = None) -> dict[str, Any]:
    completed = eligible_match_rows(rows, include_forfeits, include_forfeits)
    totals = {key: {"trials": 0, "success": 0} for key in ("overall", *PASS_TYPES)}
    active = {key: [] for key in totals}
    overall = {'trials': 0, 'success': 0}
    matched = overall_matches = 0
    for row in completed:
        breakdown = row.pass_breakdown
        trials, success = number(breakdown.get('overall', {}), 'trials'), number(breakdown.get('overall', {}), 'success')
        if trials is None or success is None or success > trials:
            continue
        overall_matches += 1
        overall['trials'] += trials
        overall['success'] += success
        if any(key not in breakdown for key in totals):
            continue
        # 같은 경기의 분모를 맞추고, 누락·중복 분류를 전체 기록과 대조한다.
        remainder = {field: breakdown["overall"][field] - sum(breakdown[key][field] for key in PASS_TYPES) for field in ("trials", "success")}
        if remainder["success"] < 0 or remainder["trials"] < remainder["success"]:
            continue
        matched += 1
        for key in totals:
            if breakdown[key]["trials"] > 0: active[key].append(row.match_date)
        for key, total in totals.items():
            for field in total:
                total[field] += breakdown[key][field]

    type_overall = totals.pop("overall")
    attempts = type_overall["trials"]
    failures = attempts - type_overall["success"]
    remainder_trials = attempts - sum(total["trials"] for total in totals.values())
    remainder_success = type_overall["success"] - sum(total["success"] for total in totals.values())
    history = previous_matches(history_rows or [], rows, include_forfeits=include_forfeits)
    previous = build_passing_coaching(history, match_type, include_forfeits=include_forfeits) if history else None
    before = {item["metric"]: item["sample"] for item in previous["types"]} if previous else {}
    types = []
    for metric, (label, _) in PASS_TYPES.items():
        total = totals[metric]
        trials, success = total["trials"], total["success"]
        lost = trials - success
        sufficient = matched >= 5 and trials >= _MIN_TRIALS
        sample = rate_sample(success, trials, len(active[metric]), active[metric])
        comparison = compare_rates(sample, before.get(metric, rate_sample(0, 0, 0, [])), _MIN_TRIALS)
        types.append({
            "metric": metric, "label": label, **total, "failures": lost,
            "sample": sample, "comparison": comparison,
            "success_rate": round(success / trials, 6) if trials else None,
            "usage_share": round(trials / attempts, 6) if attempts else None,
            "failure_share": round(lost / failures, 6) if failures else None,
            "loss_per_100_passes": round(lost / attempts * 100, 2) if attempts else None,
            "observed_matches": matched, "minimum_trials": _MIN_TRIALS,
            "status": "sufficient" if sufficient else "insufficient",
        })

    candidates = [item for item in types if item['comparison']['status'] == 'lower']
    candidates.sort(key=lambda item: (item['comparison']['gap_pp'], item['metric']))
    priorities = []
    for item in candidates[:3]:
        prior = item["comparison"]["previous"]
        priorities.append({
            "metric": item["metric"], "label": item["label"],
            "evidence": f"현재 기록이 확인된 {matched}경기에서 {item['label']} {item['success']:g}/{item['trials']:g}회 ({item['success_rate']:.1%}), 이전 {prior['matches']}경기 {prior['success']:g}/{prior['trials']:g}회 ({prior['value']:.1%})입니다. 95% Wilson 구간이 겹치지 않는 하락입니다.",
            "interpretation": "같은 모드의 이전 기록이 확인된 경기와 비교했습니다. 상대·패스 난이도·찬스 기여는 달라질 수 있어 원인이나 나쁜 선택으로 단정하지 않습니다.",
            "adjustment": ("감독 모드는 직접 조작을 교정하지 않습니다. 선수·포메이션을 유지하고 같은 유형의 사용 비중과 실패 비중이 반복되는지 추가 자동 경기에서 확인하세요."
                           if match_type == 52 else _ADJUSTMENTS[item["metric"]]),
            "verification": f"같은 모드에서 다음 5경기 이상·{item['label']} 20회 이상을 모아 성공률, 사용 비중, 전체 패스 100회당 이 유형의 실패 수(현재 {item['loss_per_100_passes']:g}회)를 함께 비교하세요. 시도만 줄여 성공률이 올라간 경우도 구분하고, 팀 슈팅·득점이 함께 줄지 않았는지 확인하세요.",
        })
    return {
        "scope": "team", "sample_count": len(completed), "observed_matches": overall_matches,
        "excluded_matches": len(completed) - overall_matches,
        "type_observed_matches": matched, "type_overall": type_overall,
        "overall": {**overall, "failures": overall['trials'] - overall['success'], "success_rate": round(overall["success"] / overall['trials'], 6) if overall['trials'] else None},
        "remainder": {"trials": remainder_trials, "success": remainder_success, "failures": remainder_trials - remainder_success},
        "types": types, "priorities": priorities,
        "note": "전체 패스는 유효한 전체 성공·시도 기록을 합산합니다. 유형별 지표·사용 비중은 6유형의 합계가 검증된 동일 경기만 사용합니다. 미분류는 전체와 유형 합계의 차이이며 종류를 추정하지 않습니다.",
    }
