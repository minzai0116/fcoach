from __future__ import annotations

import os
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

import requests
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.db import (
    get_analytics_summary,
    get_user_lookup,
    init_db,
    insert_analytics_event,
    save_user_lookup,
    upsert_matches,
)
from app.models import AnalysisRunRequest, EventTrackRequest, ExperimentCreateRequest, UserSearchResponse
from app.services.analysis import (
    create_experiment,
    evaluate_latest_experiment,
    get_latest_actions,
    get_latest_analysis,
    run_analysis,
)
from app.services.cache import CacheClient
from app.services.openapi_client import NexonOpenApiClient
from app.services.ranker_source import ensure_official_rankers, list_official_rankers


app = FastAPI(title="FC Habit Lab API", version="0.1.0")
cache = CacheClient()
_LAST_AUTO_RANKER_SYNC_AT: datetime | None = None
_LAST_AUTO_RANKER_SYNC_ERROR: str | None = None
_RANKER_SYNC_LOCK = threading.Lock()


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


def _allowed_origins() -> list[str]:
    raw = os.getenv("HABIT_LAB_CORS_ORIGINS", "").strip()
    if raw:
        origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
        if origins:
            return origins
    return ["http://127.0.0.1:3000", "http://localhost:3000"]


def _is_analytics_summary_enabled() -> bool:
    return _is_truthy(os.getenv("HABIT_LAB_ENABLE_ANALYTICS_SUMMARY", "0"))


def _require_analytics_admin_key(header_value: str | None) -> None:
    expected = os.getenv("HABIT_LAB_ANALYTICS_ADMIN_KEY", "").strip()
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


app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db()
    _trigger_ranker_sync_async(force=False)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/users/search", response_model=UserSearchResponse)
def users_search(nickname: str = Query(..., min_length=2)) -> UserSearchResponse:
    target_nickname = nickname.strip()
    cache_key = f"user_search:{target_nickname}"
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
        cache.set_json(cache_key, payload, ttl_sec=21600)
        return UserSearchResponse(**payload)

    try:
        client = NexonOpenApiClient()
        payload = client.find_user_by_nickname(target_nickname)
    except requests.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else 502
        if status_code == 429:
            if cached_lookup and cached_lookup.get("ouid", "").strip():
                payload = {
                    "ouid": str(cached_lookup["ouid"]),
                    "nickname": target_nickname,
                    "source": "sqlite_user_lookup_cache_stale",
                }
                cache.set_json(cache_key, payload, ttl_sec=21600)
                return UserSearchResponse(**payload)
            raise HTTPException(status_code=429, detail="닉네임 조회 호출이 많아 잠시 제한되었습니다. 1~2분 후 다시 시도해주세요.") from exc
        raise HTTPException(status_code=status_code, detail=f"user search failed: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"user search failed: {exc}") from exc

    save_user_lookup(target_nickname, str(payload.get("ouid", "")).strip(), source="nexon_open_api")
    cache.set_json(cache_key, payload, ttl_sec=21600)
    return UserSearchResponse(**payload)


@app.post("/analysis/run")
def analysis_run(req: AnalysisRunRequest) -> dict[str, Any]:
    _trigger_ranker_sync_async(force=False)
    result = run_analysis(
        ouid=req.ouid,
        match_type=int(req.match_type),
        window_size=int(req.window),
        current_tactic=req.current_tactic,
    )
    cache.set_json(
        f"latest_analysis:{req.ouid}:{req.match_type}:{req.window}",
        result,
        ttl_sec=120,
    )
    return result


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
def events_track(req: EventTrackRequest) -> dict[str, Any]:
    event_name = req.event_name.strip()
    if not event_name:
        raise HTTPException(status_code=400, detail="event_name is required")
    insert_analytics_event(
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
    mode: str = Query("1vs1"),
    pages: int = Query(2, ge=1, le=5),
    max_rankers: int = Query(30, ge=5, le=80),
    per_ranker_matches: int = Query(8, ge=1, le=20),
) -> dict[str, Any]:
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
def rankers_latest(mode: str = Query("1vs1"), limit: int = Query(20, ge=1, le=100)) -> dict[str, Any]:
    _trigger_ranker_sync_async(force=False)
    rows = list_official_rankers(mode=mode, limit=limit)
    if not rows and bool(os.getenv("NEXON_OPEN_API_KEY", "").strip()):
        try:
            ensure_official_rankers(
                mode=mode,
                match_type=50,
                pages=1,
                max_rankers=max(20, limit),
                per_ranker_matches=5,
                max_age_hours=24,
                force_refresh=False,
            )
            rows = list_official_rankers(mode=mode, limit=limit)
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
