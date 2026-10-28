from app.services.comparison_evidence import MIN_MATCHES

# 제안은 실제 차이를 점검하는 선택지이며, 설정이 원인이라는 판정이 아니다.
PLANS = {
    'creation': ('슈팅 기회 늘리기', '패스를 받기 전에 박스 안 동료와 침투 경로를 확인하세요. 각도가 좁을 때는 중앙 동료에게 연결해 슈팅 기회를 만들어 보세요.',
                 '공격수 한 명은 가까운 지원, 한 명은 침투를 맡기고 측면 선수는 서로 다른 패스 경로를 만들도록 역할을 나눠 보세요.', 'shot', 'offensive_style_chancecreation'),
    'passing': ('패스 연결', '패스를 받기 전에 가까운 지원 선수를 확인하고, 막힌 전진 패스는 옆이나 뒤로 연결하세요.',
                '중앙 미드필더 한 명은 후방 대기와 짧은 지원을 맡기고, 다른 한 명은 전진 연결을 맡겨 패스 경로를 나눠 보세요.', 'pass', 'offensive_style_buildup'),
    'through': ('침투 패스 타이밍', '동료의 출발과 수비수 사이 패스 경로가 동시에 열렸을 때 보내세요. 수비수가 먼저 도달할 공은 가까운 패스로 바꾸세요.',
                '공격수 전원을 뒤에서 침투로 맞추기보다 한 명은 가까운 지원, 다른 한 명은 침투 역할로 나눠 보세요.', 'pass', 'offensive_style_chancecreation'),
    'finishing': ('슈팅 선택', '골키퍼 위치와 슈팅 경로를 먼저 확인하고, 각도가 좁으면 중앙 동료에게 연결한 뒤 슈팅하세요.',
                  '박스 안 선수를 무작정 늘리기보다 한 명은 침투, 한 명은 지원 역할로 두어 슈팅 각도를 확보해 보세요.', 'finishing', 'offplayerinbox'),
    'accuracy': ('유효 슈팅 만들기', '수비수가 슈팅 경로를 막고 있으면 강행하지 말고 옆 동료에게 연결하세요. 슈팅 유형별 기록에서 각도와 성공률을 함께 확인하세요.',
                 '공격수 중 한 명은 중앙에서 공을 받아 연결하는 역할로 두고, 다른 선수의 침투로 슈팅 공간을 만들어 보세요.', 'shot', 'offwidth'),
    'defense': ('수비 간격', '중앙 수비수를 먼저 끌어내기보다 수비형 미드필더로 패스 경로를 막고, 상대 터치가 길어진 순간에 접근하세요.',
                '한쪽 풀백과 수비형 미드필더 한 명을 후방 대기·중앙 커버로 두고, 양쪽 풀백의 동시 공격 가담을 줄여 보세요.', 'tackle', 'defdepth'),
    'tackle': ('태클 타이밍', '달려들기 전에 상대의 다음 터치를 확인하고, 공이 발에서 떨어지는 순간에 태클하세요.',
               '수비형 미드필더의 중앙 커버를 우선 확인하고, 풀백 한쪽은 후방 대기로 수비 지원을 남겨 보세요.', 'tackle', 'defensivestyle'),
    'block': ('슈팅 경로 차단', '공을 가진 선수에게 곧장 달려들기보다 골문과 슈팅하는 선수 사이를 먼저 지키세요.',
              '센터백이 측면까지 따라 나가지 않도록 미드필더의 중앙 커버와 풀백의 복귀 역할을 확인하세요.', 'block', 'defwidth'),
    'retention': ('볼 소유와 경합', '압박받는 방향으로 계속 드리블하지 말고 가까운 지원 선수를 이용하세요. 공중볼은 지원 선수가 있는 위치로 보내세요.',
                  '공격수 한 명은 가까운 지원 역할로 두고, 미드필더가 패스를 받을 위치에 남도록 역할을 나눠 보세요.', 'ball_possession', 'offensive_style_buildup'),
    'discipline': ('파울·오프사이드 줄이기', '상대에게 뒤늦게 태클하는 상황을 줄이고, 침투 패스는 수비 라인과 동료의 출발을 확인한 뒤 보내세요.',
                   '공격수 전원의 동시 침투 대신 지원 역할을 섞고, 수비형 미드필더 한 명은 중앙 커버를 맡겨 보세요.', 'tackle', 'teammentality'),
}


def family(key):
    if key in ('overview:goals_for', 'shooting:goals', 'shooting:display_goals', 'shooting:assists'): return 'creation'
    if key in ('overview:win_rate', 'overview:average_rating'): return 'performance'
    if key.startswith('passing:'):
        return 'through' if 'through' in key else 'passing'
    if key in ('overview:goals_against', 'defending:goals_against', 'defending:shots_against', 'defending:late_conceded'):
        return 'defense'
    if key == 'defending:team_tackle': return 'tackle'
    if key == 'defending:team_block': return 'block'
    if key == 'shooting:on_target': return 'accuracy'
    if key.startswith('shooting:'): return 'finishing'
    if key.startswith('carrying:'): return 'retention'
    if key.startswith('discipline:'): return 'discipline'
    return key


def _players(coaching, metric):
    candidates = []
    for player in coaching.get('players', []):
        measurement = next((item for item in player['measurements'] if item['metric'] == metric and item['trials'] > 0), None)
        if measurement and measurement['observed_matches'] >= MIN_MATCHES:
            candidates.append((measurement['trials'] - measurement['success'], player, measurement))
    candidates.sort(key=lambda item: item[0], reverse=True)
    return [{'name': p['player_name'], 'position': p['position_name'], 'success': m['success'], 'trials': m['trials'], 'label': m.get('label', metric),
             'note': '선수의 전체 유형 합산 기록에서 실패가 많은 자리입니다. 위의 특정 패스·슈팅 유형만의 기록이 아니며, 개인을 팀 평균과 직접 비교한 판정은 아닙니다.'}
            for failures, p, m in candidates[:2] if failures > 0]


def build_ranker_coaching(groups, benchmark, coaching):
    refs = {m['id']: m for g in benchmark.get('groups', []) for m in g['metrics']}
    current = {m['id']: m for g in groups for m in g['metrics']}
    findings = []
    for group in groups:
        for mine in group['metrics']:
            reference = refs.get(mine['id'])
            if mine['id'] == 'overview:win_rate' or not reference or mine['value'] is None or mine['direction'] == 'neutral':
                continue
            if mine['matches'] < MIN_MATCHES or reference['ranker_count'] < MIN_MATCHES:
                continue
            if mine['unit'] == 'rate' and (mine.get('trials') or 0) < 20:
                continue
            value = mine['value']
            if reference.get('q1') is None or reference.get('q3') is None:
                continue
            side = 'higher' if value > reference['q3'] else 'lower' if value < reference['q1'] else None
            if not side: continue
            status = 'strength' if (side == 'higher') == (mine['direction'] == 'higher') else 'weakness'
            gap = value - reference['value']
            scale = reference.get('spread') or abs(reference['value']) or 1
            findings.append({'id': mine['id'], 'label': mine['label'], 'group': group['id'],
                'mine': mine, 'reference': reference, 'gap': gap, 'status': status,
                'score': abs(gap) / scale, 'family': family(mine['id'])})
    findings.sort(key=lambda item: item['score'], reverse=True)
    by_group = {}
    for group in groups:
        unique = {}
        for finding in findings:
            if finding['group'] == group['id']:
                key = 'shooting:goals' if finding['id'] == 'shooting:display_goals' else finding['id']
                unique.setdefault(key, finding)
        by_group[group['id']] = {name: [item for item in unique.values() if item['status'] == status][:2]
                                for name, status in (('strengths', 'strength'), ('weaknesses', 'weakness'))}
    chosen, seen = [], set()
    for finding in findings:
        key = (finding['status'], finding['family'])
        if key not in seen:
            chosen.append(finding); seen.add(key)
    strengths = [item for item in chosen if item['status'] == 'strength'][:3]
    weaknesses = [item for item in chosen if item['status'] == 'weakness'][:3]
    feed = coaching.get('squad_feed', {})
    settings = {s['key']: s for s in feed.get('snapshot', {}).get('team_tactics', []) if s.get('status') == 'present'} if feed.get('author_status') == feed.get('mode_status') == 'matched' else {}
    advice = []
    for finding in [item for item in chosen if item['status'] == 'weakness']:
        if len(advice) == 3: break
        plan = PLANS.get(finding['family'])
        if not plan: continue
        title, play, tactic, player_metric, setting_key = plan
        setting = settings.get(setting_key)
        context = None
        conversion, old_conversion = current.get('shooting:conversion'), refs.get('shooting:conversion')
        if finding['family'] == 'creation' and conversion and old_conversion and conversion['value'] is not None and conversion['value'] >= old_conversion['value']:
            context = f"득점 전환율은 내 {conversion['value']:.1%} · 랭커 {old_conversion['value']:.1%}로 평균 이상입니다. 슈팅 정확도만 바꾸기보다 슈팅 기회를 만드는 횟수를 먼저 확인하세요."
        if finding['family'] == 'passing' and finding['id'] == 'passing:long:success' and setting and setting['value'] == '긴 패스':
            tactic = '피드에 저장된 빌드업 ‘긴 패스’를 ‘밸런스’로 바꿔 가까운 지원 경로를 늘려 보세요. 다른 설정은 우선 유지하고 긴 패스 시도·성공률과 슈팅 기회를 함께 비교하세요.'
        if finding['family'] == 'defense' and setting:
            tactic = f"피드의 수비 깊이 {setting['value']}는 우선 유지하고, 수비형 미드필더 한 명의 후방 대기·중앙 커버와 풀백의 복귀 역할부터 조정해 보세요."
        advice.append({'metric_id': finding['id'], 'title': title, 'comparison': finding,
            'play': play, 'tactic': tactic, 'context': context, 'players': [] if finding['family'] == 'creation' else _players(coaching, player_metric),
            'setting': {'label': setting['label'], 'value': setting['value']} if setting else None,
            'check': f"{finding['label']}의 성공·시도 수와 슈팅·실점을 함께 확인하세요. 랭커 평균은 실측 비교값이며 반드시 맞춰야 하는 목표값은 아닙니다."})
    return {'status': benchmark.get('status', 'unavailable'), 'ranker_count': benchmark.get('ranker_count', 0),
            'record_count': benchmark.get('record_count', 0), 'strengths': strengths, 'weaknesses': weaknesses, 'by_group': by_group, 'advice': advice,
            'method': 'outside_ranker_interquartile_range',
            'note': '내 최근 30경기(공식·친선 합산)의 정상 종료 기록과 랭커 공식경기 평균을 비교합니다. 랭커별 실제 지표의 가운데 50% 범위 밖인 항목을 우선 표시합니다. 경기 모드·상대·선수 구성이 달라 수치 차이의 원인이나 실력 차이를 단정하지 않습니다.'}
