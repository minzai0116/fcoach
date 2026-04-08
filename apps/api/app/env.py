from __future__ import annotations

import os
import threading
from pathlib import Path


_ENV_LOAD_LOCK = threading.Lock()
_ENV_LOADED = False


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
    project_root = file_path.parents[3]
    api_root = file_path.parents[1]
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


def load_local_env(force: bool = False) -> None:
    global _ENV_LOADED
    with _ENV_LOAD_LOCK:
        if _ENV_LOADED and not force:
            return

        paths = _candidate_env_paths()
        try:
            from dotenv import load_dotenv

            for path in paths:
                load_dotenv(path, override=False)
        except Exception:
            for path in paths:
                _load_env_file_fallback(path)

        _ENV_LOADED = True
