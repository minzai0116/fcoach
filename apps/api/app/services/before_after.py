from __future__ import annotations

from app.services.analysis_models import MatchStats
from app.services.comparison_evidence import period
from app.services.domain_coaching import build_domain_coaching
from app.services.match_selection import eligible_match_rows
from app.services.passing_coaching import build_passing_coaching
from app.services.player_guidance import ADVICE

LOWER_IS_BETTER = {'goals_against', 'shots_against', 'late_conceded', 'offside', 'foul', 'yellow', 'red', 'own_goals', 'yellow_cards', 'red_cards'}
CONTEXT_ONLY = {'possession', 'defending_actions', 'dribble_distance', 'team_distance', 'corner', 'injury', 'shootout_shots'}
PRIMARY = ['pass_overall', 'on_target', 'conversion', 'display_goals', 'goals_against', 'team_tackle', 'pass_through', 'win_rate']


def _metrics(rows: list[MatchStats]) -> dict:
    metrics = {}
    for domain in build_domain_coaching(rows, include_forfeits=True):
        for metric in domain['metrics']:
            key = metric['metric']
            if key in {'goals', 'goals_for', 'yellow_cards', 'red_cards'}:
                continue
            metrics.setdefault(key, {**metric, 'category': domain['id'], 'category_label': domain['label']})
    passing = build_passing_coaching(rows, 60, include_forfeits=True)
    for item in [{'metric': 'overall', 'label': '전체 패스', **passing['overall']}, *passing['types']]:
        key = 'pass_' + item['metric']
        metrics[key] = {'metric': key, 'label': item['label'] + ' 성공률', 'category': 'passing', 'category_label': '패스',
                        'unit': 'rate', 'value': item['success'] / item['trials'] if item['trials'] else None, 'success': item['success'], 'trials': item['trials'],
                        'observed_matches': item.get('observed_matches', passing['observed_matches'])}
    return metrics


def _advice(metric: str) -> str:
    key = 'pass' if metric.startswith('pass_') else {'on_target': 'shot', 'conversion': 'finishing',
        'display_goals': 'finishing', 'team_tackle': 'tackle', 'team_block': 'block'}.get(metric, metric)
    if key in ADVICE:
        return ADVICE[key][1]
    if metric in {'goals_against', 'shots_against', 'late_conceded'}:
        return '공을 잃었을 때 수비수를 먼저 끌어내지 말고 중앙 패스 경로를 막으세요. 상대 슈팅과 실점을 함께 줄이는 방향으로 복귀 위치를 잡으세요.'
    if metric == 'offside':
        return '침투하는 선수의 위치를 확인하고 오프사이드에 걸리기 전에 패스를 보내세요. 패스가 늦어졌다면 가까운 동료에게 연결해 공격을 이어가세요.'
    if metric in {'foul', 'yellow', 'red'}:
        return '상대가 먼저 공을 처리한 뒤 늦게 태클하는 상황을 줄이세요. 패스 경로를 막으며 수비 위치를 유지하세요.'
    return '같은 선수 구성과 상대 경기 양상을 함께 보면서 패스·슈팅·실점 변화를 확인하세요.'


def compare_match_groups(rows: list[MatchStats], before_ids: list[str], after_ids: list[str], *,
                         include_forfeit_wins: bool = False, include_forfeit_losses: bool = False, match_type: int = 60) -> dict:
    if not before_ids or not after_ids:
        raise ValueError('개선 전과 개선 후 경기를 각각 한 경기 이상 선택해주세요.')
    if len(set(before_ids)) != len(before_ids) or len(set(after_ids)) != len(after_ids):
        raise ValueError('같은 경기를 한 구간에 중복해서 선택할 수 없습니다.')
    if set(before_ids) & set(after_ids):
        raise ValueError('같은 경기를 개선 전과 개선 후에 동시에 포함할 수 없습니다.')
    by_id = {row.match_id: row for row in rows}
    if (set(before_ids) | set(after_ids)) - by_id.keys():
        raise ValueError('선택한 경기를 조회할 수 없습니다. 경기 목록을 다시 불러와 선택해주세요.')
    groups = [eligible_match_rows([by_id[mid] for mid in ids], include_forfeit_wins, include_forfeit_losses)
              for ids in (before_ids, after_ids)]
    if not all(groups):
        raise ValueError('종료 유형 조건에 맞는 경기를 개선 전과 개선 후에 각각 선택해주세요.')
    before, after = [_metrics(group) for group in groups]
    results = []
    for key in dict.fromkeys([*before, *after]):
        old, new = before.get(key, {}), after.get(key, {})
        sample = new or old
        previous, current = old.get('value'), new.get('value')
        if previous is None and current is None:
            continue
        delta = round(current - previous, 6) if current is not None and previous is not None else None
        direction = None if key in CONTEXT_ONLY else key not in LOWER_IS_BETTER
        status = 'unavailable' if delta is None else 'same' if delta == 0 else 'context' if direction is None else 'improved' if (delta > 0) == direction else 'declined'
        results.append({'metric': key, 'label': sample['label'], 'unit': sample['unit'], 'category': sample['category'],
                        'category_label': sample['category_label'], 'before': old, 'after': new, 'delta': delta,
                        'higher_is_better': direction, 'status': status, 'advice': _advice(key) if match_type != 52 else '감독 모드에서는 선수 구성을 유지하고 팀·개인 전술을 한 항목씩 비교하세요. 직접 조작을 교정하지 않습니다.'})
    results.sort(key=lambda item: (PRIMARY.index(item['metric']) if item['metric'] in PRIMARY else 99, item['category']))
    def summary(status: str) -> list[dict]:
        changed = [item for item in results if item['status'] == status and item['metric'] in PRIMARY]
        changed.sort(key=lambda item: abs(item['delta']) / max(abs(item['before']['value']), abs(item['after']['value']), 1e-9), reverse=True)
        selected, seen = [], set()
        for item in changed:
            if item['advice'] in seen:
                continue
            seen.add(item['advice'])
            selected.append({'metric': item['metric'], 'label': item['label'], 'before': item['before']['value'],
                             'after': item['after']['value'], 'delta': item['delta'], 'unit': item['unit'], 'action': item['advice']})
        return selected[:3]
    def group_info(group: list[MatchStats], requested: list[str]) -> dict:
        return {**period(group), 'match_ids': [row.match_id for row in group], 'excluded_count': len(requested) - len(group),
                'normal_count': sum(row.match_end_type == 0 for row in group),
                'forfeit_count': sum(row.match_end_type in (1, 2) for row in group)}
    return {'before': group_info(groups[0], before_ids), 'after': group_info(groups[1], after_ids),
            'metrics': results, 'strengths': summary('improved'), 'improvements': summary('declined'),
            'note': '선택한 두 구간의 실측 기록 변화입니다. 경기당 수치와 성공 합계 ÷ 시도 합계를 비교하며, 상대·선수 구성·슈팅 난이도 차이 또는 설정 변경의 효과를 확정하지 않습니다.'}


def run_before_after(ouid: str, match_type: int, before_ids: list[str], after_ids: list[str], **options) -> dict:
    from app.services.analysis import _load_rows_for_analysis, utc_now_iso
    rows, new_rows, warning, _ = _load_rows_for_analysis(ouid, match_type, 30, True, manual_refresh_probe=True)
    return {**compare_match_groups(rows, before_ids, after_ids, match_type=match_type, **options), 'ouid': ouid, 'match_type': match_type,
            'fetched_at': utc_now_iso(), 'sync_new_rows': new_rows, 'sync_warning': warning}
