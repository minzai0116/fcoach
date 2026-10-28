"""점수에 반영하는 항목과 참고 기록을 구분한다."""
BASE_AREAS = (
    ('passing', '패스', ('passing:overall',)),
    ('shooting', '슈팅', ('shooting:on_target', 'shooting:conversion', 'shooting:box_inside', 'shooting:box_outside')),
    ('defending', '수비', ('defending:team_tackle', 'defending:team_block', 'defending:goals_against', 'defending:shots_against', 'defending:late_conceded', 'defending:intercept', 'defending:defending_actions')),
    ('carrying', '드리블·경합', ('carrying:dribble', 'carrying:ball_possession', 'carrying:aerial', 'carrying:dribble_distance', 'carrying:team_distance')),
    ('discipline', '경기 운영', ('discipline:foul', 'discipline:offside')),
)
CORE_KEYS = {key for _, _, keys in BASE_AREAS for key in keys}


def supported(key):
    return key in CORE_KEYS or (key.startswith('passing:') and key.endswith(':success')) or key.startswith('shooting:shot_type_')


def section(key):
    if key.startswith('passing:'):
        return '전체' if key == 'passing:overall' else '유형별'
    if key.startswith('shooting:shot_type_'): return '유형별'
    if key in ('shooting:box_inside', 'shooting:box_outside'): return '지역별'
    if key == 'shooting:conversion': return '전체'
    if key == 'shooting:on_target': return '정확도'
    if key in ('defending:team_tackle', 'defending:team_block'): return '수비 성공'
    if key in ('defending:intercept', 'defending:defending_actions', 'defending:late_conceded'): return '참고 기록'
    if key.startswith('defending:'): return '실점 억제'
    if key in ('carrying:dribble_distance', 'carrying:team_distance'): return '참고 기록'
    return '경합' if key.startswith('carrying:') else '경기 운영'


def assign_weights(metrics, area):
    active = [m for m in metrics if m['score'] is not None]
    if area == 'passing' and any(m['section'] == '유형별' for m in active):
        active = [m for m in active if m['section'] != '전체']
    if area == 'shooting' and any(m['section'] in ('유형별', '지역별') for m in active):
        active = [m for m in active if m['section'] != '전체']
    sections = {}
    for metric in active:
        sections.setdefault(metric['section'], []).append(metric)
    for group, items in sections.items():
        use_share = group in ('유형별', '지역별')
        volumes = [m['usage'] if use_share and m['usage'] is not None else 1 for m in items]
        denominator = sum(volumes)
        if not denominator:
            volumes, denominator = [1] * len(items), len(items)
        for metric, volume in zip(items, volumes):
            metric['weight'] = volume / denominator / len(sections)
            metric['point_impact'] = round((metric['score'] - metric['reference_score']) * metric['weight'], 2)
    return active
