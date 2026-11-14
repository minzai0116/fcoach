"""이번 시즌 공식경기 티어와 역대 최고 티어를 조회한다."""
import re
from datetime import date, datetime, timedelta, timezone

import requests
from bs4 import BeautifulSoup

from app.db import utc_now_iso
from app.services.cache import CacheClient
from app.services.openapi_client import NexonOpenApiClient

_CACHE = CacheClient()
_OFFICIAL_RANK_URL = 'https://fconline.nexon.com/datacenter/rank'
_KST = timezone(timedelta(hours=9))
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


def _previous_season_end(today):
    key = 'user_divisions:previous_season_end:v1'
    cached = _CACHE.get_json(key)
    if cached is not None:
        return date.fromisoformat(cached['end']) if cached.get('end') else None
    response = requests.get(_OFFICIAL_RANK_URL, params={'rt': '1vs1'}, timeout=4)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, 'html.parser')
    options = soup.select('.wrap_season a[onclick]')
    end = None
    if len(options) >= 2 and re.fullmatch(r'ChangeSeason\(0\);?', options[0]['onclick']):
        previous = re.search(r'\d{4}-\d{2}-\d{2}\s*~\s*(\d{4}-\d{2}-\d{2})\)', options[1].get_text(strip=True))
        if previous:
            end = date.fromisoformat(previous.group(1))
    if end and end <= today:
        _CACHE.set_json(key, {'end': end.isoformat()}, ttl_sec=300)
        return end
    _CACHE.set_json(key, {'end': None}, ttl_sec=30)
    return None


def _official_match_day(value):
    if not isinstance(value, str) or 'T' not in value:
        return None
    try:
        timestamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    # Open API의 시간대 없는 경기 시각은 UTC로 제공된다.
    return (timestamp if timestamp.tzinfo else timestamp.replace(tzinfo=timezone.utc)).astimezone(_KST).date()


def _current_tier(client, ouid, names, season_end):
    source = 'latest_official_match'
    ids = client.fetch_match_ids(ouid, 50, limit=1)
    if not ids:
        return _tier(None, {}, None, source) | {'status': 'no_current_season_match'}
    match = client.fetch_match_detail(ids[0])
    participant = next((row for row in match.get('matchInfo') or [] if isinstance(row, dict) and row.get('ouid') == ouid), None)
    match_date = match.get('matchDate')
    day = _official_match_day(match_date)
    if match.get('matchType') != 50 or participant is None or day is None:
        return _tier(None, {}, None, source)
    if day < season_end:
        return _tier(None, {}, None, source) | {'status': 'no_current_season_match'}
    if day == season_end:
        # 공식 랭킹의 시즌 목록은 날짜만 제공하므로 점검 전후를 구별할 수 없다.
        return _tier(None, {}, None, source)
    return _tier(participant.get('division'), names, match_date, source)


def get_user_divisions(ouid):
    today = datetime.now(_KST).date()
    try:
        season_end = _previous_season_end(today)
    except (requests.RequestException, ValueError):
        season_end = None
    key = f'user_divisions:v3:{today}:{season_end}:{ouid}'
    if (cached := _CACHE.get_json(key)) is not None:
        return cached
    result = {'current': _tier(None, {}, None, 'latest_official_match'),
              'highest': _tier(None, {}, None, 'maxdivision'), 'fetched_at': utc_now_iso()}
    try:
        client = NexonOpenApiClient(timeout_sec=5, retries=1)
        names = _names(client)
    except (requests.RequestException, RuntimeError, ValueError, TypeError):
        return result
    if season_end is not None and today > season_end:
        try:
            result['current'] = _current_tier(client, ouid, names, season_end)
        except (requests.RequestException, RuntimeError, ValueError, TypeError, AttributeError):
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
