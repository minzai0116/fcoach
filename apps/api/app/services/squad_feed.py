from __future__ import annotations

import re
from datetime import datetime, timezone

import requests

from app.services.analysis_utils import normalize_nickname
from app.services.cache import CacheClient
from app.services.squad_feed_data import integer, normalize_snapshot


_ENDPOINT = 'https://fconline.nexon.com/squadmakerapi/SquadMakerFeedProc'
_cache = CacheClient()


class SquadFeedError(Exception):
    def __init__(self, message: str, status_code: int = 503):
        super().__init__(message)
        self.status_code = status_code


def validate_feed_id(feed_id: str) -> str:
    if not re.fullmatch(r'[A-Za-z0-9]{8,32}', feed_id):
        raise SquadFeedError('올바른 공개 피드 ID가 아닙니다.', 400)
    return feed_id


def _request(payload: dict) -> dict:
    try:
        response = requests.post(_ENDPOINT, json=payload, headers={'Referer': 'https://fconline.nexon.com/SquadMaker/feed/all'},
                                 timeout=(3, 10), allow_redirects=False)
        if response.status_code in (401, 403, 404):
            raise SquadFeedError('공개 피드를 읽을 수 없습니다. 비공개·삭제 여부를 확인해주세요.', 404)
        response.raise_for_status()
        body = response.json()
    except (requests.RequestException, ValueError) as error:
        raise SquadFeedError('공식 피드 조회가 지연되거나 응답이 바뀌었습니다. 잠시 후 다시 불러오세요.') from error
    if not isinstance(body, dict) or type(body.get('ResultCode')) is not int or body['ResultCode'] != 1:
        raise SquadFeedError('공개 피드를 읽을 수 없습니다. 비공개·삭제 또는 조회 제한 상태일 수 있습니다.', 404)
    data = body.get('ResultData')
    if not isinstance(data, dict):
        raise SquadFeedError('공식 피드의 응답 형식을 확인할 수 없습니다.')
    return data


def search_public_feeds(nickname: str, page: int = 1) -> dict:
    nickname = nickname.strip()
    if not 2 <= len(nickname) <= 100 or not 1 <= page <= 20:
        raise SquadFeedError('닉네임 또는 페이지 범위를 확인해주세요.', 400)
    name = normalize_nickname(nickname)
    cache_key = f'squad_feed:list:v1:{name}:{page}'
    cached = _cache.get_json(cache_key)
    if cached is not None:
        return cached
    data = _request({'strMethod': 'search', 'n4PageNo': page, 'Feed_Param': {'n4FeedType': 1, 'n4OrderBy2': 0, 'strWriterName': nickname}})
    if not isinstance(data.get('FeedList'), list):
        raise SquadFeedError('공식 피드 목록의 응답 형식을 확인할 수 없습니다.')
    now, items = datetime.now(timezone.utc).isoformat(), []
    for raw in data['FeedList']:
        if not isinstance(raw, dict) or normalize_nickname(str(raw.get('strWriterName') or '')) != name:
            continue
        feed_id = str(raw.get('strFeedId') or '')
        if not re.fullmatch(r'[A-Za-z0-9]{8,32}', feed_id):
            continue
        item = {'feed_id': feed_id, 'title': str(raw.get('strTitle') or '제목 없음')[:200],
                'author': str(raw['strWriterName']).strip(), 'created_at': raw.get('dtCreateDate') if isinstance(raw.get('dtCreateDate'), str) else None,
                'formation': str(raw.get('strFormation') or '미제공')[:30], 'mode': integer(raw.get('n4Mode'), 1, 2)}
        items.append(item)
        _cache.set_json(f'squad_feed:summary:v1:{feed_id}', item, ttl_sec=300)
    total = integer(data.get('n4TotalCnt ', data.get('n4TotalCnt')), 0, 10_000_000)
    if total is None:
        raise SquadFeedError('공식 피드 목록의 페이지 정보를 확인할 수 없습니다.')
    result = {'nickname': nickname, 'items': items, 'page': page, 'has_more': page * 10 < total and page < 20, 'fetched_at': now}
    _cache.set_json(cache_key, result, ttl_sec=60)
    return result


def get_public_feed(feed_id: str, *, refresh: bool = False) -> dict:
    validate_feed_id(feed_id)
    key = f'squad_feed:detail:v5:{feed_id}'
    if not refresh:
        cached = _cache.get_json(key)
        if cached is not None:
            return cached
    # 분석 실행 시에는 공개 상태를 다시 확인하며, 실패하면 이전 설정을 대신 쓰지 않는다.
    try:
        data = _request({'strMethod': 'feedinfo', 'strFeedId': feed_id})
        squad = data.get('SquadInfo')
        if not isinstance(squad, dict) or not isinstance(squad.get('players'), list):
            raise SquadFeedError('공식 피드 상세의 응답 형식을 확인할 수 없습니다.')
        result = normalize_snapshot(data, feed_id, datetime.now(timezone.utc).isoformat(), _cache.get_json(f'squad_feed:summary:v1:{feed_id}'))
    except SquadFeedError:
        _cache.set_json(key, None, ttl_sec=1)
        raise
    _cache.set_json(key, result, ttl_sec=300)
    return result
