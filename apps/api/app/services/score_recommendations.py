"""세부 지표에 맞는 짧은 행동 제안."""
PLAYS = {
    'short': ('짧은 패스 연결', '받는 선수의 몸 방향을 보고, 막힌 경로는 옆으로 연결하세요.', '중앙에 가까운 지원 선수를 한 명 남겨보세요.'),
    'long': ('긴 패스 선택', '반대편 선수가 비었을 때 전환하고, 불리한 경합은 짧게 연결하세요.', '측면 지원과 중앙 연결 역할을 나눠보세요.'),
    'through': ('스루 패스 타이밍', '침투가 시작되고 수비 사이 경로가 열렸을 때 보내세요.', '공격수 한 명은 침투, 한 명은 지원을 맡겨보세요.'),
    'lobbed_through': ('로빙 스루 패스 선택', '수비 뒷공간과 동료의 출발이 함께 확보됐을 때 보내세요.', '전원 침투보다 지원 역할을 섞어보세요.'),
    'bouncing_lob': ('로빙 패스 선택', '받는 선수 앞 공간을 확인하고, 겹쳐 있으면 땅볼로 연결하세요.', '중앙 지원 경로를 남겨보세요.'),
    'driven_ground': ('강한 땅볼 패스 선택', '직선 경로가 열렸을 때 보내고, 막혀 있으면 짧게 연결하세요.', '받는 선수 가까이에 지원을 배치해보세요.'),
    'passing': ('패스 연결', '받기 전에 가까운 지원 선수를 확인하고, 막힌 전진 패스는 옆으로 돌리세요.', '중앙 한 명은 지원, 다른 한 명은 전진 연결을 맡겨보세요.'),
    'finishing': ('슈팅 선택', '각도가 좁으면 중앙 동료에게 연결해 슈팅 각도를 만드세요.', '공격수의 침투와 지원 역할을 나눠보세요.'),
    'accuracy': ('슈팅 공간 확보', '수비수가 경로를 막으면 옆으로 연결한 뒤 슈팅하세요.', '중앙 연결 역할과 침투 역할을 나눠보세요.'),
    'heading': ('헤딩 준비', '크로스 전에 공격수의 위치와 주변 수비수를 확인하세요.', '크로스와 컷백을 모두 받을 위치를 확보해보세요.'),
    'outside': ('중거리 슈팅 선택', '경로가 막혔다면 박스 안으로 연결해 더 열린 기회를 만드세요.', '박스 앞 패스 지원을 한 명 남겨보세요.'),
    'defense': ('수비 간격', '센터백을 먼저 끌어내지 말고 미드필더로 중앙 경로를 막으세요.', '풀백 한쪽의 후방 대기와 중앙 커버를 확인해보세요.'),
    'tackle': ('태클 타이밍', '상대의 터치가 길어진 순간에 접근하세요.', '수비형 미드필더의 중앙 커버를 확인해보세요.'),
    'block': ('슈팅 경로 차단', '공보다 골문과 슈팅하는 선수 사이를 먼저 지키세요.', '센터백이 측면까지 끌려가지 않도록 복귀 역할을 확인해보세요.'),
    'late': ('후반 수비', '후반에는 양쪽 풀백의 동시 전진을 줄여보세요.', '중앙 커버와 후방 지원을 남겨보세요.'),
    'dribble': ('드리블 방향', '압박 반대 방향으로 첫 터치하고, 막혔다면 연결하세요.', '가까운 패스 지원을 남겨보세요.'),
    'ball_possession': ('볼 소유', '공을 받기 전에 지원 방향을 확인하고, 압박이 붙으면 짧게 연결하세요.', '미드필더 한 명은 공을 받을 위치를 유지해보세요.'),
    'aerial': ('공중볼 경합', '낙하 위치를 먼저 잡고, 지원 없는 경합은 땅볼로 전환하세요.', '경합 뒤 공을 받을 지원 선수를 남겨보세요.'),
    'offside': ('침투 패스 타이밍', '최종 수비수와 동료의 위치를 확인한 뒤 패스하세요.', '공격수 전원의 동시 침투를 줄여보세요.'),
    'foul': ('파울을 줄이는 수비', '뒤늦은 태클보다 패스 경로를 먼저 막으세요.', '중앙 커버와 풀백의 복귀를 확인해보세요.'),
}


def play_key(key):
    if key.startswith('passing:'):
        return key.split(':')[1] if key.count(':') == 2 and key.split(':')[1] in PLAYS else 'passing'
    if key == 'shooting:on_target': return 'accuracy'
    if key in ('shooting:shot_type_3', 'shooting:heading'): return 'heading'
    if key == 'shooting:box_outside': return 'outside'
    if key.startswith('shooting:'): return 'finishing'
    if key == 'defending:team_tackle': return 'tackle'
    if key == 'defending:team_block': return 'block'
    if key == 'defending:late_conceded': return 'late'
    if key.startswith('defending:'): return 'defense'
    return key.split(':')[-1]


def coaching_for_metrics(metrics):
    scored = [m for m in metrics if m['score'] is not None and m['weight'] > 0]
    candidates = sorted((m for m in scored if m['status'] == 'weakness'), key=lambda m: m['point_impact'])
    fallback = not candidates
    if fallback and scored:
        candidates = [min(scored, key=lambda m: m['score'])]
    advice, seen = [], set()
    for metric in candidates:
        key = play_key(metric['id'])
        if key in seen or key not in PLAYS:
            continue
        title, play, tactic = PLAYS[key]
        advice.append({'title': title if not fallback else '이어갈 플레이', 'play': play,
                       'tactic': tactic if not fallback else None, 'metric_id': metric['id'],
                       'evidence': metric['label'], 'kind': 'maintain' if fallback else 'improve'})
        seen.add(key)
    return advice[:2]
