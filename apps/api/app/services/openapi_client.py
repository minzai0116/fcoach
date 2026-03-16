from __future__ import annotations

import hashlib
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


BASE_URL = "https://open.api.nexon.com"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_env_line(line: str) -> tuple[str, str] | None:
    text = line.strip()
    if not text or text.startswith("#"):
        return None
    if text.startswith("export "):
        text = text[7:].strip()
    if "=" not in text:
        return None
    key, value = text.split("=", 1)
    key = key.strip()
    value = value.strip()
    if not key:
        return None
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        value = value[1:-1]
    return key, value


def _load_env_file_fallback(path: Path) -> None:
    if not path.exists():
        return
    try:
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            parsed = _parse_env_line(raw_line)
            if parsed is None:
                continue
            key, value = parsed
            os.environ.setdefault(key, value)
    except Exception:
        return


def _candidate_env_paths() -> list[Path]:
    file_path = Path(__file__).resolve()
    project_root = file_path.parents[4]
    api_root = file_path.parents[2]
    cwd = Path.cwd()
    candidates = [
        project_root / ".env",
        project_root / ".env.local",
        api_root / ".env",
        api_root / ".env.local",
        cwd / ".env",
        cwd / ".env.local",
    ]
    unique: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def _load_local_env() -> None:
    paths = _candidate_env_paths()
    try:
        from dotenv import load_dotenv
        for path in paths:
            load_dotenv(path, override=False)
        return
    except Exception:
        pass

    for path in paths:
        _load_env_file_fallback(path)


class NexonOpenApiClient:
    def __init__(self, timeout_sec: int = 20, retries: int = 3) -> None:
        _load_local_env()
        api_key = os.getenv("NEXON_OPEN_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("Missing NEXON_OPEN_API_KEY")
        self._session = requests.Session()
        self._session.headers.update({"x-nxopen-api-key": api_key})
        self._timeout = timeout_sec
        self._retries = retries

    def _get(self, path: str, params: dict[str, Any]) -> Any:
        url = f"{BASE_URL}{path}"
        for idx in range(self._retries):
            response = self._session.get(url, params=params, timeout=self._timeout)
            if response.status_code == 200:
                return response.json()
            if response.status_code in (429, 500, 502, 503, 504):
                time.sleep((idx + 1) * 1.5)
                continue
            response.raise_for_status()
        response.raise_for_status()
        return None

    def find_user_by_nickname(self, nickname: str) -> dict[str, str]:
        data = self._get("/fconline/v1/id", {"nickname": nickname})
        if isinstance(data, dict) and data.get("ouid"):
            return {"ouid": str(data["ouid"]), "nickname": nickname}
        raise RuntimeError("Failed to resolve ouid from nickname")

    def fetch_match_ids(self, ouid: str, match_type: int, limit: int = 100) -> list[str]:
        payload = self._get(
            "/fconline/v1/user/match",
            {"ouid": ouid, "matchtype": str(match_type), "offset": "0", "limit": str(limit)},
        )
        if isinstance(payload, list):
            ids: list[str] = []
            for item in payload:
                if isinstance(item, str):
                    ids.append(item)
                elif isinstance(item, dict) and isinstance(item.get("matchId"), str):
                    ids.append(str(item["matchId"]))
            return ids
        return []

    def fetch_match_detail(self, match_id: str) -> dict[str, Any]:
        payload = self._get("/fconline/v1/match-detail", {"matchid": match_id})
        if not isinstance(payload, dict):
            raise RuntimeError("Unexpected match detail payload")
        return payload

    def collect_match_rows(self, ouid: str, match_type: int, limit: int = 100) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for match_id in self.fetch_match_ids(ouid, match_type, limit=limit):
            payload = self.fetch_match_detail(match_id)
            match_date = payload.get("matchDate")
            digest = hashlib.sha256(
                f"{match_id}|{ouid}|{match_type}|{payload}".encode("utf-8")
            ).hexdigest()
            rows.append(
                {
                    "match_id": match_id,
                    "match_date": str(match_date) if match_date else _utc_now(),
                    "payload_hash": digest,
                    "payload": payload,
                }
            )
        return rows
