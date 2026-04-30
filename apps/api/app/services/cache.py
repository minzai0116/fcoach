from __future__ import annotations

import json
import os
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any


@dataclass
class _MemoryValue:
    value: str
    expire_at: float


class CacheClient:
    def __init__(self) -> None:
        self._memory: dict[str, _MemoryValue] = {}
        self._memory_lock = threading.Lock()
        self._redis = None
        redis_url = os.getenv("REDIS_URL", "").strip()
        if redis_url:
            try:
                import redis

                self._redis = redis.Redis.from_url(redis_url, decode_responses=True)
                self._redis.ping()
            except Exception:
                self._redis = None

    @property
    def redis_enabled(self) -> bool:
        return self._redis is not None

    def get_json(self, key: str) -> Any | None:
        if self._redis is not None:
            try:
                payload = self._redis.get(key)
                return json.loads(payload) if payload else None
            except Exception:
                self._redis = None
        with self._memory_lock:
            cached = self._memory.get(key)
            if cached is None or cached.expire_at < time.time():
                self._memory.pop(key, None)
                return None
            return json.loads(cached.value)

    def set_json(self, key: str, value: Any, ttl_sec: int = 120) -> None:
        payload = json.dumps(value, ensure_ascii=True)
        if self._redis is not None:
            try:
                self._redis.setex(key, ttl_sec, payload)
                return
            except Exception:
                self._redis = None
        with self._memory_lock:
            self._memory[key] = _MemoryValue(value=payload, expire_at=time.time() + ttl_sec)

    def acquire_lock(self, key: str, ttl_sec: int = 30) -> str | None:
        token = uuid.uuid4().hex
        ttl_sec = max(1, ttl_sec)
        if self._redis is not None:
            try:
                ok = self._redis.set(key, token, nx=True, ex=ttl_sec)
                return token if ok else None
            except Exception:
                self._redis = None

        now = time.time()
        with self._memory_lock:
            cached = self._memory.get(key)
            if cached and cached.expire_at >= now:
                return None
            self._memory[key] = _MemoryValue(value=token, expire_at=now + ttl_sec)
            return token

    def release_lock(self, key: str, token: str | None) -> None:
        if not token:
            return
        if self._redis is not None:
            try:
                self._redis.eval(
                    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
                    1,
                    key,
                    token,
                )
                return
            except Exception:
                self._redis = None
        with self._memory_lock:
            cached = self._memory.get(key)
            if cached and cached.value == token:
                self._memory.pop(key, None)
