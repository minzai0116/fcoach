from collections import defaultdict, deque

from app.services.metric_catalog import metric_catalog
from app.services.match_selection import eligible_match_rows


def build_match_trends(rows, points=30, window=30):
    ordered = sorted(eligible_match_rows(rows, True, True), key=lambda row: (row.match_date, row.match_id))
    # 표시할 30개 시점의 직전 29경기까지만 필요하다.
    ordered = ordered[-(points + window - 1):]
    queue, sums, templates, series = deque(), defaultdict(lambda: [0.0, 0.0, 0.0, 0]), {}, defaultdict(list)
    group_meta, point_meta = {}, []
    for index, row in enumerate(ordered):
        groups = metric_catalog([row])
        current = {}
        for group in groups:
            group_meta.setdefault(group['id'], {'id': group['id'], 'label': group['label'], 'ids': []})
            for metric in group['metrics']:
                key = metric['id']
                if key not in templates:
                    group_meta[group['id']]['ids'].append(key)
                    series[key] = [{'value': None, 'observed_matches': 0} for _ in point_meta]
                templates[key] = {name: metric[name] for name in ('id', 'label', 'unit', 'direction')}
                if metric['matches'] > 0:
                    current[key] = (metric['success'] or 0, metric['trials'] or 0, metric['total'] or 0, metric['matches'])
        queue.append(current)
        for key, values in current.items():
            sums[key] = [a + b for a, b in zip(sums[key], values)]
        if len(queue) > window:
            for key, values in queue.popleft().items():
                sums[key] = [a - b for a, b in zip(sums[key], values)]
        if index < max(0, len(ordered) - points):
            continue
        point_meta.append({'date': row.match_date, 'match_type': row.match_type, 'match_end_type': row.match_end_type,
                           'result': row.result, 'window_matches': len(queue)})
        for key, template in templates.items():
            success, trials, total, observed = sums[key]
            value = success / trials if trials else None
            if template['unit'] != 'rate':
                value = total / observed if observed else None
            series[key].append({'observed_matches': int(observed), 'success': success, 'trials': trials,
                'value': round(value, 6) if value is not None else None})
    result = []
    for group in group_meta.values():
        metrics = []
        for key in group['ids']:
            history = series[key]
            if not any(point['value'] is not None for point in history):
                continue
            metrics.append({**templates[key], 'history': history})
        result.append({'id': group['id'], 'label': group['label'], 'metrics': metrics})
    return {'window_size': window, 'point_count': len(point_meta), 'points': point_meta, 'groups': result,
            'method': 'rolling_success_over_trials_or_mean',
            'note': '각 경기 시점까지 최근 30경기입니다. 몰수 경기는 중단 전 실제 기록을 포함하며, 성공률은 성공 합계 ÷ 시도 합계입니다. 종료 시간을 추정하거나 90분으로 환산하지 않습니다.'}
