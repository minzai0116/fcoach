from __future__ import annotations

import json
import os
import sqlite3
import unicodedata
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator

from app.analytics_schema import EVENT_USER_NAMES, FAILURE_EVENTS, measurement_metadata, usage_summary


BASE_DIR = Path(__file__).resolve().parents[3]
DEFAULT_DB_PATH = BASE_DIR / "data" / "habit_lab.sqlite3"
MAX_NEXON_API_DATA_TTL_DAYS = 30


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clamp_nexon_api_data_ttl_days(value: Any = None) -> int:
    try:
        days = int(value if value is not None else os.getenv("NEXON_API_DATA_TTL_DAYS", "30"))
    except (TypeError, ValueError):
        days = MAX_NEXON_API_DATA_TTL_DAYS
    return max(1, min(MAX_NEXON_API_DATA_TTL_DAYS, days))


def nexon_api_data_ttl_days() -> int:
    return _clamp_nexon_api_data_ttl_days()


def nexon_api_data_cutoff_iso(days: int | None = None) -> str:
    safe_days = _clamp_nexon_api_data_ttl_days(days)
    return (datetime.now(timezone.utc) - timedelta(days=safe_days)).isoformat()


def purge_stale_nexon_api_data(days: int | None = None) -> dict[str, int | str]:
    cutoff = nexon_api_data_cutoff_iso(days)
    with db_cursor() as cur:
        cur.execute("DELETE FROM matches_raw WHERE created_at < ?", (cutoff,))
        matches_deleted = max(0, cur.rowcount)
        cur.execute("DELETE FROM user_lookup_cache WHERE updated_at < ?", (cutoff,))
        lookups_deleted = max(0, cur.rowcount)
        cur.execute("DELETE FROM official_rankers WHERE fetched_at < ?", (cutoff,))
        rankers_deleted = max(0, cur.rowcount)
        cur.execute("UPDATE user_metrics_snapshot SET coaching_json = NULL WHERE created_at < ? AND coaching_json IS NOT NULL", (cutoff,))
        cur.execute("UPDATE user_metrics_snapshot SET analysis_json = NULL WHERE created_at < ? AND analysis_json IS NOT NULL", (cutoff,))
    return {
        "cutoff": cutoff,
        "matches_raw": matches_deleted,
        "user_lookup_cache": lookups_deleted,
        "official_rankers": rankers_deleted,
    }


def _lookup_key(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value or "")
    return normalized.replace("\u200b", "").replace("\ufeff", "").strip().lower()


def get_db_path() -> Path:
    raw = os.getenv("HABIT_LAB_DB_PATH", "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return DEFAULT_DB_PATH


def connect() -> sqlite3.Connection:
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def db_cursor() -> Iterator[sqlite3.Cursor]:
    conn = connect()
    try:
        cursor = conn.cursor()
        yield cursor
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    schema = """
    CREATE TABLE IF NOT EXISTS matches_raw (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ouid TEXT NOT NULL,
      match_type INTEGER NOT NULL,
      match_id TEXT NOT NULL,
      match_date TEXT,
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(match_id, payload_hash)
    );

    CREATE TABLE IF NOT EXISTS user_metrics_snapshot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ouid TEXT NOT NULL,
      match_type INTEGER NOT NULL,
      window_size INTEGER NOT NULL,
      match_count INTEGER NOT NULL,
      win_rate REAL NOT NULL,
      goals_for REAL NOT NULL,
      goals_against REAL NOT NULL,
      xg_for REAL NOT NULL,
      xg_against REAL NOT NULL,
      issue_scores_json TEXT NOT NULL,
      kpis_json TEXT NOT NULL,
      coaching_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS action_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ouid TEXT NOT NULL,
      match_type INTEGER NOT NULL,
      window_size INTEGER NOT NULL,
      action_rank INTEGER NOT NULL,
      action_code TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      tactic_direction TEXT NOT NULL,
      tactic_delta_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS experiment_runs (
      id TEXT PRIMARY KEY,
      ouid TEXT NOT NULL,
      match_type INTEGER NOT NULL,
      action_code TEXT NOT NULL,
      action_title TEXT NOT NULL,
      window_size INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS experiment_eval (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id TEXT NOT NULL,
      ouid TEXT NOT NULL,
      match_type INTEGER NOT NULL,
      pre_window_json TEXT NOT NULL,
      post_window_json TEXT NOT NULL,
      delta_json TEXT NOT NULL,
      evaluated_at TEXT NOT NULL,
      FOREIGN KEY(experiment_id) REFERENCES experiment_runs(id)
    );

    CREATE TABLE IF NOT EXISTS official_rankers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL,
      rank_no INTEGER NOT NULL,
      nickname TEXT NOT NULL,
      ouid TEXT,
      elo REAL,
      win_rate REAL,
      win_count INTEGER,
      draw_count INTEGER,
      loss_count INTEGER,
      formation TEXT,
      team_color TEXT,
      fetched_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'fconline_datacenter_rank',
      UNIQUE(mode, rank_no)
    );

    CREATE TABLE IF NOT EXISTS user_lookup_cache (
      nickname TEXT PRIMARY KEY,
      ouid TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'nexon_open_api',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_name TEXT NOT NULL,
      distinct_id TEXT,
      session_id TEXT,
      path TEXT,
      screen TEXT,
      referrer TEXT,
      properties_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_matches_raw_ouid_type_date
      ON matches_raw (ouid, match_type, match_date DESC);

    CREATE INDEX IF NOT EXISTS idx_matches_raw_ouid_type_match
      ON matches_raw (ouid, match_type, match_id);

    CREATE INDEX IF NOT EXISTS idx_matches_raw_created_at
      ON matches_raw (created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_metrics_latest
      ON user_metrics_snapshot (ouid, match_type, window_size, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_actions_latest
      ON action_cards (ouid, match_type, window_size, created_at DESC, action_rank ASC);

    CREATE INDEX IF NOT EXISTS idx_experiment_runs_lookup
      ON experiment_runs (ouid, match_type, started_at DESC);

    CREATE INDEX IF NOT EXISTS idx_official_rankers_mode
      ON official_rankers (mode, rank_no);

    CREATE INDEX IF NOT EXISTS idx_official_rankers_mode_ouid
      ON official_rankers (mode, ouid);

    CREATE INDEX IF NOT EXISTS idx_official_rankers_mode_fetched_at
      ON official_rankers (mode, fetched_at DESC, rank_no);

    CREATE INDEX IF NOT EXISTS idx_user_lookup_updated_at
      ON user_lookup_cache (updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at
      ON analytics_events (created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_analytics_events_event_name
      ON analytics_events (event_name, created_at DESC);
    """
    with db_cursor() as cur:
        cur.executescript(schema)
        columns = {row[1] for row in cur.execute("PRAGMA table_info(user_metrics_snapshot)")}
        if "coaching_json" not in columns:
            cur.execute("ALTER TABLE user_metrics_snapshot ADD COLUMN coaching_json TEXT")
        if "analysis_json" not in columns:
            cur.execute("ALTER TABLE user_metrics_snapshot ADD COLUMN analysis_json TEXT")
        cur.execute(
            """
            DELETE FROM matches_raw
            WHERE id NOT IN (
              SELECT MAX(id)
              FROM matches_raw
              GROUP BY ouid, match_type, match_id
            )
            """
        )
    purge_stale_nexon_api_data()


def upsert_matches(
    ouid: str,
    match_type: int,
    rows: Iterable[dict[str, Any]],
) -> int:
    inserted = 0
    seen_match_ids: set[str] = set()
    with db_cursor() as cur:
        for row in rows:
            match_id = str(row.get("match_id", "")).strip()
            if not match_id or match_id in seen_match_ids:
                continue
            seen_match_ids.add(match_id)
            payload_json = json.dumps(row["payload"], ensure_ascii=True)
            cur.execute(
                """
                SELECT 1
                FROM matches_raw
                WHERE ouid = ? AND match_type = ? AND match_id = ?
                LIMIT 1
                """,
                (ouid, match_type, match_id),
            )
            existed = cur.fetchone() is not None
            cur.execute(
                """
                DELETE FROM matches_raw
                WHERE ouid = ? AND match_type = ? AND match_id = ?
                """,
                (ouid, match_type, match_id),
            )
            cur.execute(
                """
                INSERT INTO matches_raw (
                    ouid, match_type, match_id, match_date, payload_json, payload_hash, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ouid,
                    match_type,
                    match_id,
                    row.get("match_date"),
                    payload_json,
                    row["payload_hash"],
                    utc_now_iso(),
                ),
            )
            if not existed:
                inserted += 1
        cur.execute(
            """
            DELETE FROM matches_raw
            WHERE ouid = ? AND match_type = ?
              AND id NOT IN (
                SELECT MAX(id)
                FROM matches_raw
                WHERE ouid = ? AND match_type = ?
                GROUP BY match_id
              )
            """,
            (ouid, match_type, ouid, match_type),
        )
    return inserted


def get_user_lookup(nickname: str) -> dict[str, str] | None:
    target = nickname.strip()
    if not target:
        return None
    keys = [target]
    normalized = _lookup_key(target)
    if normalized and normalized != target:
        keys.append(normalized)
    with db_cursor() as cur:
        placeholders = ",".join("?" for _ in keys)
        cur.execute(
            f"""
            SELECT nickname, ouid, source, updated_at
            FROM user_lookup_cache
            WHERE nickname IN ({placeholders})
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            keys,
        )
        row = cur.fetchone()
    if row is None:
        return None
    return {
        "nickname": str(row["nickname"]),
        "ouid": str(row["ouid"]),
        "source": str(row["source"]),
        "updated_at": str(row["updated_at"]),
    }


def save_user_lookup(nickname: str, ouid: str, source: str = "nexon_open_api") -> None:
    target_nickname = nickname.strip()
    target_ouid = ouid.strip()
    if not target_nickname or not target_ouid:
        return
    lookup_keys = [target_nickname]
    normalized = _lookup_key(target_nickname)
    if normalized and normalized != target_nickname:
        lookup_keys.append(normalized)
    with db_cursor() as cur:
        now = utc_now_iso()
        for lookup_key in lookup_keys:
            cur.execute(
                """
                INSERT INTO user_lookup_cache (nickname, ouid, source, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(nickname) DO UPDATE SET
                  ouid = excluded.ouid,
                  source = excluded.source,
                  updated_at = excluded.updated_at
                """,
                (lookup_key, target_ouid, source, now),
            )


def insert_analytics_event(
    event_name: str,
    distinct_id: str | None = None,
    session_id: str | None = None,
    path: str | None = None,
    screen: str | None = None,
    referrer: str | None = None,
    properties: dict[str, Any] | None = None,
) -> None:
    payload = properties or {}
    with db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO analytics_events (
                event_name, distinct_id, session_id, path, screen, referrer, properties_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_name.strip()[:120],
                (distinct_id or "").strip()[:120] or None,
                (session_id or "").strip()[:120] or None,
                (path or "").strip()[:255] or None,
                (screen or "").strip()[:120] or None,
                (referrer or "").strip()[:255] or None,
                json.dumps(payload, ensure_ascii=True),
                utc_now_iso(),
            ),
        )


def _safe_json_object(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def get_analytics_summary(hours: int = 24, limit: int = 20) -> dict[str, Any]:
    safe_hours = max(1, min(24 * 30, int(hours)))
    safe_limit = max(1, min(100, int(limit)))
    now = datetime.now(timezone.utc)
    since = (now - timedelta(hours=safe_hours)).isoformat()
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT event_name, COUNT(*) AS event_count
            FROM analytics_events
            WHERE created_at >= ?
            GROUP BY event_name
            ORDER BY event_count DESC
            """,
            (since,),
        )
        event_rows = cur.fetchall()
        event_counts = {str(row["event_name"]): int(row["event_count"]) for row in event_rows}
        new_visitors = event_counts.get("visitor_first_seen", 0)
        returning_visitors = event_counts.get("visitor_return", 0)
        visitor_lifecycle_events = new_visitors + returning_visitors
        cur.execute(
            """
            SELECT COUNT(*) AS total_events,
                   COUNT(DISTINCT COALESCE(NULLIF(distinct_id, ''), NULLIF(session_id, ''))) AS unique_users
            FROM analytics_events
            WHERE created_at >= ?
            """,
            (since,),
        )
        aggregate = cur.fetchone()
        cur.execute(
            """
            SELECT path, COUNT(*) AS page_views
            FROM analytics_events
            WHERE created_at >= ? AND event_name = 'page_view'
            GROUP BY path
            ORDER BY page_views DESC
            LIMIT ?
            """,
            (since, safe_limit),
        )
        page_rows = cur.fetchall()
        cur.execute(
            """SELECT COALESCE(json_extract(properties_json, '$.hostname'), 'unknown') AS hostname, COUNT(*) AS count
               FROM analytics_events WHERE created_at >= ? AND event_name = 'page_view' GROUP BY hostname""",
            (since,),
        )
        host_rows = cur.fetchall()
        cur.execute(
            f"""SELECT event_name, COUNT(*) AS event_count,
                       COUNT(DISTINCT COALESCE(NULLIF(distinct_id, ''), NULLIF(session_id, ''))) AS unique_users
                FROM analytics_events WHERE created_at >= ? AND event_name IN ({','.join('?' for _ in EVENT_USER_NAMES)})
                GROUP BY event_name""",
            (since, *EVENT_USER_NAMES),
        )
        user_rows = cur.fetchall()
        event_counts.update({str(row["event_name"]): int(row["event_count"]) for row in user_rows})
        event_users = {str(row["event_name"]): int(row["unique_users"]) for row in user_rows}
        cur.execute(
            f"""
            SELECT event_name, path, screen, properties_json, created_at
            FROM analytics_events
            WHERE created_at >= ?
              AND event_name IN ({','.join('?' for _ in FAILURE_EVENTS)})
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (since, *FAILURE_EVENTS, safe_limit),
        )
        failure_rows = cur.fetchall()
    return {
        "hours": safe_hours,
        "since": since,
        "until": now.isoformat(),
        "time_zone": "UTC",
        "aggregation": "exact_timestamps",
        "source": "sqlite",
        "measurement": measurement_metadata(),
        **usage_summary(event_counts, event_users),
        "total_events": int(aggregate["total_events"]) if aggregate else 0,
        "unique_users": int(aggregate["unique_users"]) if aggregate else 0,
        "new_visitors": new_visitors,
        "returning_visitors": returning_visitors,
        "return_rate": returning_visitors / visitor_lifecycle_events if visitor_lifecycle_events else 0.0,
        "events": [
            {
                "event_name": str(row["event_name"]),
                "count": int(row["event_count"]),
            }
            for row in event_rows[:safe_limit]
        ],
        "event_counts": event_counts,
        "page_views": [
            {
                "path": str(row["path"] or "/"),
                "count": int(row["page_views"]),
            }
            for row in page_rows
        ],
        "page_view_hosts": [{"hostname": row["hostname"], "count": int(row["count"])} for row in host_rows],
        "event_users": [{"event_name": name, "unique_users": event_users.get(name, 0)} for name in EVENT_USER_NAMES],
        "recent_failures": [
            {
                "event_name": str(row["event_name"] or ""),
                "path": str(row["path"] or "/"),
                "screen": str(row["screen"] or ""),
                "created_at": str(row["created_at"] or ""),
                "properties": _safe_json_object(row["properties_json"]),
            }
            for row in failure_rows
        ],
    }
