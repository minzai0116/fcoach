from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timedelta, timezone
from collections import defaultdict, deque
from typing import Any

import requests
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

from app.db import (
    get_user_lookup,
    init_db,
    save_user_lookup,
    upsert_matches,
)
from app.models import AnalysisRunRequest, EventTrackRequest, ExperimentCreateRequest, UserSearchResponse
from app.services.analysis import (
    create_experiment,
    evaluate_latest_experiment,
    get_latest_experiment,
    get_latest_actions,
    get_latest_analysis,
    run_analysis,
)
from app.services.cache import CacheClient
from app.services.analytics_store import get_analytics_summary, record_analytics_event
from app.services.analysis_utils import normalize_nickname
from app.services.openapi_client import NexonOpenApiClient, OpenApiRateLimitError
from app.services.ranker_source import ensure_official_rankers, fetch_official_rankers, list_official_rankers


app = FastAPI(title="FC Habit Lab API", version="0.1.0")
cache = CacheClient()
_LAST_AUTO_RANKER_SYNC_AT: datetime | None = None
_LAST_AUTO_RANKER_SYNC_ERROR: str | None = None
_RANKER_SYNC_LOCK = threading.Lock()
_MATCH_SYNC_INFLIGHT: set[tuple[str, int]] = set()
_MATCH_SYNC_LAST_ATTEMPT: dict[tuple[str, int], datetime] = {}
_MATCH_SYNC_GUARD_LOCK = threading.Lock()
_RATE_LIMIT_BUCKETS: dict[str, deque[float]] = defaultdict(deque)
_RATE_LIMIT_LOCK = threading.Lock()
_USER_SEARCH_LOCKS: dict[str, threading.Lock] = {}
_USER_SEARCH_LOCKS_GUARD = threading.Lock()


def _user_lookup_cache_ttl_sec() -> int:
    raw = os.getenv("HABIT_LAB_USER_LOOKUP_CACHE_TTL_SEC", "2592000").strip()
    try:
        return max(3600, min(7776000, int(raw)))
    except Exception:
        return 2592000


def _analysis_cache_ttl_sec() -> int:
    raw = os.getenv("HABIT_LAB_ANALYSIS_RESULT_CACHE_TTL_SEC", "45").strip()
    try:
        return max(15, min(300, int(raw)))
    except Exception:
        return 45


def _user_search_lock(key: str) -> threading.Lock:
    with _USER_SEARCH_LOCKS_GUARD:
        lock = _USER_SEARCH_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _USER_SEARCH_LOCKS[key] = lock
        if len(_USER_SEARCH_LOCKS) > 5000:
            for stale_key in list(_USER_SEARCH_LOCKS)[:1000]:
                if stale_key != key:
                    _USER_SEARCH_LOCKS.pop(stale_key, None)
        return lock


def _is_truthy(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _can_auto_ranker_sync() -> bool:
    enabled = _is_truthy(os.getenv("HABIT_LAB_AUTO_RANKER_SYNC", "0"))
    has_api_key = bool(os.getenv("NEXON_OPEN_API_KEY", "").strip())
    return enabled and has_api_key


def _ensure_daily_rankers(force: bool = False) -> None:
    global _LAST_AUTO_RANKER_SYNC_AT, _LAST_AUTO_RANKER_SYNC_ERROR
    if not _can_auto_ranker_sync():
        return
    now = datetime.now(timezone.utc)
    if not force and _LAST_AUTO_RANKER_SYNC_AT and now - _LAST_AUTO_RANKER_SYNC_AT < timedelta(hours=24):
        return
    try:
        ensure_official_rankers(
            mode="1vs1",
            match_type=50,
            pages=2,
            max_rankers=30,
            per_ranker_matches=8,
            max_age_hours=24,
            force_refresh=False,
        )
        _LAST_AUTO_RANKER_SYNC_ERROR = None
    except Exception as exc:
        _LAST_AUTO_RANKER_SYNC_ERROR = str(exc)
    finally:
        _LAST_AUTO_RANKER_SYNC_AT = datetime.now(timezone.utc)


def _trigger_ranker_sync_async(force: bool = False) -> bool:
    if not _can_auto_ranker_sync():
        return False
    acquired = _RANKER_SYNC_LOCK.acquire(blocking=False)
    if not acquired:
        return False

    def _worker() -> None:
        try:
            _ensure_daily_rankers(force=force)
        finally:
            _RANKER_SYNC_LOCK.release()

    thread = threading.Thread(target=_worker, name="ranker-sync-worker", daemon=True)
    thread.start()
    return True


def _match_sync_cooldown_seconds() -> int:
    raw = os.getenv("HABIT_LAB_MATCH_SYNC_COOLDOWN_SEC", "60").strip()
    try:
        return max(30, min(3600, int(raw)))
    except Exception:
        return 60


def _trigger_match_sync_async(ouid: str, match_type: int, desired_matches: int) -> bool:
    if not bool(os.getenv("NEXON_OPEN_API_KEY", "").strip()):
        return False
    if desired_matches <= 0:
        return False
    key = (ouid.strip(), int(match_type))
    if not key[0]:
        return False
    now = datetime.now(timezone.utc)
    with _MATCH_SYNC_GUARD_LOCK:
        if key in _MATCH_SYNC_INFLIGHT:
            return False
        last_attempt = _MATCH_SYNC_LAST_ATTEMPT.get(key)
        cooldown = timedelta(seconds=_match_sync_cooldown_seconds())
        if last_attempt and now - last_attempt < cooldown:
            return False
        _MATCH_SYNC_INFLIGHT.add(key)
        _MATCH_SYNC_LAST_ATTEMPT[key] = now

    def _worker() -> None:
        try:
            client = NexonOpenApiClient(timeout_sec=15, retries=2)
            safe_limit = max(10, min(60, int(desired_matches)))
            rows = client.collect_match_rows(ouid=key[0], match_type=key[1], limit=safe_limit)
            if rows:
                upsert_matches(ouid=key[0], match_type=key[1], rows=rows)
        except Exception:
            pass
        finally:
            with _MATCH_SYNC_GUARD_LOCK:
                _MATCH_SYNC_INFLIGHT.discard(key)

    thread = threading.Thread(target=_worker, name=f"match-sync-{key[1]}", daemon=True)
    thread.start()
    return True


def _allowed_origins() -> list[str]:
    raw = os.getenv("HABIT_LAB_CORS_ORIGINS", "").strip()
    default_origins = [
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "https://fcoach.fun",
        "https://www.fcoach.fun",
        "https://fcoach.com",
        "https://www.fcoach.com",
        "https://fcoach.org",
        "https://www.fcoach.org",
    ]
    if raw:
        origins = [origin.strip() for origin in raw.split(",") if origin.strip().lower() != "null"]
        if origins:
            return origins
    return default_origins


def _allowed_origin_regex() -> str | None:
    raw = os.getenv("HABIT_LAB_CORS_ORIGIN_REGEX", "").strip()
    if raw:
        return raw
    if _is_truthy(os.getenv("HABIT_LAB_ALLOW_VERCEL_PREVIEW_ORIGIN", "1")):
        return r"^https://.*\.vercel\.app$"
    return None


def _client_ip(request: Request) -> str:
    forwarded_for = (request.headers.get("x-forwarded-for") or "").strip()
    if forwarded_for:
        return forwarded_for.split(",")[0].strip() or "unknown"
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _enforce_rate_limit(request: Request, scope: str, max_requests: int, window_sec: int) -> None:
    now = time.time()
    key = f"{scope}:{_client_ip(request)}"
    with _RATE_LIMIT_LOCK:
        bucket = _RATE_LIMIT_BUCKETS[key]
        cutoff = now - window_sec
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if len(bucket) >= max_requests:
            retry_after = max(1, int(window_sec - (now - bucket[0])) + 1)
            raise HTTPException(
                status_code=429,
                detail=f"요청이 너무 많습니다. 약 {retry_after}초 후 다시 시도해주세요.",
            )
        bucket.append(now)
        if len(_RATE_LIMIT_BUCKETS) > 5000:
            stale_keys = [name for name, entries in _RATE_LIMIT_BUCKETS.items() if not entries]
            for stale_key in stale_keys[:1000]:
                _RATE_LIMIT_BUCKETS.pop(stale_key, None)


def _is_analytics_summary_enabled() -> bool:
    return _is_truthy(os.getenv("HABIT_LAB_ENABLE_ANALYTICS_SUMMARY", "0"))


def _require_analytics_admin_key(header_value: str | None) -> None:
    expected = os.getenv("HABIT_LAB_ANALYTICS_ADMIN_KEY", "").strip()
    if not expected:
        raise HTTPException(status_code=404, detail="Not Found")
    candidate = (header_value or "").strip()
    if not candidate or candidate != expected:
        raise HTTPException(status_code=403, detail="forbidden")


def _require_sync_admin_key(header_value: str | None) -> None:
    expected = os.getenv("HABIT_LAB_SYNC_ADMIN_KEY", "").strip()
    if not expected:
        raise HTTPException(status_code=404, detail="Not Found")
    candidate = (header_value or "").strip()
    if not candidate or candidate != expected:
        raise HTTPException(status_code=403, detail="forbidden")


def _forward_event_to_posthog(payload: EventTrackRequest) -> None:
    api_key = os.getenv("POSTHOG_API_KEY", "").strip()
    if not api_key:
        return
    host = os.getenv("POSTHOG_HOST", "https://us.i.posthog.com").strip().rstrip("/")
    distinct_id = (payload.distinct_id or payload.session_id or "anonymous").strip() or "anonymous"
    properties = dict(payload.properties or {})
    if payload.path:
        properties.setdefault("$current_url", payload.path)
    if payload.referrer:
        properties.setdefault("$referrer", payload.referrer)
    if payload.screen:
        properties.setdefault("screen", payload.screen)
    try:
        requests.post(
            f"{host}/capture/",
            json={
                "api_key": api_key,
                "event": payload.event_name,
                "distinct_id": distinct_id,
                "properties": properties,
            },
            timeout=1.2,
        )
    except Exception:
        return


_cors_kwargs: dict[str, Any] = {
    "allow_origins": _allowed_origins(),
    "allow_credentials": False,
    "allow_methods": ["GET", "POST", "OPTIONS"],
    "allow_headers": ["Content-Type", "x-admin-key"],
}
_origin_regex = _allowed_origin_regex()
if _origin_regex:
    _cors_kwargs["allow_origin_regex"] = _origin_regex
app.add_middleware(CORSMiddleware, **_cors_kwargs)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    headers = response.headers
    headers.setdefault("X-Content-Type-Options", "nosniff")
    headers.setdefault("X-Frame-Options", "DENY")
    headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if request.url.scheme == "https":
        headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
    return response


@app.on_event("startup")
def startup() -> None:
    init_db()
    _trigger_ranker_sync_async(force=False)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/users/search", response_model=UserSearchResponse)
def users_search(request: Request, nickname: str = Query(..., min_length=2)) -> UserSearchResponse:
    _enforce_rate_limit(request, scope="users_search", max_requests=12, window_sec=60)
    target_nickname = nickname.strip()
    normalized_nickname = normalize_nickname(target_nickname)
    if not normalized_nickname:
        raise HTTPException(status_code=400, detail="닉네임을 입력해주세요.")
    cache_key = f"user_search:{normalized_nickname}"
    cache_ttl = _user_lookup_cache_ttl_sec()

    cached = cache.get_json(cache_key)
    if cached:
        return UserSearchResponse(**cached)

    cached_lookup = get_user_lookup(target_nickname)
    if cached_lookup and cached_lookup.get("ouid", "").strip():
        payload = {
            "ouid": str(cached_lookup["ouid"]),
            "nickname": target_nickname,
            "source": "sqlite_user_lookup_cache",
        }
        cache.set_json(cache_key, payload, ttl_sec=cache_ttl)
        return UserSearchResponse(**payload)

    lock = _user_search_lock(normalized_nickname)
    with lock:
        cached = cache.get_json(cache_key)
        if cached:
            return UserSearchResponse(**cached)

        cached_lookup = get_user_lookup(target_nickname)
        if cached_lookup and cached_lookup.get("ouid", "").strip():
            payload = {
                "ouid": str(cached_lookup["ouid"]),
                "nickname": target_nickname,
                "source": "sqlite_user_lookup_cache",
            }
            cache.set_json(cache_key, payload, ttl_sec=cache_ttl)
            return UserSearchResponse(**payload)

        cooldown = NexonOpenApiClient.cooldown_remaining_sec()
        if cooldown > 0:
            raise HTTPException(
                status_code=429,
                detail=f"닉네임 조회 호출이 많아 잠시 제한되었습니다. 약 {int(round(cooldown))}초 후 다시 시도해주세요.",
            )

        distributed_lock_key = f"lock:user_search:{normalized_nickname}"
        distributed_lock_token = cache.acquire_lock(distributed_lock_key, ttl_sec=20)
        if distributed_lock_token is None:
            time.sleep(0.25)
            cached = cache.get_json(cache_key)
            if cached:
                return UserSearchResponse(**cached)
            cached_lookup = get_user_lookup(target_nickname)
            if cached_lookup and cached_lookup.get("ouid", "").strip():
                payload = {
                    "ouid": str(cached_lookup["ouid"]),
                    "nickname": target_nickname,
                    "source": "sqlite_user_lookup_cache",
                }
                cache.set_json(cache_key, payload, ttl_sec=cache_ttl)
                return UserSearchResponse(**payload)
            raise HTTPException(status_code=429, detail="같은 닉네임 조회가 처리 중입니다. 잠시 후 다시 시도해주세요.")

        try:
            client = NexonOpenApiClient()
            payload = client.find_user_by_nickname(target_nickname)
        except OpenApiRateLimitError as exc:
            if cached_lookup and cached_lookup.get("ouid", "").strip():
                payload = {
                    "ouid": str(cached_lookup["ouid"]),
                    "nickname": target_nickname,
                    "source": "sqlite_user_lookup_cache_stale",
                }
                cache.set_json(cache_key, payload, ttl_sec=cache_ttl)
                return UserSearchResponse(**payload)
            wait_seconds = int(round(exc.wait_seconds or 0))
            if wait_seconds > 0:
                raise HTTPException(
                    status_code=429,
                    detail=f"닉네임 조회 호출이 많아 잠시 제한되었습니다. 약 {wait_seconds}초 후 다시 시도해주세요.",
                ) from exc
            raise HTTPException(status_code=429, detail="닉네임 조회 호출이 많아 잠시 제한되었습니다. 1~2분 후 다시 시도해주세요.") from exc
        except requests.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else 502
            if status_code == 429:
                if cached_lookup and cached_lookup.get("ouid", "").strip():
                    payload = {
                        "ouid": str(cached_lookup["ouid"]),
                        "nickname": target_nickname,
                        "source": "sqlite_user_lookup_cache_stale",
                    }
                    cache.set_json(cache_key, payload, ttl_sec=cache_ttl)
                    return UserSearchResponse(**payload)
                raise HTTPException(status_code=429, detail="닉네임 조회 호출이 많아 잠시 제한되었습니다. 1~2분 후 다시 시도해주세요.") from exc
            raise HTTPException(status_code=status_code, detail=f"user search failed: {exc}") from exc
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"user search failed: {exc}") from exc

        finally:
            cache.release_lock(distributed_lock_key, distributed_lock_token)

        save_user_lookup(target_nickname, str(payload.get("ouid", "")).strip(), source="nexon_open_api")
        cache.set_json(cache_key, payload, ttl_sec=cache_ttl)
        return UserSearchResponse(**payload)


@app.post("/analysis/run")
def analysis_run(request: Request, req: AnalysisRunRequest) -> dict[str, Any]:
    _enforce_rate_limit(request, scope="analysis_run", max_requests=8, window_sec=60)
    cache_key = f"latest_analysis:{req.ouid}:{req.match_type}:{req.window}"
    lock_key = f"lock:analysis_run:{req.ouid}:{req.match_type}:{req.window}"
    lock_token = cache.acquire_lock(lock_key, ttl_sec=60)
    if lock_token is None:
        cached = cache.get_json(cache_key)
        if cached:
            cached["refresh_warning"] = "동일한 분석이 처리 중이라 최근 분석 결과를 먼저 보여줍니다."
            return cached
        raise HTTPException(status_code=429, detail="동일한 분석이 처리 중입니다. 잠시 후 다시 시도해주세요.")
    try:
        result = run_analysis(
            ouid=req.ouid,
            match_type=int(req.match_type),
            window_size=int(req.window),
            current_tactic=req.current_tactic,
            manual_refresh_probe=True,
        )
        if int(result.get("sample_count", 0)) <= 0:
            retry = run_analysis(
                ouid=req.ouid,
                match_type=int(req.match_type),
                window_size=int(req.window),
                current_tactic=req.current_tactic,
                force_bootstrap_sync=True,
                manual_refresh_probe=True,
            )
            if int(retry.get("sample_count", 0)) > 0:
                result = retry
        else:
            _trigger_match_sync_async(
                ouid=req.ouid,
                match_type=int(req.match_type),
                desired_matches=max(int(req.window), 12),
            )
        cache.set_json(
            cache_key,
            result,
            ttl_sec=_analysis_cache_ttl_sec(),
        )
        return result
    finally:
        cache.release_lock(lock_key, lock_token)


@app.get("/analysis/latest")
def analysis_latest(
    ouid: str,
    match_type: int = Query(..., ge=1),
    window: int = Query(30, ge=5),
) -> dict[str, Any]:
    cache_key = f"latest_analysis:{ouid}:{match_type}:{window}"
    cached = cache.get_json(cache_key)
    if cached:
        return cached
    payload = get_latest_analysis(ouid=ouid, match_type=match_type, window_size=window)
    if payload is None:
        raise HTTPException(status_code=404, detail="No analysis snapshot found")
    cache.set_json(cache_key, payload, ttl_sec=120)
    return payload


@app.get("/actions/latest")
def actions_latest(
    ouid: str,
    match_type: int = Query(..., ge=1),
    window: int = Query(30, ge=5),
) -> dict[str, Any]:
    payload = get_latest_actions(ouid=ouid, match_type=match_type, window_size=window)
    if not payload:
        raise HTTPException(status_code=404, detail="No action cards found")
    return {"ouid": ouid, "match_type": match_type, "window_size": window, "actions": payload}


@app.post("/experiments")
def experiments_create(req: ExperimentCreateRequest) -> dict[str, Any]:
    return create_experiment(req.model_dump())


@app.get("/experiments/latest")
def experiments_latest(
    ouid: str,
    match_type: int = Query(..., ge=1),
) -> dict[str, Any]:
    payload = get_latest_experiment(ouid=ouid, match_type=match_type)
    if payload is None:
        return {"exists": False}
    return {"exists": True, **payload}


@app.get("/experiments/evaluation")
def experiments_evaluation(
    ouid: str,
    match_type: int = Query(..., ge=1),
) -> dict[str, Any]:
    payload = evaluate_latest_experiment(ouid=ouid, match_type=match_type)
    if payload is None:
        raise HTTPException(status_code=404, detail="No experiment found")
    return payload


@app.post("/events/track")
def events_track(request: Request, req: EventTrackRequest) -> dict[str, Any]:
    _enforce_rate_limit(request, scope="events_track", max_requests=120, window_sec=60)
    event_name = req.event_name.strip()
    if not event_name:
        raise HTTPException(status_code=400, detail="event_name is required")
    record_analytics_event(
        event_name=event_name,
        distinct_id=req.distinct_id,
        session_id=req.session_id,
        path=req.path,
        screen=req.screen,
        referrer=req.referrer,
        properties=req.properties,
    )
    _forward_event_to_posthog(req)
    return {"ok": True}


@app.get("/events/summary")
def events_summary(
    hours: int = Query(24, ge=1, le=24 * 30),
    limit: int = Query(20, ge=1, le=100),
    x_admin_key: str | None = Header(default=None, alias="x-admin-key"),
) -> dict[str, Any]:
    if not _is_analytics_summary_enabled():
        raise HTTPException(status_code=404, detail="Not Found")
    _require_analytics_admin_key(x_admin_key)
    return get_analytics_summary(hours=hours, limit=limit)


@app.post("/debug/ingest")
def debug_ingest(ouid: str, match_type: int = Query(...), max_matches: int = Query(30, ge=1, le=200)) -> dict[str, Any]:
    if not _is_truthy(os.getenv("HABIT_LAB_ENABLE_DEBUG_ENDPOINTS", "0")):
        raise HTTPException(status_code=404, detail="Not Found")
    # Debug endpoint to speed up local demos without separate CLI calls.
    try:
        client = NexonOpenApiClient()
        rows = client.collect_match_rows(ouid=ouid, match_type=match_type, limit=max_matches)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"ingest failed: {exc}") from exc
    inserted = upsert_matches(ouid=ouid, match_type=match_type, rows=rows)
    return {"fetched": len(rows), "inserted": inserted}


@app.post("/rankers/refresh")
def rankers_refresh(
    request: Request,
    mode: str = Query("1vs1"),
    pages: int = Query(2, ge=1, le=5),
    max_rankers: int = Query(30, ge=5, le=80),
    per_ranker_matches: int = Query(8, ge=1, le=20),
    x_admin_key: str | None = Header(default=None, alias="x-admin-key"),
) -> dict[str, Any]:
    _enforce_rate_limit(request, scope="rankers_refresh", max_requests=3, window_sec=300)
    _require_sync_admin_key(x_admin_key)
    return ensure_official_rankers(
        mode=mode,
        match_type=50,
        pages=pages,
        max_rankers=max_rankers,
        per_ranker_matches=per_ranker_matches,
        max_age_hours=12,
        force_refresh=True,
    )


@app.get("/rankers/latest")
def rankers_latest(request: Request, mode: str = Query("1vs1"), limit: int = Query(20, ge=1, le=100)) -> dict[str, Any]:
    _enforce_rate_limit(request, scope="rankers_latest", max_requests=30, window_sec=60)
    _trigger_ranker_sync_async(force=False)
    rows = list_official_rankers(mode=mode, limit=limit)
    if not rows:
        try:
            fetched = fetch_official_rankers(mode=mode, pages=1, timeout_sec=12)[: max(1, limit)]
            fetched_at = datetime.now(timezone.utc).isoformat()
            rows = [
                {
                    "mode": mode,
                    "rank_no": int(row.get("rank_no", 0)),
                    "nickname": str(row.get("nickname", "")),
                    "ouid": None,
                    "elo": float(row.get("elo", 0.0)),
                    "win_rate": float(row.get("win_rate", 0.0)),
                    "win_count": int(row.get("win_count", 0)),
                    "draw_count": int(row.get("draw_count", 0)),
                    "loss_count": int(row.get("loss_count", 0)),
                    "formation": str(row.get("formation", "")),
                    "team_color": str(row.get("team_color", "")),
                    "fetched_at": fetched_at,
                    "source": "fconline_datacenter_live",
                }
                for row in fetched
            ]
        except Exception as exc:
            global _LAST_AUTO_RANKER_SYNC_ERROR, _LAST_AUTO_RANKER_SYNC_AT
            _LAST_AUTO_RANKER_SYNC_ERROR = str(exc)
            _LAST_AUTO_RANKER_SYNC_AT = datetime.now(timezone.utc)
    mapped_count = sum(
        1
        for row in rows
        if row.get("ouid") is not None and str(row.get("ouid", "")).strip()
    )
    return {
        "mode": mode,
        "count": len(rows),
        "mapped_ouid_count": mapped_count,
        "rankers": rows,
        "sync": {
            "auto_enabled": _can_auto_ranker_sync(),
            "in_progress": _RANKER_SYNC_LOCK.locked(),
            "last_attempt_at": _LAST_AUTO_RANKER_SYNC_AT.isoformat() if _LAST_AUTO_RANKER_SYNC_AT else None,
            "last_error": _LAST_AUTO_RANKER_SYNC_ERROR,
        },
    }
