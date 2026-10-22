from __future__ import annotations


ADVICE = {
    'pass': ('압박을 받으면 가까운 동료에게 연결', '공을 받기 전에 가까운 동료를 확인하세요. 수비수가 패스 경로를 막으면 전방 패스를 강행하지 말고 옆이나 뒤로 연결한 뒤 다시 움직이세요.'),
    'shot': ('수비수와 골키퍼를 확인한 뒤 슈팅', '수비수가 슈팅 경로를 막고 있으면 옆으로 한 번 연결하세요. 골문이 보이는 각도를 만든 뒤 슈팅하고, 감아차기와 일반 슛은 같은 위치에서 비교하세요.'),
    'finishing': ('박스 안에서 열린 각도로 마무리', '골키퍼가 각도를 좁히기 전에 슈팅하거나 옆 동료에게 연결하세요. 슈팅 횟수만 줄이지 말고 득점과 유효 슈팅을 함께 늘리는 선택을 하세요.'),
    'tackle': ('수비 위치를 지킨 뒤 긴 터치에 태클', '수비수를 앞으로 끌어내기보다 상대와 골문 사이를 유지하세요. 상대의 터치가 길어지거나 공이 발에서 떨어지는 순간에 태클하세요.'),
    'dribble': ('방향 전환 한 번 뒤 패스할 동료 확보', '수비수가 붙은 상태에서 개인기를 연속으로 쓰기보다 한 번 방향을 바꾸고 연결하세요. 측면에서 막히면 중앙으로 무리하게 돌파하지 말고 지원 선수에게 돌려주세요.'),
    'block': ('슈팅하는 선수와 골문 사이로 복귀', '슈팅 직전에 달려들기보다 골문 쪽 수비 위치를 먼저 잡으세요. 다른 수비수를 끌어내지 않고 슈팅 경로를 좁히세요.'),
    'aerial': ('낙하 지점과 세컨드 볼 지원 확보', '공이 떨어지는 위치를 먼저 잡고 주변 동료를 붙이세요. 불리한 공중볼 경합을 반복하기보다 짧게 연결하는 선택을 늘리세요.'),
    'ball_possession': ('받기 전에 다음 패스 경로 확보', '공을 받기 전에 가까운 동료를 확인하세요. 상대가 등을 밀착하면 오래 버티지 말고 연결한 뒤 다시 패스를 받을 위치로 움직이세요.'),
}
COACHES = {
    'pass': (36, '안정적인 빌드업'), 'shot': (41, '침착하게 골 찬스 만들기'),
    'finishing': (41, '침착하게 골 찬스 만들기'), 'tackle': (13, '스탠딩 태클 향상'),
    'dribble': (30, '퍼스트 터치 후 바로 이동'), 'block': (44, '재정비'),
    'aerial': (12, '능숙한 몸 싸움'), 'ball_possession': (12, '능숙한 몸 싸움'),
}


def _evidence(metric: dict) -> str:
    return f"{metric['label']} {metric['value']:.1%} · {metric['success']:g}/{metric['trials']:g}회 · {metric['observed_matches']}경기"


def build_player_guidance(player: dict, settings: dict | None = None, mode: int = 60, plans: list[dict] | None = None) -> dict:
    metrics = {m['metric']: m for m in player['measurements'] if m.get('value') is not None and m.get('trials', 0) > 0}
    strengths, improvements = [], []
    for metric in metrics.values():
        comparison = metric.get('comparison', {})
        if comparison.get('status') not in {'higher', 'lower'}:
            continue
        previous = comparison['previous']
        item = {'title': metric['label'], 'evidence': f"{_evidence(metric)} · 이전 {previous['value']:.1%} ({previous['success']:g}/{previous['trials']:g}회)"}
        (strengths if comparison['status'] == 'higher' else improvements).append(item)
    position = player['position_name']
    preferred = ['pass'] if position == 'GK' else ['tackle', 'pass', 'block'] if position in {'LB', 'RB', 'LCB', 'RCB', 'CB', 'SW', 'LWB', 'RWB'} else ['finishing', 'shot', 'pass'] if position in {'LS', 'RS', 'ST', 'CF', 'LF', 'RF'} else ['pass', 'dribble', 'tackle']
    ordered = sorted(metrics.values(), key=lambda m: (m.get('comparison', {}).get('status') != 'lower', preferred.index(m['metric']) if m['metric'] in preferred else 99))
    focus = ordered[0] if ordered else None
    recommendations = []
    if mode != 52 and focus:
        title, action = ADVICE[focus['metric']]
        if position == 'GK':
            title, action = '압박이 없는 수비수에게 배급', '골키퍼가 공을 잡으면 가까운 수비수의 압박 상태부터 확인하세요. 상대가 짧은 배급을 막으면 빈 측면으로 보내고, 중앙으로 급하게 패스하지 마세요.'
        recommendations.append({'kind': 'play', 'title': title, 'description': action, 'basis': _evidence(focus)})
    for plan in plans or []:
        if plan['status'] not in {'priority', 'review'} and plan['id'] != 'coach_role':
            continue
        for action in plan['actions']:
            if action['kind'] == 'play' and recommendations:
                continue
            change = f"{action['current']} → {action['proposed']}. " if action['current'] is not None and action['proposed'] is not None else ''
            recommendations.append({'kind': action['kind'], 'title': action['label'], 'description': change + action['reason'], 'basis': plan['reason']})
    coach = (settings or {}).get('training_coach', {})
    if mode != 52 and focus and coach.get('status') in {'present', 'unset'}:
        code, label = (47, '빠른 볼 배급') if position == 'GK' else COACHES[focus['metric']]
        if focus['metric'] in {'shot', 'finishing'}:
            shot_type = max(player.get('shot_types') or [], key=lambda item: item['trials'], default=None)
            if shot_type and '감아차기' in shot_type['label']:
                code, label = 6, '감아차기 향상'
            elif shot_type and '낮은 슛' in shot_type['label']:
                code, label = 4, '낮은 슛 향상'
        current = [item['label'] for item in coach.get('value') or [] if item.get('known')]
        recommendations.append({'kind': 'coach', 'title': f"{'현재 코치 활용' if label in current else '역할별 코치 선택지'} · {label}",
                                'description': f"{'현재 장착한 항목을 유지하고 위 플레이에 활용하세요.' if label in current else '해당 역할을 강화하고 싶을 때 비교할 후보입니다. 현재 코치를 한꺼번에 바꾸지 말고 한 항목만 비교하세요.'}",
                                'basis': f"현재 확인된 코치: {' · '.join(current) if current else '피드에서 미설정'}. 이 기록으로 코치 교체의 효과가 검증된 것은 아닙니다."})
    if mode == 52:
        recommendations = [{'kind': 'setting', 'title': '팀·개인 전술은 한 항목씩 비교', 'description': '감독 모드에서는 직접 조작 대신 선수 구성과 포메이션을 유지하고 한 항목만 바꾸세요.', 'basis': '자동 경기 기록으로 직접 조작을 평가하지 않습니다.'}]
    return {'strengths': strengths[:2], 'improvements': improvements[:2],
            'observations': [_evidence(metric) for metric in ordered[:3]], 'recommendations': recommendations[:4],
            'comparison_note': '이전 경기 대비 상승·하락이 확인된 항목만 장점·개선점으로 표시합니다. 나머지 제안은 현재 기록에 맞춘 플레이 선택지입니다.'}
