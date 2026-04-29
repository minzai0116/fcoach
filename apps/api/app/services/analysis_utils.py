from __future__ import annotations

import unicodedata


def is_truthy(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def normalize_nickname(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value or "")
    return normalized.replace("\u200b", "").replace("\ufeff", "").strip().lower()
