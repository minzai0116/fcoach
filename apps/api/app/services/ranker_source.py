from __future__ import annotations

import re
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any

import requests
from bs4 import BeautifulSoup

from app.db import connect, upsert_matches, utc_now_iso
from app.services.openapi_client import NexonOpenApiClient


OFFICIAL_RANK_INNER_URL = "https://fconline.nexon.com/datacenter/rank_inner"
OFFICIAL_MODE_DEFAULT = "1vs1"
OFFICIAL_MATCH_TYPE_DEFAULT = 50


def _to_float(value: str, default: float = 0.0) -> float:
    try:
        return float(value.replace(",", "").strip())
    except Exception:
        return default


def _to_int(value: str, default: int = 0) -> int:
    try:
        return int(value.replace(",", "").strip())
    except Exception:
        return default


def _parse_wdl(bottom_text: str) -> tuple[int, int, int]:
    numbers = re.findall(r"\d+", bottom_text)
    if len(numbers) >= 3:
        return _to_int(numbers[0]), _to_int(numbers[1]), _to_int(numbers[2])
    return 0, 0, 0


def _clean_nickname(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value or "")
    normalized = normalized.replace("\u200b", "").replace("\ufeff", "").strip()
    return normalized


def fetch_official_rankers(mode: str = OFFICIAL_MODE_DEFAULT, pages: int = 2, timeout_sec: int = 20) -> list[dict[str, Any]]:
    rankers: list[dict[str, Any]] = []
    with requests.Session() as session:
        for page in range(1, max(1, pages) + 1):
            response = session.get(
                OFFICIAL_RANK_INNER_URL,
                params={"rt": mode, "n4seasonno": 0, "n4pageno": page},
                timeout=timeout_sec,
            )
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "html.parser")
            for row in soup.select(".tbody > .tr"):
                rank_text = row.select_one(".rank_no")
                coach_name = row.select_one(".rank_coach .name.profile_pointer")
                elo_text = row.select_one(".rank_r_win_point")
                win_rate_text = row.select_one(".rank_before .top")
                wdl_text = row.select_one(".rank_before .bottom")
                formation_text = row.select_one(".formation")
                team_color_text = row.select_one(".team_color .inner")
                if not rank_text or not coach_name:
                    continue
                wins, draws, losses = _parse_wdl(wdl_text.get_text(" ", strip=True) if wdl_text else "")
                rankers.append(
                    {
                        "mode": mode,
                        "rank_no": _to_int(rank_text.get_text(strip=True), 0),
                        "nickname": coach_name.get_text(strip=True),
                        "elo": _to_float(elo_text.get_text(strip=True) if elo_text else "0"),
                        "win_rate": _to_float((win_rate_text.get_text(strip=True) if win_rate_text else "0").replace("%", "")) / 100.0,
                        "win_count": wins,
                        "draw_count": draws,
                        "loss_count": losses,
                        "formation": formation_text.get_text(strip=True) if formation_text else "",
                        "team_color": team_color_text.get_text(" ", strip=True) if team_color_text else "",
                    }
                )
    rankers.sort(key=lambda row: row["rank_no"])
    return rankers


def list_official_rankers(mode: str = OFFICIAL_MODE_DEFAULT, limit: int = 100) -> list[dict[str, Any]]:
    conn = connect()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT mode, rank_no, nickname, ouid, elo, win_rate, win_count, draw_count, loss_count, formation, team_color, fetched_at, source
            FROM official_rankers
            WHERE mode = ?
            ORDER BY rank_no ASC
            LIMIT ?
            """,
            (mode, max(1, limit)),
        )
        rows = cur.fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def _latest_fetched_at(mode: str) -> str | None:
    conn = connect()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT fetched_at FROM official_rankers WHERE mode = ? ORDER BY fetched_at DESC LIMIT 1",
            (mode,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return str(row["fetched_at"])
    finally:
        conn.close()


def _upsert_official_rankers(rows: list[dict[str, Any]], fetched_at: str) -> None:
    conn = connect()
    try:
        cur = conn.cursor()
        for row in rows:
            cur.execute(
                """
                INSERT INTO official_rankers (
                  mode, rank_no, nickname, ouid, elo, win_rate, win_count, draw_count, loss_count,
                  formation, team_color, fetched_at, source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(mode, rank_no) DO UPDATE SET
                  nickname = excluded.nickname,
                  ouid = excluded.ouid,
                  elo = excluded.elo,
                  win_rate = excluded.win_rate,
                  win_count = excluded.win_count,
                  draw_count = excluded.draw_count,
                  loss_count = excluded.loss_count,
                  formation = excluded.formation,
                  team_color = excluded.team_color,
                  fetched_at = excluded.fetched_at,
                  source = excluded.source
                """,
                (
                    row["mode"],
                    int(row["rank_no"]),
                    str(row["nickname"]),
                    row.get("ouid"),
                    float(row.get("elo", 0.0)),
                    float(row.get("win_rate", 0.0)),
                    int(row.get("win_count", 0)),
                    int(row.get("draw_count", 0)),
                    int(row.get("loss_count", 0)),
                    str(row.get("formation", "")),
                    str(row.get("team_color", "")),
                    fetched_at,
                    "fconline_datacenter_rank",
                ),
            )
        conn.commit()
    finally:
        conn.close()


def ensure_official_rankers(
    mode: str = OFFICIAL_MODE_DEFAULT,
    match_type: int = OFFICIAL_MATCH_TYPE_DEFAULT,
    pages: int = 2,
    max_rankers: int = 30,
    per_ranker_matches: int = 8,
    max_age_hours: int = 12,
    force_refresh: bool = False,
) -> dict[str, Any]:
    latest = _latest_fetched_at(mode)
    if latest and not force_refresh:
        try:
            latest_dt = datetime.fromisoformat(latest.replace("Z", "+00:00"))
            if latest_dt.tzinfo is None:
                latest_dt = latest_dt.replace(tzinfo=timezone.utc)
        except Exception:
            latest_dt = datetime(1970, 1, 1, tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - latest_dt <= timedelta(hours=max_age_hours):
            rows = list_official_rankers(mode=mode, limit=max_rankers)
            return {"status": "cached", "mode": mode, "count": len(rows), "fetched_at": latest}

    rows = fetch_official_rankers(mode=mode, pages=pages)
    selected = rows[: max(1, max_rankers)]
    fetched_at = utc_now_iso()
    resolved_count = 0
    ingested_count = 0
    resolve_failed_count = 0
    ingest_failed_count = 0
    error_samples: list[dict[str, str]] = []

    api_client: NexonOpenApiClient | None = None
    api_client_error: str | None = None
    try:
        api_client = NexonOpenApiClient(timeout_sec=20, retries=2)
    except Exception as exc:
        api_client = None
        api_client_error = str(exc)

    for idx, row in enumerate(selected):
        row["ouid"] = None
        if api_client is None:
            continue
        nickname = _clean_nickname(str(row["nickname"]))
        if not nickname:
            continue
        try:
            user = api_client.find_user_by_nickname(nickname)
            ouid = str(user["ouid"])
            row["ouid"] = ouid
            resolved_count += 1
        except Exception as exc:
            resolve_failed_count += 1
            if len(error_samples) < 5:
                error_samples.append({"nickname": nickname, "stage": "resolve_ouid", "error": str(exc)})
            continue
        try:
            match_rows = api_client.collect_match_rows(ouid=ouid, match_type=match_type, limit=max(1, per_ranker_matches))
            ingested_count += upsert_matches(ouid=ouid, match_type=match_type, rows=match_rows)
        except Exception as exc:
            ingest_failed_count += 1
            if len(error_samples) < 5:
                error_samples.append({"nickname": nickname, "stage": "ingest_matches", "error": str(exc)})
            continue
        finally:
            if idx < len(selected) - 1:
                time.sleep(0.15)

    _upsert_official_rankers(selected, fetched_at=fetched_at)
    return {
        "status": "refreshed",
        "mode": mode,
        "fetched_count": len(rows),
        "saved_count": len(selected),
        "resolved_ouid_count": resolved_count,
        "ingested_match_rows": ingested_count,
        "resolve_failed_count": resolve_failed_count,
        "ingest_failed_count": ingest_failed_count,
        "api_client_ready": api_client is not None,
        "api_client_error": api_client_error,
        "error_samples": error_samples,
        "fetched_at": fetched_at,
    }
