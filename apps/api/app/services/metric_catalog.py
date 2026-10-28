"""화면·경기 흐름·랭커 비교가 같은 집계 정의를 사용한다."""
from app.services.domain_coaching import build_domain_coaching
from app.services.passing_coaching import build_passing_coaching

LOWER = {'goals_against', 'shots_against', 'offside', 'foul', 'yellow', 'red', 'yellow_cards', 'red_cards', 'own_goals'}
NEUTRAL = {'possession', 'team_distance', 'dribble_distance', 'corner', 'injury', 'shootout_shots', 'defending_actions', 'intercept', 'late_conceded'}
GROUP_ORDER = ('overview', 'passing', 'shooting', 'defending', 'carrying', 'discipline')


def metric_catalog(rows, *, include_forfeits=True):
    groups = {}
    for domain in build_domain_coaching(rows, include_forfeits=include_forfeits):
        metrics = []
        for metric in domain['metrics']:
            key, unit = metric['metric'], metric['unit']
            factor = 0.9144 if unit == 'yards' else 1
            value = metric['value']
            if metric.get('total') is not None and metric['observed_matches']:
                value = metric['total'] / metric['observed_matches']
            metrics.append({'id': f"{domain['id']}:{key}", 'label': metric['label'],
                'unit': 'meters' if unit == 'yards' else unit,
                'value': round(value * factor, 6) if value is not None else None,
                'success': metric.get('success'), 'trials': metric.get('trials'),
                'usage_share': metric.get('usage_share'),
                'attempts_per_match': metric.get('trials', 0) / metric['observed_matches'] if metric.get('trials') is not None and metric['observed_matches'] and key not in NEUTRAL else None,
                'total': metric['total'] * factor if 'total' in metric else None,
                'matches': metric['observed_matches'],
                'direction': 'lower' if key in LOWER else 'neutral' if key in NEUTRAL else 'higher'})
        groups[domain['id']] = {'id': domain['id'], 'label': domain['label'], 'metrics': metrics}
    passing = build_passing_coaching(rows, 50, include_forfeits=include_forfeits)
    overall = passing['overall']
    type_overall = passing['type_overall']
    pass_metrics = [{'id': 'passing:overall', 'label': '전체 패스 성공률', 'unit': 'rate',
                     'value': overall['success_rate'], 'success': overall['success'], 'trials': overall['trials'],
                     'total': None, 'matches': passing['observed_matches'], 'direction': 'higher'}]
    remainder = passing['remainder']
    types = [*passing['types'], {'metric': 'unclassified', 'label': '미분류 패스', **remainder,
              'success_rate': remainder['success'] / remainder['trials'] if remainder['trials'] else None,
              'usage_share': remainder['trials'] / type_overall['trials'] if type_overall['trials'] else None,
              'observed_matches': passing['type_observed_matches']}]
    for item in types:
        for suffix, label, value, success, trials in (
            ('success', f"{item['label']} 성공률", item['success_rate'], item['success'], item['trials']),
            ('usage', f"{item['label']} 사용 비중", item['usage_share'], item['trials'], type_overall['trials']),
        ):
            pass_metrics.append({'id': f"passing:{item['metric']}:{suffix}", 'label': label, 'unit': 'rate',
                'value': value, 'success': success, 'trials': trials, 'total': None,
                'matches': item['observed_matches'], 'direction': 'neutral' if suffix == 'usage' or item['metric'] == 'unclassified' else 'higher',
                'usage_share': item['usage_share'] if suffix == 'success' else None,
                'attempts_per_match': item['trials'] / item['observed_matches'] if suffix == 'success' and item['observed_matches'] else None})
    groups['passing'] = {'id': 'passing', 'label': '패스', 'metrics': pass_metrics}
    return [groups[key] for key in GROUP_ORDER]
