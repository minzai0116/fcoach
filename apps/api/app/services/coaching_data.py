from __future__ import annotations

import math
from typing import Any, Iterator

from app.services.analysis_models import MatchStats


PLAYER_PAIRS = {
    'pass': ('pass_success', 'pass_try', ('passSuccess',), ('passTry',)),
    'shot': ('effective_shots', 'shots', ('effectiveShoot',), ('shoot',)),
    'finishing': ('goals', 'shots', ('goal',), ('shoot',)),
    'tackle': ('tackle_success', 'tackle_try', ('tackle',), ('tackleTry',)),
    'block': ('block_success', 'block_try', ('block',), ('blockTry',)),
    'dribble': ('dribble_success', 'dribble_try', ('dribbleSuccess',), ('dribbleTry',)),
    'ball_possession': ('ball_possession_success', 'ball_possession_try', ('ballPossesionSuccess', 'ballPossesionSuc'), ('ballPossesionTry',)),
    'aerial': ('aerial_success', 'aerial_try', ('aerialSuccess',), ('aerialTry',)),
}
PLAYER_COUNTERS = {
    'goals': ('goal',), 'assists': ('assist',), 'intercept': ('intercept',),
    'defending_actions': ('defending',), 'dribble_distance': ('dribble',),
    'yellow_cards': ('yellowCards',), 'red_cards': ('redCards',), 'rating': ('spRating',),
}


def number(data: dict, *keys: str) -> float | None:
    value = next((data[key] for key in keys if key in data), None)
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None


def extract_player_coaching(status: dict) -> dict[str, float | int]:
    result = {}
    for metric, (success_key, trials_key, success_fields, trials_fields) in PLAYER_PAIRS.items():
        success, trials = number(status, *success_fields), number(status, *trials_fields)
        result.update({success_key: success or 0, trials_key: trials or 0,
                       f'{metric}_observed': int(success is not None and trials is not None and success <= trials)})
    for key, fields in PLAYER_COUNTERS.items():
        value = number(status, *fields)
        if key == 'rating' and value is not None and value > 10:
            value = None
        result.update({key: value or 0, f'{key}_observed': int(value is not None)})
    return result


def active_players(row: MatchStats) -> Iterator[dict]:
    seen = set()
    for player in row.player_stats:
        if any(player.get(field) is None for field in ('sp_id', 'sp_grade', 'sp_position')):
            continue
        key = tuple(player[field] for field in ('sp_id', 'sp_grade', 'sp_position'))
        if key[0] <= 0 or not 0 <= key[2] < 28 or key in seen:
            continue
        if not any(number(player, field) for field in ('rating', 'pass_try', 'shots', 'tackle_try', 'dribble_try', 'intercept', 'block_success', 'aerial_try', 'ball_possession_try')):
            continue
        seen.add(key)
        yield player


def _numbers(data: Any) -> dict[str, float]:
    if not isinstance(data, dict):
        return {}
    return {key: value for key in data if (value := number(data, key)) is not None}


def shot_minute(raw_value: Any) -> float | None:
    encoded = number({'time': raw_value}, 'time')
    period = int(encoded // (2 ** 24)) if encoded is not None else 4
    # 공식 초 단위 인코딩을 해석하며 승부차기는 경기 시간대에서 제외한다.
    return encoded % (2 ** 24) / 60 + (0, 45, 90, 105)[period] if period < 4 else None


def is_shootout(raw_value: Any) -> bool:
    encoded = number({'time': raw_value}, 'time')
    return encoded is not None and 4 * 2 ** 24 <= encoded < 5 * 2 ** 24


def _shots(data: Any) -> list[dict]:
    result = []
    for shot in data if isinstance(data, list) else []:
        if not isinstance(shot, dict) or isinstance(shot.get('result'), bool) or shot.get('result') not in (1, 2, 3):
            continue
        if is_shootout(shot.get('goalTime')):
            continue
        event = {'result': shot['result'], 'type': number(shot, 'type'), 'sp_id': number(shot, 'spId'), 'sp_grade': number(shot, 'spGrade'), 'in_penalty': shot.get('inPenalty') if isinstance(shot.get('inPenalty'), bool) else None}
        if event['type'] is not None and not event['type'].is_integer():
            event['type'] = None
        for coordinate in ('x', 'y'):
            value = number(shot, coordinate)
            event[coordinate] = value if value is not None and value <= 1 else None
        event['minute'] = shot_minute(shot.get('goalTime'))
        result.append(event)
    return result


def extract_coaching_data(user: dict, opponent: dict) -> dict:
    detail = _numbers(user.get('matchDetail'))
    if detail.get('possession', 0) > 100:
        detail.pop('possession')
    if detail.get('averageRating', 0) > 10:
        detail.pop('averageRating')
    if 'offsideCount' not in detail and 'OffsideCount' in detail:
        detail['offsideCount'] = detail['OffsideCount']
    return {
        'division': number(user, 'division'),
        'shoot': _numbers(user.get('shoot')), 'defence': _numbers(user.get('defence')),
        'pass': _numbers(user.get('pass')), 'opponent_pass': _numbers(opponent.get('pass')),
        'opponent_defence': _numbers(opponent.get('defence')),
        'detail': detail, 'opponent_shoot': _numbers(opponent.get('shoot')),
        'shots': _shots(user.get('shootDetail')), 'shots_observed': isinstance(user.get('shootDetail'), list),
        'opponent_shots': _shots(opponent.get('shootDetail')), 'opponent_shots_observed': isinstance(opponent.get('shootDetail'), list),
    }


def recorded_team_goals(row: MatchStats, *, opponent: bool = False) -> float | None:
    source, other = ('opponent_shoot', 'shoot') if opponent else ('shoot', 'opponent_shoot')
    shoot = row.coaching_data.get(source, {})
    if row.match_end_type == 0:
        return number(shoot, 'goalTotalDisplay', 'goalTotal')
    goals = number(shoot, 'goalTotal')
    # 몰수로 부여된 최종 점수는 실제 득점에 섞지 않는다. 상대 자책골은 별도 실측값이다.
    return goals + (number(row.coaching_data.get(other, {}), 'ownGoal') or 0) if goals is not None else None
