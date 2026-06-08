from __future__ import annotations

import unicodedata


def is_truthy(value: object | None) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def normalize_nickname(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value or "")
    return normalized.replace("\u200b", "").replace("\ufeff", "").strip().lower()
