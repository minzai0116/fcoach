from app.services.analysis_models import MatchStats
from app.services.coaching_data import number, recorded_team_goals
from app.services.match_selection import eligible_match_rows


CONTROLLERS = ('keyboard', 'gamepad')
_RATES = (
    ('on_target', 'shoot', 'effectiveShootTotal', 'shootTotal'),
    ('pass', 'pass', 'passSuccess', 'passTry'),
    ('tackle', 'defence', 'tackleSuccess', 'tackleTry'),
)


def recorded_controller(value: object) -> str | None:
    controller = value.strip().lower() if isinstance(value, str) else None
    return controller if controller in CONTROLLERS else None


def _summarize(rows: list[MatchStats]) -> dict:
    results = dict.fromkeys(('승', '무', '패'), 0)
    goals = {'goals_for': [], 'goals_against': []}
    rates = {key: [0.0, 0.0, 0] for key, *_ in _RATES}
    for row in rows:
        result = {1: '승', 2: '패'}.get(row.match_end_type, row.result)
        if result in results:
            results[result] += 1
        if row.match_end_type == 0:
            for key, values in goals.items():
                value = recorded_team_goals(row, opponent=key == 'goals_against')
                if value is not None:
                    values.append(value)
        for key, section, made, tried in _RATES:
            data = row.coaching_data.get(section, {})
            success, trials = number(data, made), number(data, tried)
            if success is not None and trials is not None and 0 < trials and success <= trials:
                totals = rates[key]
                totals[0] += success
                totals[1] += trials
                totals[2] += 1
    outcomes = sum(results.values())
    return {
        'matches': len(rows), 'wins': results['승'], 'draws': results['무'], 'losses': results['패'],
        'win_rate': results['승'] / outcomes if outcomes else None,
        **{key: {'value': sum(values) / len(values) if values else None, 'matches': len(values)} for key, values in goals.items()},
        **{key: {'value': success / trials if trials else None, 'matches': matches, 'success': success, 'trials': trials}
           for key, (success, trials, matches) in rates.items()},
    }


def opponent_controller_comparison(rows: list[MatchStats]) -> list[dict]:
    grouped: dict[int, dict[str | None, list[MatchStats]]] = {}
    for row in eligible_match_rows(rows, True, True):
        if row.match_type in (50, 60):
            grouped.setdefault(row.match_type, {}).setdefault(row.opponent_controller, []).append(row)
    return [
        {'match_type': mode, 'unknown_matches': len(groups.get(None, [])),
         **{controller: _summarize(groups.get(controller, [])) for controller in CONTROLLERS}}
        for mode, groups in sorted(grouped.items())
    ]
