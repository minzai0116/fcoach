from __future__ import annotations

import math
from typing import Any

from app.services.analysis_models import MatchStats
from app.services.match_selection import eligible_match_rows
from app.services.passing_coaching import build_passing_coaching
from app.services.coaching_data import PLAYER_COUNTERS, active_players, number
from app.services.domain_coaching import build_domain_coaching
from app.services.shot_types import shot_type_label
from app.services.player_guidance import build_player_guidance
from app.services.comparison_evidence import compare_rates, rate_sample, period, previous_matches


_RULES = {
    "pass": ("패스 성공률", "pass_success", "pass_try", 30),
    "shot": ("유효 슈팅 비율", "effective_shots", "shots", 10),
    "tackle": ("태클 성공률", "tackle_success", "tackle_try", 10),
    "dribble": ("드리블 성공률", "dribble_success", "dribble_try", 20),
    "finishing": ("득점 전환율", "goals", "shots", 10),
    "block": ("블록 성공률", "block_success", "block_try", 10),
    "ball_possession": ("볼 소유 성공률", "ball_possession_success", "ball_possession_try", 20),
    "aerial": ("공중볼 경합 성공률", "aerial_success", "aerial_try", 10),
}


def _count(value: Any) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) and number >= 0 else 0.0
    except (ValueError, TypeError):
        return 0.0


def _adjustment(metric: str, position: str, match_type: int) -> str:
    if match_type == 52:
        return f"감독 모드에서는 직접 조작을 교정하지 않습니다. {position}의 선수·포메이션을 유지해 자동 경기 기록을 더 모으고, 같은 자리의 지표가 반복해서 낮은지 먼저 확인하세요."
    if metric == "pass" and position == "GK":
        return "골키퍼가 공을 잡으면 상대 공격수의 압박과 가까운 수비수의 패스 경로를 먼저 확인하세요. 짧은 배급과 긴 배급 중 어떤 선택이 실패했는지는 이 선수의 기록만으로 구분할 수 없습니다."
    if metric == "pass":
        behavior = (
            f"{position}에서 패스 전에 가까운 지원 선수와 열린 연결 경로를 확보하세요. 압박을 받으면 가까운 선수에게 연결해 보세요. 이 선수의 패스 유형·방향은 기록에 없어 어떤 패스가 실패했는지는 구분할 수 없습니다."
        )
    elif metric == "shot":
        behavior = f"{position}에서 수비수가 슈팅 경로를 막으면 바로 쏘지 말고 옆 선수에게 연결한 뒤 박스 안 슈팅을 선택하세요."
    elif metric == "tackle":
        behavior = f"{position}를 직접 전진시켜 태클하기보다 패스 경로를 먼저 막고, 상대의 긴 터치 때만 태클을 시도하세요."
    elif metric in {"finishing", "block", "ball_possession", "aerial"}:
        behavior = {"finishing": "수비수와 골키퍼의 위치를 확인하고 열린 각도에서 슈팅하세요.", "block": "슈팅하는 선수와 골문 사이를 먼저 막고 수비 위치를 유지하세요.", "ball_possession": "공을 받기 전에 가까운 패스할 동료를 확인하고 수비수가 붙으면 연결 후 다시 움직이세요.", "aerial": "공중볼을 받는 선수의 위치와 주변 지원을 확인하고, 불리한 경합은 가까운 패스로 전환하세요."}[metric]
    else:
        behavior = f"{position}에서 연속 개인기 대신 한 번의 방향 전환 후 패스하고, 지원 선수가 없는 상태의 드리블을 줄이세요."
    return behavior


def _aggregate_players(rows: list[MatchStats]) -> dict:
    aggregates: dict[tuple[int, int, int], dict[str, Any]] = {}
    for row in rows:
        owners = {}
        for player in active_players(row):
            key = tuple(int(_count(player.get(field))) for field in ("sp_id", "sp_grade", "sp_position"))
            owner = key[:2]
            owners[owner] = None if owner in owners else key
            aggregate = aggregates.setdefault(key, {"appearances": 0, "metrics": {}, "observations": {}, "shot_types": {}})
            aggregate["appearances"] += 1
            if key[2] == 0:
                conceded = number(row.coaching_data.get('opponent_shoot', {}), 'goalTotalDisplay', 'goalTotal')
                if conceded is not None:
                    context = aggregate.setdefault('keeper_context', {'conceded': 0, 'clean_sheets': 0, 'matches': 0})
                    context['conceded'] += conceded
                    context['clean_sheets'] += int(conceded == 0)
                    context['matches'] += 1
            for metric, (_, success_key, trials_key, _) in _RULES.items():
                available = player.get(f"{metric}_observed", success_key in player and trials_key in player)
                if not available:
                    continue
                success, trials = number(player, success_key), number(player, trials_key)
                if success is None or trials is None or success > trials:
                    continue
                total = aggregate["metrics"].setdefault(metric, {"success": 0.0, "trials": 0.0, "matches": 0, "active_matches": 0, "dates": []})
                total["success"] += success
                total["trials"] += trials
                total["matches"] += 1
                total["active_matches"] += int(trials > 0)
                if trials > 0: total["dates"].append(row.match_date)
            for counter in PLAYER_COUNTERS:
                if not player.get(f"{counter}_observed", counter in player):
                    continue
                total = aggregate["observations"].setdefault(counter, {"total": 0.0, "matches": 0})
                total["total"] += _count(player.get(counter))
                total["matches"] += 1
        for shot in row.coaching_data.get('shots', []):
            key = owners.get((shot['sp_id'], shot['sp_grade']))
            if key is None:
                continue
            code = int(shot['type']) if shot['type'] is not None else None
            total = aggregates[key]['shot_types'].setdefault(code, {'trials': 0, 'goals': 0, 'on_target': 0})
            total['trials'] += 1
            total['goals'] += int(shot['result'] == 3)
            total['on_target'] += int(shot['result'] in (1, 3))

    return aggregates


def _keeper_metrics(aggregate: dict, previous: dict) -> list[dict]:
    result = []
    for key, label, unit in [('defending_actions', '선방 / 경기', '회'), ('rating', '평균 평점', '점'),
                              ('conceded', '팀 실점 / 경기', '골'), ('clean_sheets', '팀 무실점 경기', '경기')]:
        def sample(data: dict) -> dict:
            if key in {'conceded', 'clean_sheets'}:
                context = data.get('keeper_context', {})
                total, matches = context.get(key, 0), context.get('matches', 0)
            else:
                counter = data.get('observations', {}).get(key, {})
                total, matches = counter.get('total', 0), counter.get('matches', 0)
            return {'total': total if matches else None, 'matches': matches,
                    'value': round(total if key == 'clean_sheets' else total / matches, 3) if matches else None}
        result.append({'metric': key, 'label': label, 'unit': unit, 'current': sample(aggregate), 'previous': sample(previous)})
    return result


def build_position_coaching(
    rows: list[MatchStats],
    player_report: dict[str, Any],
    position_names: dict[int, str],
    match_type: int = 60,
    *, include_forfeits: bool = False, player_names: dict[int, str] | None = None, history_rows: list[MatchStats] | None = None,
) -> dict[str, Any]:
    rows = eligible_match_rows(rows)
    history = previous_matches(history_rows or [], rows)
    metadata = {(p["sp_id"], p["sp_grade"]): p for p in player_report.get("players", [])}
    aggregates = _aggregate_players(rows)
    previous = _aggregate_players(history)

    players = []
    for key, aggregate in aggregates.items():
        sp_id, grade, position_id = key
        position = position_names.get(position_id, str(position_id))
        meta = metadata.get((sp_id, grade), {})
        measurements, findings = [], []
        for metric, (label, _, _, minimum_trials) in _RULES.items():
            if position_id == 0 and metric != 'pass':
                continue
            if position_id == 0:
                label = '배급 패스 성공률'
            total = aggregate["metrics"].get(metric, {})
            trials, success = total.get("trials", 0), total.get("success", 0)
            rate = success / trials if trials else None
            sufficient = total.get("matches", 0) >= 5 and trials >= minimum_trials
            old = previous.get(key, {}).get("metrics", {}).get(metric, {})
            comparison = compare_rates(rate_sample(success, trials, total.get("active_matches", 0), total.get("dates", [])),
                                       rate_sample(old.get("success", 0), old.get("trials", 0), old.get("active_matches", 0), old.get("dates", [])), minimum_trials)
            threshold = comparison['previous']['value'] if comparison['status'] != 'unavailable' else None
            measurements.append({
                "metric": metric, "label": label, "success": success, "trials": trials,
                "value": round(rate, 6) if rate is not None else None,
                "observed_matches": total.get("matches", 0), "minimum_trials": minimum_trials,
                "reference": threshold, "comparison": comparison, "status": "sufficient" if sufficient else "insufficient",
            })
            if comparison['status'] != 'lower':
                continue
            before = comparison['previous']
            findings.append({
                "metric": metric, "label": label, "current": round(rate, 6), "reference": threshold,
                "target": threshold, "gap_pp": round((threshold - rate) * 100, 1), "comparison": comparison,
                "evidence": f"같은 카드·강화·{position}의 현재 정상 종료 {total['active_matches']}경기 {success:g}/{trials:g}회 ({rate:.1%}), 이전 {before['matches']}경기 {before['success']:g}/{before['trials']:g}회 ({threshold:.1%})입니다. 두 성공률의 95% Wilson 구간이 겹치지 않아 하락한 기록으로 표시합니다.",
                "hypothesis": "상대와 경기 상황·설정이 달라질 수 있어 기록의 하락만으로 원인이나 플레이의 잘못을 단정하지 않습니다.",
                "adjustment": _adjustment(metric, position, match_type),
                "verification": f"같은 모드·카드·강화·자리의 다음 정상 종료 경기에서 {label} 성공/시도 수와 실점·찬스를 함께 비교하세요. 이전 기록 {threshold:.1%}는 관측값이며 달성해야 할 정상 기준이 아닙니다.",
            })
        findings.sort(key=lambda f: f["gap_pp"], reverse=True)
        players.append({
            "sp_id": sp_id, "sp_grade": grade, "sp_position": position_id,
            "player_name": meta.get("player_name", f"spId {sp_id}"), "position_name": position,
            "season_name": meta.get("season_name", ""), "appearances": aggregate["appearances"],
            "measurements": measurements, "findings": findings,
            "goalkeeper_metrics": _keeper_metrics(aggregate, previous.get(key, {})) if position_id == 0 else None,
            "observations": [{"metric": metric, "total": total["total"], "per_match": round(total["total"] / total["matches"], 4), "observed_matches": total["matches"]} for metric, total in aggregate["observations"].items()],
            "shot_types": [{"metric": f"shot_type_{code if code is not None else 'unknown'}", "label": shot_type_label(code), **total, "conversion": round(total['goals'] / total['trials'], 6)} for code, total in aggregate['shot_types'].items()],
        })
    for player in players:
        player["guidance"] = build_player_guidance(player, mode=match_type)
    players.sort(key=lambda p: (-max((f["gap_pp"] for f in p["findings"]), default=0), -p["appearances"], p["sp_position"], p["sp_id"]))
    latest = max(rows, key=lambda row: (row.match_date, row.match_id), default=None)
    latest_lineup = None if latest is None else {
        'match_id': latest.match_id, 'match_date': latest.match_date,
        'players': [{key: p[key] for key in ('sp_id', 'sp_grade', 'sp_position')} for p in active_players(latest)],
    }
    return {
        "mode": "observation" if match_type == 52 else "play",
        "reference_source": "own_history_v1",
        "comparison_scope": {"current": period(rows), "previous": period(history)},
        "reference_note": "정상 종료 경기만 비교합니다. 같은 모드·카드·강화·자리의 이전 기록과 현재 기록을 분리하며, 각 5경기 이상과 지표별 시도 수를 충족하고 95% Wilson 구간이 겹치지 않을 때만 변화에 따른 코칭을 제공합니다. 비교 기록이 없거나 차이가 불확실하면 좋고 나쁨을 단정하지 않고 현재 기록에 맞춘 플레이 선택지를 제안합니다. 이전 기록은 정상 기준이 아니며 피드 설정을 하락 원인으로 단정하지 않습니다.",
        "sample_count": len(rows), "players": players, "latest_lineup": latest_lineup,
        "passing": build_passing_coaching(rows, match_type, history_rows=history),
        "domains": build_domain_coaching(rows, include_forfeits=include_forfeits,
                                        player_names=player_names or {key[0]: value['player_name'] for key, value in metadata.items()}),
    }
