from __future__ import annotations

import re
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup

from app.db import utc_now_iso
from app.services.analysis_utils import normalize_nickname
from app.services.cache import CacheClient
from app.services.openapi_client import NexonOpenApiClient
from app.services.ranker_source import OFFICIAL_RANK_INNER_URL

_CACHE = CacheClient()


def parse_current_rank(html: str, nickname: str) -> dict:
    soup = BeautifulSoup(html, 'html.parser')
    updated = re.search(r'(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) 기준', soup.get_text(' ', strip=True))
    as_of = updated.group(1).replace(' ', 'T') + '+09:00' if updated else None
    for row in soup.select('.tbody > .tr'):
        name, rank = row.select_one('.rank_coach .name.profile_pointer'), row.select_one('.rank_no')
        if name is None or rank is None or normalize_nickname(name.get_text(strip=True)) != normalize_nickname(nickname):
            continue
        text = rank.get_text(strip=True).replace(',', '')
        if not text.isdigit() or int(text) < 1:
            continue
        elo = row.select_one('.rank_r_win_point')
        return {'status': 'available', 'rank': int(text), 'elo': elo.get_text(strip=True) if elo else None,
                'as_of': as_of}
    text = soup.get_text(' ', strip=True)
    if '순위 내 포함되어 있지' in text and '10,000위' in text:
        return {'status': 'outside_public_range', 'rank': None, 'as_of': as_of}
    return {'status': 'unavailable', 'rank': None}


def get_competitive_profile(ouid: str) -> dict:
    key = f'opponent_profile:v1:{ouid}'
    cached = _CACHE.get_json(key)
    if cached is not None:
        return cached
    result = {'current_rank': {'status': 'unavailable', 'rank': None}, 'highest_division': None,
              'fetched_at': utc_now_iso(), 'source_url': 'https://fconline.nexon.com/datacenter/rank'}
    try:
        client = NexonOpenApiClient(timeout_sec=6, retries=1)
    except RuntimeError:
        return result
    try:
        # 과거 경기의 닉네임이 바뀌었을 수 있어 ouid의 현재 닉네임으로 검색한다.
        basic = client._get('/fconline/v1/user/basic', {'ouid': ouid})
        nickname = basic.get('nickname') if isinstance(basic, dict) else None
        if nickname:
            response = requests.get(OFFICIAL_RANK_INNER_URL,
                                    params={'rt': '1vs1', 'n4seasonno': 0, 'n4pageno': 1,
                                            'strCharacterName': quote(nickname, safe='')}, timeout=6)
            response.raise_for_status()
            result['current_nickname'] = nickname
            result['current_rank'] = parse_current_rank(response.text, nickname)
    except (requests.RequestException, RuntimeError, ValueError):
        pass
    try:
        highest = client._get('/fconline/v1/user/maxdivision', {'ouid': ouid})
        item = next((row for row in highest if isinstance(row, dict) and row.get('matchType') == 50), None) if isinstance(highest, list) else None
        if item and isinstance(item.get('division'), int):
            metadata = _CACHE.get_json('division_metadata:v1')
            if metadata is None:
                metadata = client._get('/static/fconline/meta/division.json', {})
                if isinstance(metadata, list):
                    _CACHE.set_json('division_metadata:v1', metadata, ttl_sec=86400)
            names = {row.get('divisionId'): row.get('divisionName') for row in metadata if isinstance(row, dict)} if isinstance(metadata, list) else {}
            result['highest_division'] = {'code': item['division'], 'name': names.get(item['division'], f"등급 코드 {item['division']}"),
                                          'achieved_at': str(item['achievementDate']) + 'Z' if item.get('achievementDate') else None}
    except (requests.RequestException, RuntimeError, ValueError):
        pass
    _CACHE.set_json(key, result, ttl_sec=600 if result['highest_division'] else 60)
    return result
