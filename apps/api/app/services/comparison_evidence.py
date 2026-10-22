from __future__ import annotations

import math
from datetime import datetime, timezone

from app.services.analysis_models import MatchStats

MIN_MATCHES = 5


def timestamp(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except (ValueError, TypeError, AttributeError):
        return None


def previous_matches(all_rows: list[MatchStats], selected: list[MatchStats], limit: int = 30) -> list[MatchStats]:
    dates = [date for row in selected if (date := timestamp(row.match_date)) is not None]
    if not dates or len(dates) != len(selected):
        return []
    cutoff = min(dates)
    selected_ids = {row.match_id for row in selected if row.match_id}
    candidates = [(date, row) for row in all_rows if row.match_end_type == 0 and row.match_id not in selected_ids
                  and (date := timestamp(row.match_date)) is not None and date < cutoff]
    return [row for _, row in sorted(candidates, key=lambda item: item[0], reverse=True)[:limit]]


def rate_sample(success: float, trials: float, matches: int, dates: list[str]) -> dict:
    valid = math.isfinite(success) and math.isfinite(trials) and 0 <= success <= trials
    value = success / trials if valid and trials else None
    interval = None
    if value is not None:
        # Wilson 95% 구간은 임의의 적정 성공률 대신 관측 차이의 불확실성을 확인한다.
        z2 = 1.959963984540054 ** 2
        center = (value + z2 / (2 * trials)) / (1 + z2 / trials)
        margin = math.sqrt(value * (1 - value) / trials + z2 / (4 * trials ** 2)) * math.sqrt(z2) / (1 + z2 / trials)
        interval = [max(0, center - margin), min(1, center + margin)]
    valid_dates = sorted(date for value in dates if (date := timestamp(value)) is not None)
    return {'success': success if valid else None, 'trials': trials if valid else None, 'matches': matches,
            'value': round(value, 6) if value is not None else None, 'interval': interval,
            'from': valid_dates[0].isoformat() if valid_dates else None,
            'to': valid_dates[-1].isoformat() if valid_dates else None}


def compare_rates(current: dict, previous: dict, minimum_trials: int) -> dict:
    ready = all(sample['value'] is not None and sample['matches'] >= MIN_MATCHES and sample['trials'] >= minimum_trials
                for sample in (current, previous))
    status = 'unavailable'
    if ready:
        status = ('lower' if current['interval'][1] < previous['interval'][0] else
                  'higher' if current['interval'][0] > previous['interval'][1] else 'no_clear_change')
    return {'source': 'own_history', 'status': status, 'current': current, 'previous': previous,
            'gap_pp': round((current['value'] - previous['value']) * 100, 2)
            if current['value'] is not None and previous['value'] is not None else None,
            'method': 'wilson_95_nonoverlap', 'minimum_matches': MIN_MATCHES, 'minimum_trials': minimum_trials}


def period(rows: list[MatchStats]) -> dict:
    dates = sorted(date for row in rows if (date := timestamp(row.match_date)) is not None)
    return {'matches': len(rows), 'from': dates[0].isoformat() if dates else None, 'to': dates[-1].isoformat() if dates else None}
