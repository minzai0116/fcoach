"""실제 분포와 시도 구성을 반영한 영역별 점수."""
from math import isclose, isfinite
from statistics import mean, pstdev, quantiles

from app.services.score_specs import BASE_AREAS as AREAS, OVERALL_AREAS, supported, section, assign_weights
from app.services.score_recommendations import coaching_for_metrics
from app.services.score_sampling import PROFILE_VERSION

MIN_RECORDS = 5
SCORE_METHOD = 'ranker_usage_weighted_p90_v6'


def eligible(metric):
    value = metric.get('value')
    return value is not None and isfinite(value) and value >= 0 and metric.get('matches', 0) >= MIN_RECORDS and (
        metric.get('unit') != 'rate' or (metric.get('trials') or 0) >= 20)


def score_inputs(groups):
    result = {}
    for group in groups:
        for metric in group['metrics']:
            key = metric['id']
            if not supported(key) or metric.get('matches', 0) < MIN_RECORDS:
                continue
            if eligible(metric):
                result[key] = metric['value']
            for source, suffix in (('usage_share', '@usage'), ('attempts_per_match', '@attempts')):
                if metric.get(source) is not None:
                    result[key + suffix] = metric[source]
    return result


def standard_gap(value, center, spread, direction='higher'):
    tolerance = 1e-12 * max(1, abs(center))
    if spread <= tolerance:
        return 0.0 if isclose(value, center, rel_tol=0, abs_tol=tolerance) else None
    return (value - center) / spread * (-1 if direction == 'lower' else 1)


def distribution_scores(value, population, direction='higher'):
    center, spread = mean(population), pstdev(population)
    cuts = quantiles(population, n=10, method='inclusive')
    target = cuts[0] if direction == 'lower' else cuts[8]
    if standard_gap(value, center, spread, direction) is None:
        return None, [], target, spread
    def score(item):
        gap = standard_gap(item, target, spread, direction)
        return min(100.0, max(1.0, 100 + 10 * gap))
    return score(value), [score(item) for item in population], target, spread


def _context_mean(profiles, key):
    values = [profile[key] for profile in profiles if key in profile]
    return mean(values) if values else None


def _detail(metric, profiles, reference):
    key = metric['id']
    peers = [profile for profile in profiles if key in profile]
    population = [profile[key] for profile in peers]
    baseline = mean(population) if population else (reference or {}).get('value')
    own, peer_scores, target, spread = None, [], None, None
    status = 'context' if metric['direction'] == 'neutral' else 'record'
    if eligible(metric) and metric['direction'] != 'neutral' and len(peers) >= MIN_RECORDS:
        own, peer_scores, target, spread = distribution_scores(metric['value'], population, metric['direction'])
        if own is not None:
            cuts = quantiles(population, n=4, method='inclusive')
            side = 'higher' if metric['value'] > cuts[2] else 'lower' if metric['value'] < cuts[0] else None
            status = ('strength' if (side == 'higher') == (metric['direction'] == 'higher') else 'weakness') if side else 'within_range'
    context_peers = peers if peer_scores else profiles
    return {'id': key, 'label': metric['label'], 'section': section(key), 'unit': metric['unit'], 'direction': metric['direction'],
            'mine': metric['value'], 'reference': baseline, 'spread': spread, 'target': target,
            'score': round(own, 2) if own is not None else None,
            'reference_score': round(mean(peer_scores), 2) if peer_scores else None,
            'usage': metric.get('usage_share'), 'reference_usage': _context_mean(context_peers, key + '@usage'),
            'attempts_per_match': metric.get('attempts_per_match'), 'reference_attempts': _context_mean(context_peers, key + '@attempts'),
            'success': metric.get('success'), 'trials': metric.get('trials'),
            'matches': metric['matches'], 'record_scope': metric.get('record_scope', 'all_recorded'),
            'ranker_count': len(peers) if population else (reference or {}).get('ranker_count', 0),
            'status': status, 'weight': 0, 'point_impact': 0}


def build_domain_scores(groups, benchmark, scope=None):
    profiles = benchmark.get('score_profiles', [])
    if scope and benchmark.get('score_profile_version') != PROFILE_VERSION:
        profiles = []
    refs = {m['id']: m for g in benchmark.get('groups', []) for m in g['metrics']}
    areas = []
    for area, label, _ in AREAS:
        source = next((group['metrics'] for group in groups if group['id'] == area), [])
        metrics = [_detail(metric, profiles, refs.get(metric['id'])) for metric in source
                   if supported(metric['id']) and metric['value'] is not None]
        active = assign_weights(metrics, area)
        # 전체와 내역을 중복 가산하지 않고, 내역이 있으면 전체는 요약으로 옮긴다.
        summaries = [m for m in metrics if m['section'] == '전체' and m['weight'] == 0]
        summary_ids = {m['id'] for m in summaries}
        metrics = [m for m in metrics if m['id'] not in summary_ids]
        own_score = sum(m['score'] * m['weight'] for m in active) if active else None
        ranker_score = sum(m['reference_score'] * m['weight'] for m in active) if active else None
        areas.append({'id': area, 'label': label, 'mine': round(own_score, 1) if own_score is not None else None,
                      'reference': round(ranker_score, 1) if ranker_score is not None else None,
                      'metric_count': len(active), 'ranker_count': min((m['ranker_count'] for m in active), default=0),
                      'metrics': metrics, 'summaries': summaries, 'advice': coaching_for_metrics(metrics)})
    components = [area for area in areas if area['id'] in OVERALL_AREAS]
    complete = all(area['mine'] is not None for area in components)
    overall = {'id': 'overview', 'label': '경기 종합',
               'mine': round(mean(a['mine'] for a in components), 1) if complete else None,
               'reference': round(mean(a['reference'] for a in components), 1) if complete else None,
               'metric_count': sum(a['metric_count'] for a in components) if complete else 0,
               'ranker_count': min(a['ranker_count'] for a in components) if complete else 0,
               'component_ids': [area['id'] for area in components],
               'metrics': [], 'summaries': [], 'advice': []}
    seen = set()
    for area in sorted(components, key=lambda item: (item['mine'] or 0) - (item['reference'] or 0)):
        for advice in area['advice']:
            if advice['kind'] == 'improve' and advice['title'] not in seen:
                overall['advice'].append(advice)
                seen.add(advice['title'])
    overall['advice'] = overall['advice'][:3]
    return {'areas': [overall, *areas], 'scale': [1, 100], 'method': SCORE_METHOD, 'scope': scope,
            'note': '종합은 패스·슈팅·수비·드리블·경합 점수로 계산하고, 파울·오프사이드는 경기 운영에서 별도로 보여줍니다. 슈팅에는 실제 경기당 득점도 반영합니다. 100점은 비교 랭커의 상위 10% 기록입니다. 성공률에는 몰수 경기의 중단 전 기록도 포함하고, 경기당 득점·실점·상대 슈팅·파울·오프사이드 점수는 양쪽 모두 정상 종료 경기만 사용합니다. 상대 티어·수비 압박·시도 난이도는 보정하지 않습니다.'}
