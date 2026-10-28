from __future__ import annotations

from threading import Lock
from time import monotonic
from typing import Callable

import requests

from app.services.analysis_constants import SPID_META_URL


def name_index(players: list[dict], id_key: str = 'id') -> dict[int, str]:
    names, identities = {}, {}
    for player in players:
        if not isinstance(player, dict):
            continue
        try:
            sp_id = int(player.get(id_key))
        except (TypeError, ValueError):
            continue
        name = str(player.get('name') or '').strip()
        if sp_id <= 0 or not name:
            continue
        names[sp_id] = name
        identities.setdefault(sp_id % 1_000_000, set()).add(name)
    # 새 시즌 카드가 목록에 늦게 반영돼도 동일 선수 번호의 공식 이름을 사용한다.
    for pid, candidates in identities.items():
        if len(candidates) == 1:
            names.setdefault(pid, next(iter(candidates)))
    return names


def player_name(names: dict[int, str], sp_id: int, fallback: str | None = '이름 확인 중') -> str | None:
    return names.get(sp_id) or names.get(sp_id % 1_000_000) or fallback


def _load_names() -> object:
    response = requests.get(SPID_META_URL, timeout=8)
    response.raise_for_status()
    return response.json()


class PlayerNameCatalog:
    def __init__(self, loader: Callable = _load_names, clock: Callable = monotonic):
        self._loader, self._clock = loader, clock
        self._names: dict[int, str] = {}
        self._refresh_at = 0.0
        self._lock = Lock()

    def get(self) -> dict[int, str]:
        with self._lock:
            now = self._clock()
            if now < self._refresh_at:
                return self._names
            try:
                payload = self._loader()
                names = name_index(payload) if isinstance(payload, list) else {}
            except (requests.RequestException, ValueError):
                names = {}
            if names:
                self._names = names
            # 실패한 빈 응답을 영구 캐시하지 않고 직전 정상 목록을 유지한다.
            self._refresh_at = now + (3600 if names else 60)
            return self._names


player_name_catalog = PlayerNameCatalog()
