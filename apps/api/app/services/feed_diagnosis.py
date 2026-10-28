from __future__ import annotations

from app.services.coaching_data import active_players
from app.services.passing_coaching import build_passing_coaching
from app.services.player_guidance import build_player_guidance


VERSION = 'feed_history_evidence_v2'
LIMIT = '저장 피드의 실제 경기 사용·특성 발동은 미확인입니다. 아래는 기록과 설정을 함께 검토하는 실험 가설입니다.'
DM = {'RDM', 'CDM', 'LDM'}
FORWARDS = {'ST', 'LS', 'RS', 'CF', 'RF', 'LF', 'LW', 'RW'}


def _value(settings: dict, key: str):
    item = settings.get(key, {})
    return item.get('value') if item.get('status') == 'present' else None


def _strategy(settings: dict, code: str) -> dict | None:
    return next((v for v in _value(settings, 'personal_tactics') or [] if v['code'] == code and v['known']), None)


def _features(settings: dict, key: str, codes: set[int]) -> list[dict]:
    return [v for v in _value(settings, key) or [] if v.get('known') and v.get('code') in codes]


def _metric(player: dict, code: str) -> dict | None:
    return next((m for m in player['measurements'] if m['metric'] == code and m['status'] == 'sufficient' and m['value'] is not None), None)


def _evidence(*metrics: dict | None) -> list[dict]:
    return [{'label': m['label'], 'success': m['success'], 'trials': m['trials'], 'value': m['value'],
             'scope': '선수·자리', 'observed_matches': m['observed_matches']} for m in metrics if m]


def _fact(label: str, value: str, reason: str, features: list[dict] | None = None) -> dict:
    return {'label': label, 'value': value, 'reason': reason, 'features': features or []}


def _feature_fact(settings: dict, key: str, codes: set[int], label: str, reason: str) -> list[dict]:
    values = _features(settings, key, codes)
    return [_fact(label, ' · '.join(v['label'] for v in values), reason, values)] if values else []


def _action(kind: str, label: str, reason: str, current: str | None = None, proposed: str | None = None) -> dict:
    return {'kind': kind, 'label': label, 'reason': reason, 'current': current, 'proposed': proposed}


def _plan(code: str, title: str, status: str, evidence: list[dict], reason: str, settings: list[dict], actions: list[dict], verification: str) -> dict:
    return {'id': code, 'title': title, 'status': status, 'evidence': evidence, 'reason': reason,
            'settings': settings, 'actions': actions, 'verification': verification, 'limitation': LIMIT}


def _verify(metric: dict, guardrail: str) -> str:
    return (f"같은 모드·카드·강화·자리의 다음 기록이 확인된 경기에서 {metric['label']} 성공/시도 수를 이전 구간과 비교하세요. "
            f"{guardrail} 과거 성공률은 달성해야 할 정상 기준이나 효과 예측이 아닙니다.")


def _player_plans(player: dict, settings: dict, anchor: dict | None, mode: int) -> list[dict]:
    position = player['position_name']
    metrics = {m['metric']: m for m in player['measurements'] if m['status'] == 'sufficient' and m['value'] is not None}
    if not metrics:
        return [_plan('sample', '이 자리의 기록을 먼저 더 모으세요', 'insufficient', [],
                      f"{position} 출전 {player['appearances']}경기로는 지표별 최소 5경기·시도 수를 충족하지 못했습니다.", [], [],
                      '선택한 종료 유형 조건에서 같은 선수·자리의 기록을 5경기 이상 모으세요. 시도 수가 부족한 지표는 계속 판단을 보류합니다.')]
    if mode == 52:
        return [_plan('observe', '같은 구성의 자동 경기에서 반복 여부 확인', 'observation', _evidence(*list(metrics.values())[:2]),
                      '감독 모드에서는 직접 조작을 교정하지 않습니다. 저장 설정과 자동 경기 기록을 비교하는 관찰만 제공합니다.', [], [],
                      '선수·자리·설정을 유지한 자동 경기 5경기 이상에서 같은 지표가 반복되는지 확인하세요.')]

    plans = []
    participation = _value(settings, 'participation')
    personal = _value(settings, 'personal_tactics')
    passing, tackle, possession = (metrics.get(k) for k in ('pass', 'tackle', 'ball_possession'))
    dribble, shot, finishing = (metrics.get(k) for k in ('dribble', 'shot', 'finishing'))
    ar, sr, sc = (_strategy(settings, k) for k in ('AR', 'SR', 'SC'))

    # 타겟맨 코치는 공식 설명에 개인 전술의 선행 조건이 명시돼 있다.
    targetman = _features(settings, 'training_coach', {46})
    if targetman and ar and ar['value'] != 2 and position in FORWARDS:
        evidence = possession or passing or shot
        if evidence:
            plans.append(_plan('coach_role', '타겟맨 코치 활용 조건 확인', 'observation', _evidence(evidence),
                               f"개인 전술은 '{ar['label']}'인데 타겟맨 특화는 타겟맨 전술에서의 리시브 지원 조건을 갖습니다. 낮은 경기 수치의 원인으로 확정하지는 않습니다.",
                               [_fact('개인 전술 AR', ar['label'], '코치가 요구하는 타겟맨 설정과 다름'), _fact('훈련코치', targetman[0]['label'], '개인 전술 선행 조건 확인', targetman)],
                               [_action('setting', '침투 역할을 유지한다면 코치 역할부터 맞추기', '공격 전술과 코치를 동시에 바꾸지 말고, 타겟맨 전용 항목만 교체 후보로 확인하세요.', '타겟맨 특화', '침투 역할에 맞는 코치 특성 검토'),
                                _action('alternative', '등지는 공격을 원한다면 별도 실험', '이 경우 코치를 유지하고 AR만 타겟맨으로 바꿉니다.', ar['label'], '타겟맨')],
                               _verify(evidence, '슈팅·득점 시도도 함께 유지되는지 확인하세요.')))

    for finding in player['findings']:
        if finding.get('comparison', {}).get('status') != 'lower' or finding.get('comparison', {}).get('source') != 'own_history':
            continue
        metric = metrics.get(finding['metric'])
        if not metric or finding['metric'] not in {'pass', 'shot', 'tackle', 'dribble', 'ball_possession', 'finishing', 'aerial', 'block'}:
            continue
        facts, actions = [], [_action('play', f"{position} {finding['label']} 교정", finding['adjustment'])]
        if personal:
            facts.append(_fact('개인 전술', ' · '.join(v['label'] for v in personal), '저장된 지시를 확인하고 한 항목만 시험'))
        if finding['metric'] == 'pass':
            facts += _feature_fact(settings, 'intrinsic_features', {27, 18}, '패스 관련 기본 특성', '지원 특성 유무와 패스 선택은 별개이므로 특성 변경보다 수신 경로를 우선 확인')
            facts += _feature_fact(settings, 'training_coach', {36, 37, 38}, '패스 관련 코치', '현재 지원 설정을 유지한 상태에서 비교')
        if finding['metric'] == 'tackle':
            facts += _feature_fact(settings, 'acquired_traits', {53, 56}, '경합 관련 특성', '지원 특성이 있어도 무리한 태클의 원인·발동 여부는 확인되지 않음')
            facts += _feature_fact(settings, 'training_coach', {12, 13, 34, 44}, '경합·복귀 코치', '이미 지원 코치가 있으면 먼저 조작 시점을 점검')
            if participation and participation[0] == 3 and position in {'LB', 'RB', 'LWB', 'RWB'}:
                actions.append(_action('setting', '공격 참여도만 3 → 2 비교', '전진 후 복귀 부담을 줄이는 가설이며 수비 참여도·반대쪽 풀백은 유지합니다.', f'공격 3 · 수비 {participation[1]}', f'공격 2 · 수비 {participation[1]}'))
        if finding['metric'] in {'shot', 'dribble'}:
            facts += _feature_fact(settings, 'training_coach', {0, 4, 6, 28, 30, 41, 42}, '공격 관련 코치', '선택과 타이밍을 먼저 시험하고 효과를 따로 비교')
        plans.append(_plan(f"low_{finding['metric']}", f"{position} 이전 경기 대비 {finding['label']} 하락 점검", 'priority', _evidence(metric),
                           finding['evidence'], facts, actions, finding['verification']))

    if not plans:
        main = passing or next(iter(metrics.values()))
        reason = '같은 카드·강화·자리의 이전 기록과 비교해 뚜렷한 하락이 확인되지 않았거나 비교할 기록이 없습니다. 현재 수치만으로 설정 변경을 권하지 않습니다.'
        if position == 'GK':
            reason = '선방 횟수·배급을 확인할 수 있지만 개인 선방률의 분모와 슈팅 난이도·코치 발동 자료가 없어 이 기록만으로 골키퍼 코치 교체를 판단하지 않습니다.'
        plans.append(_plan('maintain', f'{position} 경기 기록과 저장 설정', 'observation', _evidence(main), reason,
                           _feature_fact(settings, 'training_coach', {1, 3, 7, 12, 13, 28, 30, 44}, '현재 코치', '이 수치만으로 교체 근거가 확인되지 않음'),
                           [],
                           '같은 선수·자리의 다음 5경기에서 시도량·성공률을 함께 비교하고, 부족한 슈팅·경합 표본은 판단을 보류하세요.'))
    plans.sort(key=lambda p: (0 if p['status'] == 'priority' else 1, p['id']))
    return plans[:2]


def build_contextual_coaching(snapshot: dict, coaching: dict, rows: list, comparisons: list[dict], mode: int, history_rows: list | None = None) -> dict:
    linked = { (p['sp_id'], p['sp_grade'], p['position_name']): p for p in comparisons if p['linked'] }
    players = {(p['sp_id'], p['sp_grade'], p['position_name']): p for p in coaching['players']}
    for key, record in linked.items():
        record['plans'] = _player_plans(players[key], record['settings'], None, mode)
        record['guidance'] = build_player_guidance(players[key], record['settings'], mode, record['plans'])

    positions = {p['sp_position']: p['position_name'] for p in coaching['players']}
    starters = {(p['sp_id'], p['grade'], p['position']) for p in snapshot['players'] if p.get('lineup_role') == 'starter'}
    matched_rows = [row for row in rows if linked and len(starters) == 11 and starters == {
        (p['sp_id'], p['sp_grade'], positions.get(p['sp_position'])) for p in active_players(row)}]
    team = {s['key']: s for s in snapshot['team_tactics'] if s['status'] == 'present'}
    team_plans = []
    if linked and len(matched_rows) >= 5 and mode != 52 and team.get('offensive_style_buildup', {}).get('value') == '긴 패스':
        history_matched = [row for row in history_rows or [] if row.match_end_type in (0, 1, 2) and starters == {
            (p['sp_id'], p['sp_grade'], positions.get(p['sp_position'])) for p in active_players(row)}]
        passing = build_passing_coaching(matched_rows, mode, include_forfeits=True, history_rows=history_matched)
        long = next((v for v in passing['types'] if v['metric'] == 'long'), None)
        if long and any(p['metric'] == 'long' for p in passing['priorities']):
            evidence = [{'label': '긴 패스 성공률', 'success': long['success'], 'trials': long['trials'], 'value': long['success_rate'],
                         'scope': '선발 11명 일치 경기의 팀 전체', 'observed_matches': long['observed_matches']}]
            team_plans.append(_plan('long_buildup', '이전 경기 대비 긴 패스 성공률 하락 점검', 'review', evidence,
                                    next(p['evidence'] for p in passing['priorities'] if p['metric'] == 'long') + f" 선발 11명·자리가 같은 경기에서 긴 패스 사용 비중 {long['usage_share']:.1%}, 실패 비중 {long['failure_share']:.1%}입니다. 특정 선수의 긴 패스 실패로 배분하지 않습니다.",
                                    [_fact('팀 빌드업', '긴 패스', '현재 피드 설정을 다음 실험의 기준으로 사용')],
                                    [_action('play', '받는 선수가 비었을 때만 긴 전환 선택', '경합으로 보내는 공 일부를 가까운 연결 후 전환으로 바꾸세요.'),
                                     _action('setting', '플레이 교정과 별도로 빌드업만 비교', '나머지 팀 전술·선수·코치를 유지한 새 실험을 따로 만드세요.', '긴 패스', '밸런스')],
                                    '같은 선발·자리의 다음 5경기, 긴 패스 20회 이상에서 사용량·실패 비중과 슈팅·득점을 함께 비교하세요.'))
    priorities = [{'player_name': record['player_name'], 'position_name': record['position_name'], 'sp_id': record['sp_id'], 'sp_grade': record['sp_grade'], 'plan': plan}
                  for record in linked.values() for plan in record['plans'] if plan['status'] in {'priority', 'review'}]
    priorities.sort(key=lambda p: (0 if p['plan']['status'] == 'priority' else 1, p['plan']['id'], p['position_name']))
    unique, seen = [], set()
    for item in priorities:
        key = item['sp_id'], item['sp_grade'], item['position_name']
        if key not in seen:
            unique.append(item)
            seen.add(key)
    return {'rule_version': VERSION, 'priorities': unique[:3], 'team_plans': team_plans,
            'matched_roster_sample_count': len(matched_rows), 'rule_note': '현재와 이전 기록이 확인된 경기의 비교 근거가 있는 변화만 코칭합니다. 저장 설정의 사용·특성 발동과 인과 효과는 확인되지 않습니다.'}
