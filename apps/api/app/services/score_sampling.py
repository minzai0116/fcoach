"""경기 시간 정보가 없는 중단 경기로 횟수 점수가 유리해지는 것을 막는다."""
from collections import defaultdict

from app.services.coaching_data import number, recorded_team_goals

PROFILE_VERSION = 'completed_counts_v2'
COUNT_KEYS = {'shooting:display_goals', 'defending:goals_against', 'defending:shots_against', 'discipline:offside', 'discipline:foul'}


def score_metric_groups(rows, groups):
    totals, observed = defaultdict(float), defaultdict(int)
    for row in rows:
        if row.match_end_type != 0:
            continue
        detail = row.coaching_data.get('detail', {})
        values = {
            'shooting:display_goals': recorded_team_goals(row),
            'defending:goals_against': recorded_team_goals(row, opponent=True),
            'defending:shots_against': number(row.coaching_data.get('opponent_shoot', {}), 'shootTotal'),
            'discipline:offside': number(detail, 'offsideCount'),
            'discipline:foul': number(detail, 'foul'),
        }
        for key, value in values.items():
            if value is not None:
                totals[key] += value
                observed[key] += 1
    return [{**group, 'metrics': [
        {**metric, 'value': totals[metric['id']] / observed[metric['id']] if observed[metric['id']] else None,
         'total': totals[metric['id']], 'matches': observed[metric['id']], 'record_scope': 'completed_only',
         'label': '정상 종료 ' + metric['label']} if metric['id'] in COUNT_KEYS else metric
        for metric in group['metrics']]} for group in groups]
