from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any


@dataclass
class _MemoryValue:
    value: str
    expire_at: float


class CacheClient:
    def __init__(self) -> None:
        self._memory: dict[str, _MemoryValue] = {}
        self._redis = None
        redis_url = os.getenv("REDIS_URL", "").strip()
        if redis_url:
            try:
                import redis

                self._redis = redis.Redis.from_url(redis_url, decode_responses=True)
                self._redis.ping()
            except Exception:
                self._redis = None

    def get_json(self, key: str) -> Any | None:
        if self._redis is not None:
            payload = self._redis.get(key)
            return json.loads(payload) if payload else None
        cached = self._memory.get(key)
        if cached is None or cached.expire_at < time.time():
            self._memory.pop(key, None)
            return None
        return json.loads(cached.value)

    def set_json(self, key: str, value: Any, ttl_sec: int = 120) -> None:
        payload = json.dumps(value, ensure_ascii=True)
        if self._redis is not None:
            self._redis.setex(key, ttl_sec, payload)
            return
        self._memory[key] = _MemoryValue(value=payload, expire_at=time.time() + ttl_sec)

