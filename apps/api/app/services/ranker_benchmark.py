from collections import defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
from statistics import quantiles, pstdev

from app.db import nexon_api_data_ttl_days, utc_now_iso
from app.services.cache import CacheClient
from app.services.metric_catalog import metric_catalog
from app.services.domain_scores import score_inputs
from app.services.ranker_source import list_official_rankers

CACHE_KEY = 'rankers:benchmark:v5'
LAST_VALID_KEY = f'{CACHE_KEY}:last_valid'
_CACHE = CacheClient()
_BUNDLED_SNAPSHOT = Path(__file__).resolve().parents[1] / 'data' / 'ranker-benchmark.json'


def _snapshot_age(snapshot):
    if not snapshot or snapshot.get('status') != 'available':
        return None
    try:
        fetched = datetime.fromisoformat(snapshot['ranking_fetched_at'].replace('Z', '+00:00'))
        if fetched.tzinfo is None:
            fetched = fetched.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - fetched).total_seconds()
    except (KeyError, TypeError, ValueError):
        return None


def cached_ranker_benchmark(max_age_hours=None):
    limit = min(nexon_api_data_ttl_days() * 86400, max_age_hours * 3600) if max_age_hours is not None else nexon_api_data_ttl_days() * 86400
    for key in (CACHE_KEY, LAST_VALID_KEY):
        snapshot = _CACHE.get_json(key)
        age = _snapshot_age(snapshot)
        if age is not None and 0 <= age < limit:
            return snapshot
    return None


def store_ranker_benchmark(snapshot):
    age = _snapshot_age(snapshot)
    if age is None or not 0 <= age < nexon_api_data_ttl_days() * 86400:
        return
    _CACHE.set_json(CACHE_KEY, snapshot, ttl_sec=3600)
    # 새 인스턴스의 빈 SQLite가 마지막 실제 집계를 덮어쓰지 않게 한다.
    _CACHE.set_json(LAST_VALID_KEY, snapshot, ttl_sec=max(1, int(nexon_api_data_ttl_days() * 86400 - age)))


def prime_ranker_benchmark():
    cached = cached_ranker_benchmark()
    if cached:
        return cached
    try:
        snapshot = json.loads(_BUNDLED_SNAPSHOT.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    age = _snapshot_age(snapshot)
    if age is not None and 0 <= age < nexon_api_data_ttl_days() * 86400:
        store_ranker_benchmark(snapshot)
        return snapshot
    return None


def aggregate_rankers(profiles, listed_count, fetched_at=None):
    samples, usage, templates, members, dates, match_ids = defaultdict(list), defaultdict(list), {}, [], [], set()
    score_profiles = []
    for member, rows in profiles:
        rows = sorted((row for row in rows if row.match_end_type == 0), key=lambda row: (row.match_date, row.match_id), reverse=True)[:30]
        if not rows:
            continue
        members.append({'rank': member['rank_no'], 'nickname': member['nickname'], 'matches': len(rows)})
        dates.extend(row.match_date for row in rows)
        match_ids.update(row.match_id for row in rows)
        personal_groups = metric_catalog(rows)
        score_profiles.append(score_inputs(personal_groups))
        for group in personal_groups:
            templates.setdefault(group['id'], {'id': group['id'], 'label': group['label'], 'metrics': {}})
            for metric in group['metrics']:
                templates[group['id']]['metrics'][metric['id']] = metric
                if metric['value'] is not None:
                    samples[metric['id']].append((metric['value'], metric['matches']))
                    if metric.get('usage_share') is not None:
                        usage[metric['id']].append(metric['usage_share'])
    groups = []
    for group in templates.values():
        metrics = []
        for key, metric in group['metrics'].items():
            values = samples[key]
            if not values:
                continue
            distribution = [value for value, _ in values]
            quartiles = quantiles(distribution, n=4, method='inclusive') if len(distribution) > 1 else [distribution[0]] * 3
            metrics.append({**{name: metric[name] for name in ('id', 'label', 'unit', 'direction')},
                'value': round(sum(value for value, _ in values) / len(values), 6),
                'q1': quartiles[0], 'q3': quartiles[2], 'spread': pstdev(distribution),
                'usage_share': sum(usage[key]) / len(usage[key]) if usage[key] else None,
                'ranker_count': len(values), 'matches': sum(count for _, count in values)})
        groups.append({'id': group['id'], 'label': group['label'], 'metrics': metrics})
    return {'status': 'available' if members else 'unavailable', 'listed_count': listed_count,
        'ranker_count': len(members), 'record_count': sum(member['matches'] for member in members),
        'unique_match_count': len(match_ids), 'members': members, 'groups': groups, 'score_profiles': score_profiles,
        'ranking_fetched_at': fetched_at, 'computed_at': utc_now_iso(),
        'match_from': min(dates) if dates else None, 'match_until': max(dates) if dates else None,
        'method': 'equal_ranker_mean_latest_30_normal_official',
        'note': '공식 1대1 랭커 중 실제 경기 기록이 연결된 인원의 최근 정상 종료 공식경기(각 최대 30경기)를 사용합니다. 먼저 각 랭커의 지표를 계산한 뒤 인원별 동일 가중치로 평균냅니다. 지표별 기록이 없으면 해당 평균에서 제외하며 실제 참여 인원을 표시합니다. 경기 수가 많은 랭커가 평균을 더 크게 좌우하지 않습니다. 상대·선수 구성·전술이 달라 수치 차이만으로 원인이나 실력 차이를 확정하지 않습니다.'}


def get_ranker_benchmark(refresh=False):
    cached = prime_ranker_benchmark()
    if cached and not refresh:
        return cached
    from app.services.analysis import _available_match_stats
    members = list_official_rankers(limit=20)
    seen, profiles = set(), []
    for member in members:
        ouid = member.get('ouid')
        if not ouid or ouid in seen:
            continue
        seen.add(ouid)
        profiles.append((member, _available_match_stats(ouid, 50)))
    result = aggregate_rankers(profiles, len(members), max((m['fetched_at'] for m in members), default=None))
    if result['status'] == 'available':
        store_ranker_benchmark(result)
    return result if result['status'] == 'available' else cached or result
