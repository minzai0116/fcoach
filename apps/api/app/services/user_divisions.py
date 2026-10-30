"""최근 공식경기 당시 티어와 역대 최고 티어를 구분한다."""
import requests

from app.db import utc_now_iso
from app.services.cache import CacheClient
from app.services.openapi_client import NexonOpenApiClient

_CACHE = CacheClient()
# 공식 랭킹의 2026 엠블럼 순서. 마스터 등급 때문에 등급 코드의 단순 산술 변환은 맞지 않는다.
_EMBLEMS = {code: f'https://ssl.nexon.com/s2/game/fo4/obt/rank/large/update_2026/ico_rank{index}.png'
            for index, code in enumerate((800, 900, 1000, 1100, 1200, 1300, 1700, 1800, 1900,
                                          2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700, 2800, 2900, 3000, 3100))}


def _names(client):
    data = _CACHE.get_json('user_divisions:metadata')
    if data is None:
        data = client._get('/static/fconline/meta/division.json', {})
        if isinstance(data, list):
            _CACHE.set_json('user_divisions:metadata', data, ttl_sec=86400)
    return {row.get('divisionId'): row.get('divisionName') for row in data if isinstance(row, dict)} if isinstance(data, list) else {}


def _tier(code, names, as_of, source):
    if isinstance(code, int) and not isinstance(code, bool) and names.get(code):
        return {'status': 'available', 'name': names[code], 'icon_url': _EMBLEMS.get(code), 'as_of': as_of, 'source': source}
    return {'status': 'unavailable', 'name': None, 'icon_url': None, 'as_of': as_of, 'source': source}


def get_user_divisions(ouid):
    key = 'user_divisions:v2:' + ouid
    cached = _CACHE.get_json(key)
    if cached is not None:
        return cached
    result = {'current': _tier(None, {}, None, 'latest_official_match'),
              'highest': _tier(None, {}, None, 'maxdivision'), 'fetched_at': utc_now_iso()}
    try:
        client = NexonOpenApiClient(timeout_sec=5, retries=1)
        names = _names(client)
    except (requests.RequestException, RuntimeError, ValueError, TypeError):
        return result
    try:
        from app.services.analysis import _available_match_stats
        rows = _available_match_stats(ouid, 50)
        latest = max(rows, key=lambda row: (row.match_date, row.match_id)) if rows else None
        code = latest.coaching_data.get('division') if latest else None
        date = latest.match_date if latest else None
        # 친선만 분석했거나 예전 저장 형식이면 최신 공식경기 한 건으로 확인한다.
        if code is None:
            ids = client.fetch_match_ids(ouid, 50, limit=1)
            if ids:
                match = client.fetch_match_detail(ids[0])
                participant = next((row for row in match.get('matchInfo', []) if row.get('ouid') == ouid), {})
                code, date = participant.get('division'), match.get('matchDate')
        result['current'] = _tier(int(code) if isinstance(code, (int, float)) and not isinstance(code, bool) and code == int(code) else None,
                                  names, date, 'latest_official_match')
    except (requests.RequestException, RuntimeError, ValueError, TypeError):
        pass
    try:
        highest = client._get('/fconline/v1/user/maxdivision', {'ouid': ouid})
        item = next((row for row in highest if isinstance(row, dict) and row.get('matchType') == 50), None) if isinstance(highest, list) else None
        if item:
            result['highest'] = _tier(item.get('division'), names, item.get('achievementDate'), 'maxdivision')
    except (requests.RequestException, RuntimeError, ValueError, TypeError):
        pass
    _CACHE.set_json(key, result, ttl_sec=300 if result['current']['name'] and result['highest']['name'] else 30)
    return result
