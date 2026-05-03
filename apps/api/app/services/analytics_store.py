from __future__ import annotations

import json
import os
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from app.db import get_analytics_summary as get_sqlite_analytics_summary
from app.db import insert_analytics_event as insert_sqlite_analytics_event


_PREFIX = "fcoach:analytics:v1"
_FAILURE_EVENTS = {"search_user_failed", "run_analysis_failed", "adopt_action_failed"}


def _ttl_sec() -> int:
    raw = os.getenv("HABIT_LAB_REDIS_ANALYTICS_TTL_SEC", str(60 * 60 * 24 * 45)).strip()
    try:
        return max(60 * 60 * 24, min(60 * 60 * 24 * 180, int(raw)))
    except Exception:
        return 60 * 60 * 24 * 45


def _safe_hours(hours: int) -> int:
    return max(1, min(24 * 30, int(hours)))


def _safe_limit(limit: int) -> int:
    return max(1, min(100, int(limit)))


def _bucket_key(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%d%H")


def _hour_buckets(since: datetime, now: datetime) -> list[str]:
    cursor = since.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    end = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    buckets: list[str] = []
    while cursor <= end:
        buckets.append(_bucket_key(cursor))
        cursor += timedelta(hours=1)
    return buckets


class RedisAnalyticsStore:
    def __init__(self) -> None:
        self._redis = None
        redis_url = os.getenv("REDIS_URL", "").strip()
        if not redis_url:
            return
        try:
            import redis

            self._redis = redis.Redis.from_url(redis_url, decode_responses=True)
            self._redis.ping()
        except Exception:
            self._redis = None

    @property
    def enabled(self) -> bool:
        return self._redis is not None

    def record(
        self,
        *,
        event_name: str,
        distinct_id: str | None = None,
        session_id: str | None = None,
        path: str | None = None,
        screen: str | None = None,
        referrer: str | None = None,
        properties: dict[str, Any] | None = None,
    ) -> bool:
        if self._redis is None:
            return False
        now = datetime.now(timezone.utc)
        bucket = _bucket_key(now)
        event_key = f"{_PREFIX}:events:{bucket}"
        users_key = f"{_PREFIX}:users:{bucket}"
        paths_key = f"{_PREFIX}:paths:{bucket}"
        failures_key = f"{_PREFIX}:failures:{bucket}"
        ttl = _ttl_sec()
        try:
            pipe = self._redis.pipeline(transaction=False)
            pipe.hincrby(event_key, event_name, 1)
            pipe.expire(event_key, ttl)
            user_key = (distinct_id or session_id or "").strip()
            if user_key:
                pipe.sadd(users_key, user_key[:160])
                pipe.expire(users_key, ttl)
            if event_name == "page_view":
                pipe.hincrby(paths_key, (path or "/")[:255], 1)
                pipe.expire(paths_key, ttl)
            if event_name in _FAILURE_EVENTS:
                payload = {
                    "event_name": event_name,
                    "path": path or "/",
                    "screen": screen or "",
                    "created_at": now.isoformat(),
                    "properties": properties or {},
                    "referrer": referrer or "",
                }
                pipe.lpush(failures_key, json.dumps(payload, ensure_ascii=False, default=str))
                pipe.ltrim(failures_key, 0, 99)
                pipe.expire(failures_key, ttl)
            pipe.execute()
            return True
        except Exception:
            self._redis = None
            return False

    def summary(self, *, hours: int = 24, limit: int = 20) -> dict[str, Any]:
        if self._redis is None:
            return get_sqlite_analytics_summary(hours=hours, limit=limit)
        safe_hours = _safe_hours(hours)
        safe_limit = _safe_limit(limit)
        now = datetime.now(timezone.utc)
        since = now - timedelta(hours=safe_hours)
        event_counts: Counter[str] = Counter()
        path_counts: Counter[str] = Counter()
        users: set[str] = set()
        failures: list[dict[str, Any]] = []
        try:
            for bucket in _hour_buckets(since, now):
                event_counts.update({key: int(value) for key, value in self._redis.hgetall(f"{_PREFIX}:events:{bucket}").items()})
                path_counts.update({key or "/": int(value) for key, value in self._redis.hgetall(f"{_PREFIX}:paths:{bucket}").items()})
                users.update(self._redis.smembers(f"{_PREFIX}:users:{bucket}"))
                for raw in self._redis.lrange(f"{_PREFIX}:failures:{bucket}", 0, safe_limit * 2):
                    parsed = _safe_json(raw)
                    if parsed and str(parsed.get("created_at", "")) >= since.isoformat():
                        failures.append(parsed)
        except Exception:
            self._redis = None
            return get_sqlite_analytics_summary(hours=hours, limit=limit)

        failures.sort(key=lambda item: str(item.get("created_at", "")), reverse=True)
        new_visitors = int(event_counts.get("visitor_first_seen", 0))
        returning_visitors = int(event_counts.get("visitor_return", 0))
        visitor_lifecycle_events = new_visitors + returning_visitors
        return {
            "hours": safe_hours,
            "since": since.isoformat(),
            "source": "redis",
            "total_events": int(sum(event_counts.values())),
            "unique_users": len(users),
            "new_visitors": new_visitors,
            "returning_visitors": returning_visitors,
            "return_rate": returning_visitors / visitor_lifecycle_events if visitor_lifecycle_events else 0.0,
            "events": [
                {"event_name": event_name, "count": count}
                for event_name, count in event_counts.most_common(safe_limit)
            ],
            "page_views": [
                {"path": path or "/", "count": count}
                for path, count in path_counts.most_common(safe_limit)
            ],
            "recent_failures": failures[:safe_limit],
        }


def _safe_json(raw: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


_STORE = RedisAnalyticsStore()


def record_analytics_event(
    *,
    event_name: str,
    distinct_id: str | None = None,
    session_id: str | None = None,
    path: str | None = None,
    screen: str | None = None,
    referrer: str | None = None,
    properties: dict[str, Any] | None = None,
) -> None:
    event_name = event_name.strip()[:120]
    if not event_name:
        return
    _STORE.record(
        event_name=event_name,
        distinct_id=distinct_id,
        session_id=session_id,
        path=path,
        screen=screen,
        referrer=referrer,
        properties=properties,
    )
    try:
        insert_sqlite_analytics_event(
            event_name=event_name,
            distinct_id=distinct_id,
            session_id=session_id,
            path=path,
            screen=screen,
            referrer=referrer,
            properties=properties,
        )
    except Exception:
        pass


def get_analytics_summary(hours: int = 24, limit: int = 20) -> dict[str, Any]:
    if _STORE.enabled:
        return _STORE.summary(hours=hours, limit=limit)
    payload = get_sqlite_analytics_summary(hours=hours, limit=limit)
    payload["source"] = "sqlite"
    return payload
