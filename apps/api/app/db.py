from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator


BASE_DIR = Path(__file__).resolve().parents[3]
DEFAULT_DB_PATH = BASE_DIR / "data" / "habit_lab.sqlite3"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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

    CREATE INDEX IF NOT EXISTS idx_matches_raw_ouid_type_date
      ON matches_raw (ouid, match_type, match_date DESC);

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

    CREATE INDEX IF NOT EXISTS idx_user_lookup_updated_at
      ON user_lookup_cache (updated_at DESC);
    """
    with db_cursor() as cur:
        cur.executescript(schema)


def upsert_matches(
    ouid: str,
    match_type: int,
    rows: Iterable[dict[str, Any]],
) -> int:
    inserted = 0
    with db_cursor() as cur:
        for row in rows:
            payload_json = json.dumps(row["payload"], ensure_ascii=True)
            cur.execute(
                """
                INSERT OR IGNORE INTO matches_raw (
                    ouid, match_type, match_id, match_date, payload_json, payload_hash, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ouid,
                    match_type,
                    row["match_id"],
                    row.get("match_date"),
                    payload_json,
                    row["payload_hash"],
                    utc_now_iso(),
                ),
            )
            inserted += cur.rowcount
    return inserted


def get_user_lookup(nickname: str) -> dict[str, str] | None:
    target = nickname.strip()
    if not target:
        return None
    with db_cursor() as cur:
        cur.execute(
            """
            SELECT nickname, ouid, source, updated_at
            FROM user_lookup_cache
            WHERE nickname = ?
            """,
            (target,),
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
    with db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO user_lookup_cache (nickname, ouid, source, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(nickname) DO UPDATE SET
              ouid = excluded.ouid,
              source = excluded.source,
              updated_at = excluded.updated_at
            """,
            (target_nickname, target_ouid, source, utc_now_iso()),
        )
