from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing

from app.db import connect, nexon_api_data_cutoff_iso
from app.services.coaching_data import extract_coaching_data, number
from app.services.opponent_profile import get_competitive_profile
from app.services.player_names import player_name

# 경기 수치는 상대와 직접 비교한다. 포지션별 수동 점검값은 사용하지 않는다.
_RATIOS = (
    ('on_target', '유효 슈팅 비율', 'shoot', 'effectiveShootTotal', 'shootTotal', '슈팅', '수비수가 슈팅 경로를 막을 때는 옆 선수에게 연결하고, 열린 각도에서 슈팅하세요.'),
    ('finishing', '득점 전환율', 'shoot', 'goalTotal', 'shootTotal', '슈팅', '슈팅 위치와 골키퍼와의 각도를 확인하고, 박스 안에서 슈팅 기회를 만들어 보세요.'),
    ('pass', '패스 성공률', 'pass', 'passSuccess', 'passTry', '패스', '패스하기 전에 가까운 지원 선수를 확보하고, 압박받을 때는 무리한 전진보다 뒤로 연결해 보세요.'),
    ('short_pass', '짧은 패스 성공률', 'pass', 'shortPassSuccess', 'shortPassTry', '패스', '공을 받기 전에 다음 연결 선수를 확인하고, 가까운 패스 경로가 열렸을 때 연결하세요.'),
    ('through_pass', '스루 패스 성공률', 'pass', 'throughPassSuccess', 'throughPassTry', '패스', '공격수가 수비수 옆으로 침투하는 순간에 스루 패스를 시도하세요.'),
    ('lobbed_through', '로빙 스루 패스 성공률', 'pass', 'lobbedThroughPassSuccess', 'lobbedThroughPassTry', '패스', '수비 뒷공간과 공격수의 출발 위치를 먼저 확인한 뒤 로빙 스루 패스를 선택하세요.'),
    ('driven_ground', '드라이브 땅볼 패스 성공률', 'pass', 'drivenGroundPassSuccess', 'drivenGroundPassTry', '패스', '빠른 땅볼 패스는 받는 선수에게 연결 경로가 열려 있을 때 선택하세요.'),
    ('bouncing_lob', '로빙 패스 성공률', 'pass', 'bouncingLobPassSuccess', 'bouncingLobPassTry', '패스', '상대의 압박을 넘길 공간과 받는 선수의 위치를 확인한 뒤 로빙 패스를 시도하세요.'),
    ('long_pass', '긴 패스 성공률', 'pass', 'longPassSuccess', 'longPassTry', '패스', '반대편 선수가 압박 없이 받을 수 있는지 확인한 뒤 긴 패스로 전환하세요.'),
    ('tackle', '태클 성공률', 'defence', 'tackleSuccess', 'tackleTry', '수비', '수비수를 전진시켜 태클하기보다 패스 경로를 막고, 상대의 터치가 길어질 때 태클하세요.'),
    ('block', '블록 성공률', 'defence', 'blockSuccess', 'blockTry', '수비', '슈팅하는 선수와 골문 사이를 먼저 막고, 수비수의 위치를 유지해 보세요.'),
)
_COUNTS = (
    ('shots', '슈팅', 'shoot', 'shootTotal', '회', '슈팅'),
    ('effective_shots', '유효 슈팅', 'shoot', 'effectiveShootTotal', '회', '슈팅'),
    ('in_box_shots', '페널티 박스 안 슈팅', 'shoot', 'shootInPenalty', '회', '슈팅'),
    ('possession', '점유율', 'matchDetail', 'possession', '%', '경기 운영'),
    ('offside', '오프사이드', 'matchDetail', 'offsideCount', '회', '경기 운영'),
    ('foul', '파울', 'matchDetail', 'foul', '회', '수비'),
)


def _ratio(participant: dict, section: str, success_field: str, trials_field: str) -> dict:
    data = participant.get(section) if isinstance(participant.get(section), dict) else {}
    success, trials = number(data, success_field), number(data, trials_field)
    valid = success is not None and trials is not None and success <= trials
    return {'success': success if valid else None, 'trials': trials if valid else None,
            'value': round(success / trials * 100, 2) if valid and trials else None}


def build_match_review(payload: dict, ouid: str, names: dict[int, str]) -> dict:
    participants = [row for row in payload.get('matchInfo', []) if isinstance(row, dict)]
    user = next((row for row in participants if row.get('ouid') == ouid), None)
    if user is None or len(participants) != 2:
        raise ValueError('이 구단주의 1대1 경기 기록을 확인할 수 없습니다.')
    opponent = next(row for row in participants if row is not user)
    detail = user.get('matchDetail') or {}
    normal = detail.get('matchEndType') == 0 and (opponent.get('matchDetail') or {}).get('matchEndType') == 0
    metrics, positives, checks = [], [], []
    for key, label, section, success, trials, group, action in _RATIOS:
        mine, theirs = _ratio(user, section, success, trials), _ratio(opponent, section, success, trials)
        gap = round(mine['value'] - theirs['value'], 2) if mine['value'] is not None and theirs['value'] is not None else None
        metrics.append({'key': key, 'label': label, 'group': group, 'unit': '%', 'mine': mine, 'opponent': theirs, 'gap': gap})
        if not normal or gap is None or abs(gap) < 5:
            continue
        evidence = (f"내 {label} {mine['success']:g}/{mine['trials']:g}회 ({mine['value']:.1f}%), "
                    f"상대 {theirs['success']:g}/{theirs['trials']:g}회 ({theirs['value']:.1f}%)로 {abs(gap):.1f}%p {'높았습니다' if gap > 0 else '낮았습니다'}.")
        item = {'metric': key, 'title': label, 'evidence': evidence,
                'action': '이번 경기의 성공 장면을 슈팅 위치·시도 횟수와 함께 확인하고 같은 선택을 유지해 보세요.' if gap > 0 and group == '슈팅' else '성공한 연결·수비 선택을 다음 경기에서도 확인하세요.' if gap > 0 else action}
        if payload.get('matchType') == 52:
            item['action'] = '감독 모드의 자동 경기 기록입니다. 같은 선수·포메이션을 유지하고 전술 변경 전후의 해당 지표와 시도 횟수를 비교하세요.'
        (positives if gap > 0 else checks).append(item)
    for key, label, section, field, unit, group in _COUNTS:
        mine, theirs = number(user.get(section) or {}, field), number(opponent.get(section) or {}, field)
        if unit == '%':
            mine = mine if mine is None or mine <= 100 else None
            theirs = theirs if theirs is None or theirs <= 100 else None
        metrics.append({'key': key, 'label': label, 'group': group, 'unit': unit, 'mine': {'value': mine},
                        'opponent': {'value': theirs}, 'gap': round(mine - theirs, 2) if mine is not None and theirs is not None else None})
    events = extract_coaching_data(user, opponent)

    def side(participant: dict, shots: list[dict]) -> dict:
        shoot = participant.get('shoot') or {}
        return {'ouid': participant.get('ouid'), 'nickname': participant.get('nickname') or '닉네임 미제공',
                'score': number(shoot, 'goalTotalDisplay'), 'record_goals': number(shoot, 'goalTotal'),
                'shots': [{**shot, 'player_name': player_name(names, int(shot.get('sp_id') or 0), None), 'is_goal': shot['result'] == 3,
                           'date': payload.get('matchDate', '') + 'Z', 'match_id': payload.get('matchId')} for shot in shots if shot.get('x') is not None and shot.get('y') is not None]}
    return {'match_id': payload.get('matchId'), 'match_date': str(payload.get('matchDate', '')) + 'Z',
            'match_type': payload.get('matchType'), 'result': detail.get('matchResult'), 'match_end_type': detail.get('matchEndType'),
            'normal': normal, 'mine': side(user, events['shots']), 'opponent': side(opponent, events['opponent_shots']),
            'metrics': metrics, 'positives': positives[:3], 'checks': checks[:3],
            'comparison_note': '선택한 한 경기의 상대 기록과 비교합니다. 시도 난이도·수비 압박은 확인되지 않아 성공률 차이만으로 실력이나 승패 원인을 단정하지 않습니다.' if normal else '몰수 경기의 최종 점수와 종료 전 기록입니다. 경기 시간이 달라 우열 판단과 교정 제안은 제공하지 않습니다.'}


def get_match_review(ouid: str, match_type: int, match_id: str) -> dict:
    with closing(connect()) as conn:
        row = conn.execute('SELECT payload_json FROM matches_raw WHERE ouid = ? AND match_type = ? AND match_id = ? AND created_at >= ? ORDER BY id DESC LIMIT 1',
                           (ouid, match_type, match_id, nexon_api_data_cutoff_iso())).fetchone()
    from app.services.analysis import _MATCH_CACHE, _match_cache_key, _spid_name_map
    source = json.loads(row['payload_json']) if row is not None else None
    if source is None:
        cached = _MATCH_CACHE.get_json(_match_cache_key(ouid, match_type))
        source = next((item.get('payload') for item in cached if isinstance(item, dict) and item.get('match_id') == match_id), None) if isinstance(cached, list) else None
    if not isinstance(source, dict) or str(source.get('matchType')) != str(match_type):
        raise LookupError('저장된 경기 기록이 없습니다. 최근 경기를 다시 조회해주세요.')
    result = build_match_review(source, ouid, _spid_name_map())
    with ThreadPoolExecutor(max_workers=2) as pool:
        profiles = list(pool.map(get_competitive_profile, [result['mine']['ouid'], result['opponent']['ouid']]))
    for key, profile in zip(('mine', 'opponent'), profiles):
        result[key]['profile'] = profile
    return result
