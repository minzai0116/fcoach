from collections import defaultdict, deque

from app.services.metric_catalog import metric_catalog


def build_match_trends(rows, points=30, window=30):
    ordered = sorted((row for row in rows if row.match_end_type == 0), key=lambda row: (row.match_date, row.match_id))
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
        point_meta.append({'date': row.match_date, 'match_type': row.match_type, 'window_matches': len(queue)})
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
            'note': '각 경기 시점까지의 최근 30개 정상 종료 경기로 집계합니다. 성공률은 성공 합계 ÷ 시도 합계, 횟수·거리는 경기당 평균입니다. 초반에 확보된 경기가 30개 미만이면 해당 경기 수를 표시합니다.'}
