from __future__ import annotations

from app.services.analysis_models import MatchStats
from app.services.coaching_data import number
from app.services.comparison_evidence import compare_rates, period, previous_matches, rate_sample

VERSION = 'empirical_history_v4'
_METRICS = {
    'shot_on_target_rate': ('유효 슈팅 비율', 'shoot', 'effectiveShootTotal', 'shootTotal', 10, 'POOR_SHOT_SELECTION',
                            '수비수가 슈팅 경로를 막았는지 확인하고, 각도가 좁으면 가까운 동료에게 연결한 뒤 다시 슈팅해 보세요.'),
    'goals_per_sot': ('유효 슈팅당 득점 비율', 'shoot', 'goalTotal', 'effectiveShootTotal', 10, 'LOW_FINISHING',
                      '슈팅 위치·골키퍼 위치를 함께 확인하세요. 같은 거리와 각도에서 슈팅 종류를 하나씩 바꿔 비교해 보세요.'),
    'pass_success_rate': ('패스 성공률', 'overall', 'success', 'trials', 30, 'BUILDUP_INEFFICIENCY',
                          '패스 유형별 이전 기록을 확인하고, 수비수가 연결 경로를 막으면 가까운 지원 선수에게 연결해 보세요.'),
    'through_pass_success_rate': ('스루 패스 성공률', 'through', 'success', 'trials', 20, 'BUILDUP_INEFFICIENCY',
                                  '받는 선수의 침투와 수비수 사이 경로를 확인한 뒤 스루 패스를 보내고, 경로가 막히면 가까운 패스로 연결하세요.'),
    'tackle_success_rate': ('태클 성공률', 'defence', 'tackleSuccess', 'tackleTry', 10, 'DEFENSE_DUEL_WEAKNESS',
                            '수비 위치와 패스 경로를 먼저 유지하고, 상대의 터치가 길어지는 순간에 태클을 시도해 보세요.'),
}


def _sample(rows: list[MatchStats], container: str, success_key: str, trials_key: str) -> dict:
    success = trials = 0.0
    dates = []
    for row in rows:
        data = row.coaching_data.get(container, {}) if container in ('shoot', 'defence') else row.pass_breakdown.get(container, {})
        made, attempted = number(data, success_key), number(data, trials_key)
        if made is None or attempted is None or made > attempted or attempted == 0:
            continue
        success += made
        trials += attempted
        dates.append(row.match_date)
    return rate_sample(success, trials, len(dates), dates)


def build_team_history_coaching(rows: list[MatchStats], history_rows: list[MatchStats], match_type: int) -> dict:
    current = [row for row in rows if row.match_end_type == 0]
    history = previous_matches(history_rows, rows)
    comparisons, benchmark, gaps, actions, issues = {}, {}, [], [], {}
    meta = {'source': 'own_history_v1' if history else 'unavailable', 'current': period(current),
            'previous': period(history), 'method': 'wilson_95_nonoverlap',
            'description': '같은 경기 모드의 이전 정상 종료 기록. 분석 구간과 겹치지 않으며, 이전 관측값은 정상 기준이나 달성 목표가 아닙니다.'}
    for key, (label, container, made, attempted, minimum, code, advice) in _METRICS.items():
        comparison = compare_rates(_sample(current, container, made, attempted), _sample(history, container, made, attempted), minimum)
        comparisons[key] = comparison
        if comparison['status'] == 'unavailable':
            continue
        now, before = comparison['current'], comparison['previous']
        benchmark[key] = before['value']
        gap = {'metric_name': key, 'metric_label': label, 'user_value': now['value'], 'benchmark_value': before['value'],
               'gap_value': round(now['value'] - before['value'], 6), 'higher_is_better': True,
               'benchmark_source': 'own_history_v1', 'comparison': comparison}
        gaps.append(gap)
        if comparison['status'] != 'lower':
            continue
        evidence_text = (f"{label}: 현재 정상 종료 {now['matches']}경기 {now['success']:g}/{now['trials']:g}회 ({now['value']:.1%}), "
                         f"이전 {before['matches']}경기 {before['success']:g}/{before['trials']:g}회 ({before['value']:.1%}). "
                         '두 성공률의 95% Wilson 구간이 겹치지 않아 하락한 기록으로 표시합니다.')
        if match_type == 52:
            advice = '감독 모드에서는 직접 조작을 교정하지 않습니다. 같은 선수·포메이션의 다음 정상 종료 경기에서 기록이 반복되는지 확인하세요.'
        action = {'rank': 0, 'action_code': code, 'title': f'이전 경기 대비 {label} 변화', 'description': evidence_text,
                  'tactic_direction': advice, 'tactic_delta': {}, 'confidence': 0.0,
                  'evidence': {'benchmark_meta': meta, 'benchmark_compare': gap, 'metric_gap_table': [gap],
                               'comparison': comparison, 'issue_score': -comparison['gap_pp'],
                               'coach_explanation': {'source': 'own_history_v1', 'coach_message': evidence_text,
                                   'root_cause': '상대·경기 상황·설정 차이가 있어 수치만으로 하락 원인을 확정할 수 없습니다.',
                                   'problem_detail': evidence_text, 'execution_checklist': [advice],
                                   'improvement_goal': f"이전 실측값 {before['value']:.1%}와 비교합니다. 이 값은 정상 기준이나 달성 목표가 아닙니다.",
                                   'progress_check': '다음 정상 종료 경기에서 성공·시도 수와 슈팅·득점을 함께 비교하세요.',
                                   'expected_effect': '제안은 확인할 플레이 선택입니다. 설정 변경의 효과를 보장하지 않습니다.'}}}
        issues[code] = max(issues.get(code, 0), -comparison['gap_pp'])
        actions.append(action)
    # 같은 주제의 여러 하락이 있어도 가장 큰 관측 차이 하나만 제안한다.
    actions.sort(key=lambda item: item['evidence']['issue_score'], reverse=True)
    unique = {}
    for action in actions:
        unique.setdefault(action['action_code'], action)
    actions = list(unique.values())[:3]
    for index, action in enumerate(actions, 1):
        action['rank'] = index
    return {'benchmark': benchmark, 'benchmark_meta': meta, 'comparisons': comparisons,
            'metric_gap_table': gaps, 'issues': issues, 'actions': actions}
