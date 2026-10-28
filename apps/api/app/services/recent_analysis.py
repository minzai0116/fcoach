from concurrent.futures import ThreadPoolExecutor

from app.services.analysis_errors import MatchSyncWarning
from app.services.comparison_evidence import compare_rates, rate_sample
from app.services.team_history_coaching import build_team_history_coaching

PLAY_MODES = (50, 60)
MODE_LABELS = {50: '공식경기', 60: '공식 친선'}
# 분모가 양쪽 모두 유효한 같은 경기끼리만 비교한다.
RATIOS = (
    ('on_target', '유효 슈팅 비율', 'shoot', 'effectiveShootTotal', 'shootTotal', 10,
     '수비수가 슈팅 경로를 막으면 가까운 동료에게 연결하고, 열린 각도에서 슈팅해 보세요.'),
    ('finishing', '득점 전환율', 'shoot', 'goalTotal', 'shootTotal', 10,
     '슈팅 위치와 골키퍼의 위치를 확인하고, 페널티박스 안에서 슈팅 기회를 만들어 보세요.'),
    ('pass', '패스 성공률', 'pass', 'passSuccess', 'passTry', 30,
     '공을 받기 전에 지원 선수를 확인하고, 압박받을 때는 옆이나 뒤로 연결해 보세요.'),
    ('through', '스루패스 성공률', 'pass', 'throughPassSuccess', 'throughPassTry', 20,
     '동료가 침투하고 패스 경로가 열렸을 때 보내세요. 수비수가 경로를 막으면 가까운 패스로 연결하세요.'),
    ('tackle', '태클 성공률', 'defence', 'tackleSuccess', 'tackleTry', 10,
     '수비 위치와 패스 경로를 유지하고, 상대의 터치가 길어진 순간에 태클을 시도해 보세요.'),
)


def load_recent_modes(ouid, loader, **options):
    def load(mode):
        rows, count, warning, refreshed = loader(ouid=ouid, match_type=mode, **options)
        return mode, rows, count, warning, refreshed
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(load, PLAY_MODES))
    merged, warnings, new_count, attempted = {}, [], 0, False
    unavailable = False
    for mode, rows, count, warning, refreshed in results:
        for row in rows:
            row.match_type = mode
            merged.setdefault(row.match_id, row)
        new_count += count
        attempted |= refreshed
        if warning and (rows or isinstance(warning, MatchSyncWarning)):
            warnings.append(f'{MODE_LABELS[mode]}: {warning}')
            unavailable |= isinstance(warning, MatchSyncWarning)
    warning = ' '.join(warnings) or None
    if unavailable and warning:
        warning = MatchSyncWarning(warning)
    return sorted(merged.values(), key=lambda row: (row.match_date, row.match_id), reverse=True), new_count, warning, attempted


def mode_history(rows, all_rows):
    parts = [(mode, build_team_history_coaching([row for row in rows if row.match_type == mode],
                                              [row for row in all_rows if row.match_type == mode], mode))
             for mode in PLAY_MODES if any(row.match_type == mode for row in rows)]
    actions, issues = [], {}
    for mode, part in parts:
        for key, value in part['issues'].items():
            issues[key] = max(issues.get(key, 0), value)
        for action in part['actions']:
            action['title'] = f"{MODE_LABELS[mode]} · {action['title']}"
            action['description'] = f"{MODE_LABELS[mode]}에서 {action['description']}"
            action['evidence']['match_type'] = mode
            action['evidence']['coach_explanation']['problem_detail'] = action['description']
            action['evidence']['coach_explanation']['coach_message'] = action['description']
            actions.append(action)
    actions.sort(key=lambda action: action['evidence']['issue_score'], reverse=True)
    actions = actions[:3]
    for index, action in enumerate(actions, 1):
        action['rank'] = index
    return {'benchmark': {}, 'benchmark_meta': {'source': 'own_history_by_mode',
                'description': '공식경기와 공식 친선을 각각 같은 모드의 이전 기록과 비교합니다. 모드가 다른 기록은 비교 기준에 섞지 않습니다.'},
            'comparisons': {f'{mode}:{key}': value for mode, part in parts for key, value in part['comparisons'].items()},
            'metric_gap_table': [], 'issues': issues,
            'actions': actions}


def opponent_comparison(rows):
    from app.services.coaching_data import number
    comparisons = []
    for key, label, section, made, attempted, minimum, advice in RATIOS:
        mine_success = mine_trials = their_success = their_trials = 0
        dates = []
        for row in rows:
            if row.match_end_type != 0:
                continue
            mine, theirs = row.coaching_data.get(section, {}), row.coaching_data.get(f'opponent_{section}', {})
            values = [number(data, field) for data, field in ((mine, made), (mine, attempted), (theirs, made), (theirs, attempted))]
            if any(value is None for value in values):
                continue
            ms, mt, ts, tt = values
            if mt <= 0 or tt <= 0 or ms > mt or ts > tt:
                continue
            mine_success += ms; mine_trials += mt
            their_success += ts; their_trials += tt
            dates.append(row.match_date)
        current = rate_sample(mine_success, mine_trials, len(dates), dates)
        opponent = rate_sample(their_success, their_trials, len(dates), dates)
        compared = compare_rates(current, opponent, minimum)
        comparisons.append({'metric': key, 'label': label, 'mine': current, 'opponent': opponent,
                            'status': compared['status'], 'gap_pp': compared['gap_pp'],
                            'action': advice, 'method': compared['method']})
    return {'source': 'same_matches_opponents', 'matches': sum(row.match_end_type == 0 for row in rows),
            'note': '같은 정상 종료 경기의 양 팀 기록을 합산해 비교합니다. 양쪽의 유효한 성공·시도 수가 있는 경기만 사용합니다. 성공률의 95% Wilson 구간이 겹치지 않는 항목만 장점·보완점으로 표시하며, 경기 난이도나 원인은 단정하지 않습니다.',
            'metrics': comparisons}
