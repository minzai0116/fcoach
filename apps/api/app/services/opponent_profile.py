from __future__ import annotations

import requests

from app.services.cache import CacheClient
from app.services.openapi_client import NexonOpenApiClient
from app.services.user_divisions import get_user_divisions


_CACHE = CacheClient()


def get_competitive_profile(ouid: str) -> dict:
    profile = get_user_divisions(ouid)
    key = f'opponent_profile:nickname:{ouid}'
    nickname = _CACHE.get_json(key)
    if not nickname:
        try:
            client = NexonOpenApiClient(timeout_sec=5, retries=1)
            basic = client._get('/fconline/v1/user/basic', {'ouid': ouid})
            nickname = basic.get('nickname') if isinstance(basic, dict) else None
            if isinstance(nickname, str) and nickname:
                _CACHE.set_json(key, nickname, ttl_sec=600)
        except (requests.RequestException, RuntimeError, ValueError):
            pass
    return {**profile, 'current_nickname': nickname} if isinstance(nickname, str) and nickname else profile
