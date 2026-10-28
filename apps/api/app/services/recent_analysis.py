from concurrent.futures import ThreadPoolExecutor

from app.services.analysis_errors import MatchSyncWarning
from app.services.opponent_comparison import opponent_comparison
from app.services.team_history_coaching import build_team_history_coaching

PLAY_MODES = (50, 60)
MODE_LABELS = {50: '공식경기', 60: '공식 친선'}


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
                                              [row for row in all_rows if row.match_type == mode], mode, include_forfeits=True))
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
