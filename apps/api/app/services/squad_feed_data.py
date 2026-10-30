from __future__ import annotations

import re
import math
from typing import Any

from app.services.feed_features import labels, feature, intrinsic_features


def player_image(value: Any, sp_id: int) -> str:
    if not isinstance(value, str):
        return ''
    path = value.removeprefix('https://fco.dn.nexoncdn.co.kr/live/externalAssets/common')
    match = re.fullmatch(r'/players(?:High|Action(?:High)?)?/p(\d+)(?:_[A-Za-z0-9]+)?\.png(?:\?rd=\d{1,20})?', path)
    if not match or int(match[1]) % 1_000_000 != sp_id % 1_000_000:
        return ''
    return f'https://fco.dn.nexoncdn.co.kr/live/externalAssets/common{path}'


def integer(value: Any, minimum: int = 0, maximum: int = 10_000) -> int | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool) and minimum <= value <= maximum and int(value) == value:
        return int(value)
    return None


def field(status: str, value: Any = None) -> dict:
    return {'status': status, 'value': value}


def numeric(data: dict, key: str, maximum: int, minimum: int = 1, names: tuple[str, ...] | None = None) -> dict:
    if data.get(key) is None:
        return field('missing')
    value = integer(data[key], minimum, maximum)
    if value is None:
        return field('invalid')
    return field('present', names[value] if names else value)


def features(data: dict, key: str, category: str) -> dict:
    raw = data.get(key)
    if raw is None:
        return field('missing')
    if not isinstance(raw, list) or len(raw) > 3 or any(v != -2 and integer(v) is None for v in raw):
        return field('invalid')
    values = list(dict.fromkeys(integer(v) for v in raw if v != -2))
    return field('present' if values else 'unset', [
        feature(code, labels()[category].get(str(code), f'미정의 코드 {code}'), category)
        for code in values
    ])


def personal_tactics(data: dict, role: str) -> dict:
    raw = data.get('strategy')
    if raw is None:
        return field('missing')
    if not isinstance(raw, list):
        return field('invalid')
    result, seen = [], set()
    for item in raw:
        if not isinstance(item, list) or len(item) != 2 or not isinstance(item[0], str):
            return field('invalid')
        # 공식 피드는 편집한 전술 값을 숫자 문자열로도 저장한다.
        raw_value = int(item[1]) if isinstance(item[1], str) and re.fullmatch(r'(?:[0-9]|10)', item[1]) else item[1]
        code, value = re.sub(r'\d+$', '', item[0]), integer(raw_value, 0, 10)
        if value is None:
            return field('invalid')
        if not re.fullmatch(r'[A-Z]{1,4}', code) or code in seen:
            return field('invalid')
        seen.add(code)
        choices = labels()['personal'].get(role, {}).get(code, [])
        known = value < len(choices)
        result.append({'code': code, 'value': value, 'label': choices[value] if known else f'미정의 {code} {value}', 'known': known})
    return field('present' if result else 'unset', result)


def normalize_player(data: dict) -> dict | None:
    sp_id = integer(data.get('spid'), 1, 2_147_483_647)
    if sp_id is None:
        return None
    role = str(data.get('role') or '').strip().upper()
    if role not in labels()['personal']:
        role = None
    base = data.get('trait')
    intrinsic = field('missing') if base is None else field('invalid')
    if isinstance(base, str):
        values = list(dict.fromkeys(v.strip() for v in base.split(',') if v.strip()))
        intrinsic = field('present' if values else 'unset', values)
    raw_participation = data.get('participation')
    participation = field('missing') if raw_participation is None else field('invalid')
    if isinstance(raw_participation, list):
        if not raw_participation:
            participation = field('unset', [])
        elif len(raw_participation) == 2 and all(integer(v, 1, 3) is not None for v in raw_participation):
            participation = field('present', raw_participation)
    state = integer(data.get('state'), 0, 1)
    season = str(data.get('seasonImgSmall') or data.get('season') or '')
    season = season if re.fullmatch(r'[A-Za-z0-9_-]{1,32}', season) else ''
    coords = [data.get(key) for key in ('x', 'y')]
    pitch_position = field('missing') if any(v is None for v in coords) else field('invalid')
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and 0 <= v <= 100 for v in coords):
        pitch_position = field('present', dict(zip(('x', 'y'), coords)))
    return {'sp_id': sp_id, 'grade': integer(data.get('buildUp'), 1, 13), 'position': role,
            'portrait_img': player_image(data.get('thumb_custom'), sp_id) or player_image(data.get('thumb'), sp_id),
            'overall': integer(data.get('ovr'), 1, 300), 'salary': integer(data.get('pay'), 1, 100),
            'pitch_position': pitch_position, 'season_code': season,
            'season_img': f'https://ssl.nexon.com/s2/game/fc/online/obt/externalAssets/new/season/{season}.png' if season else '',
            'lineup_role': 'starter' if state == 1 else 'substitute' if state == 0 else 'unknown',
            'name': str(data.get('name') or f'선수 {sp_id}')[:100],
            'intrinsic_traits': intrinsic, 'acquired_traits': features(data, 'traits', 'traits'),
            'intrinsic_features': field(intrinsic['status'], intrinsic_features(intrinsic['value']) if intrinsic['value'] is not None else None),
            'training_coach': features(data, 'trainer', 'training'),
            'personal_tactics': personal_tactics(data, role), 'participation': participation}


DEFENSE = ('후퇴', '밸런스', '볼 터치 실수 시 압박', '공 뺏긴 직후 압박', '지속적인 압박')
ATTACK = ('짧은 패스', '밸런스', '긴 패스', '빠른 빌드업')
MENTALITY = ('전원 수비', '매우 수비적', '수비적', '보통', '공격적', '매우 공격적', '전원 공격')
TEAM_FIELDS = (
    ('defensivestyle', '수비 스타일', 4, 0, DEFENSE), ('defwidth', '수비 폭', 10, 1, None),
    ('defdepth', '수비 깊이', 10, 1, None), ('teammentality', '팀 성향', 6, 0, MENTALITY),
    ('offensive_style_buildup', '빌드업', 3, 0, ATTACK),
    ('offensive_style_chancecreation', '기회 만들기', 3, 0, ATTACK),
    ('offwidth', '공격 폭', 10, 1, None), ('offplayerinbox', '박스 안 선수', 10, 1, None),
    ('offcornerkick', '코너킥 가담', 5, 1, None), ('offfreekick', '프리킥 가담', 5, 1, None),
)


def normalize_team_colors(raw: Any) -> list[dict]:
    if not isinstance(raw, dict):
        return []
    colors = []
    for category in ('affiliation', 'feature', 'enhance'):
        entries = raw.get(category)
        if not isinstance(entries, dict):
            continue
        for item in list(entries.values())[:16]:
            if not isinstance(item, dict):
                continue
            name = item.get('name')
            level, players = integer(item.get('lv'), 1, 20), integer(item.get('playercnt'), 1, 50)
            if not isinstance(name, str) or not name.strip() or level is None or players is None:
                continue
            effects = []
            for effect in item.get('skill', []) if isinstance(item.get('skill'), list) else []:
                if not isinstance(effect, dict) or not isinstance(effect.get('type'), str):
                    continue
                value = integer(effect.get('value'), 0, 100)
                if value is not None:
                    effects.append({'type': effect['type'][:40], 'value': value})
            colors.append({'category': category, 'name': name.strip()[:100], 'level': level,
                           'players': players, 'effects': effects[:10]})
    return colors


def normalize_snapshot(data: dict, feed_id: str, fetched_at: str, summary: dict | None = None) -> dict:
    squad = data['SquadInfo']
    raw_team = squad.get('teamSt')
    team = raw_team if isinstance(raw_team, dict) else {}
    author = str(data.get('strCharacterName') or '').strip()
    summary = summary if summary and summary.get('author') == author else {}
    players = [p for raw in squad['players'] if isinstance(raw, dict) and (p := normalize_player(raw)) is not None]
    return {'feed_id': feed_id, 'title': str(squad.get('squadName') or '제목 없음')[:200], 'author': author,
            'created_at': summary.get('created_at'), 'fetched_at': fetched_at, 'last_modified_at': None,
            'formation': str(squad.get('formation') or '미제공')[:30], 'mode': integer(squad.get('mode'), 1, 2),
            'source': 'nexon_public_squad_feed', 'source_url': f'https://fconline.nexon.com/SquadMaker/feed/all?feedId={feed_id}',
            'label_version': labels()['checked_at'], 'team_colors': normalize_team_colors(squad.get('totalTeamColor')),
            'team_tactics': [{'key': key, 'label': label, **(field('invalid') if raw_team is not None and not isinstance(raw_team, dict) else numeric(team, key, maximum, minimum, names))}
                             for key, label, maximum, minimum, names in TEAM_FIELDS], 'players': players}
