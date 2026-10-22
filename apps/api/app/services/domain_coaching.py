from __future__ import annotations

from collections import defaultdict
from typing import Any

from app.services.analysis_models import MatchStats
from app.services.match_selection import eligible_match_rows
from app.services.coaching_data import PLAYER_COUNTERS, PLAYER_PAIRS, active_players, number


from app.services.shot_types import SHOT_TYPES, shot_type_label


SHOT_PAIRS = {
    'on_target': ('유효 슈팅 비율', 'effectiveShootTotal', 'shootTotal'),
    'conversion': ('전체 득점 전환율', 'goalTotal', 'shootTotal'),
    'box_inside': ('박스 안 득점 전환율', 'goalInPenalty', 'shootInPenalty'),
    'box_outside': ('박스 밖 득점 전환율', 'goalOutPenalty', 'shootOutPenalty'),
    'heading': ('헤딩 득점 전환율', 'goalHeading', 'shootHeading'),
    'freekick': ('프리킥 득점 전환율', 'goalFreekick', 'shootFreekick'),
    'penalty': ('PK 득점 전환율', 'goalPenaltyKick', 'shootPenaltyKick'),
}
PLAYER_LABELS = {'dribble': '드리블 성공률', 'ball_possession': '볼 소유 성공률', 'aerial': '공중볼 경합 성공률'}
COUNTERS = {'intercept': ('인터셉트', 'defending'), 'defending_actions': ('선방·골 차단 횟수', 'defending'),
            'dribble_distance': ('선수 드리블 거리', 'carrying'), 'goals': ('선수 득점', 'shooting'),
            'assists': ('선수 도움', 'shooting'), 'yellow_cards': ('선수 옐로카드', 'discipline'), 'red_cards': ('선수 레드카드', 'discipline')}


def _metric(key: str, label: str, samples: list, minimum: int = 0, unit: str = 'rate', guide: str = 'observe') -> dict:
    if unit == 'rate':
        success, trials = sum(v[1] for v in samples), sum(v[2] for v in samples)
        value = success / trials if trials else None
        history = [{'date': date, 'value': good / tries if tries else None} for date, good, tries in reversed(samples)]
        counts = {'success': success, 'trials': trials, 'failures': trials - success}
        sufficient = len(samples) >= 5 and trials >= minimum
    else:
        total = sum(v[1] for v in samples)
        value = total / len(samples) if samples else None
        history = [{'date': date, 'value': val} for date, val in reversed(samples)]
        counts = {'total': total}
        sufficient = len(samples) >= 5
    return {'metric': key, 'label': label, 'unit': unit, 'value': round(value, 6 if unit == 'rate' else 4) if value is not None else None,
            **counts, 'observed_matches': len(samples), 'minimum_trials': minimum,
            'status': 'sufficient' if sufficient else 'insufficient', 'guide': guide, 'history': history}


def build_domain_coaching(rows: list[MatchStats], *, include_forfeits: bool = False, player_names: dict[int, str] | None = None) -> list[dict[str, Any]]:
    series = defaultdict(list)
    shot_groups = []
    points = []
    periods = [{'label': label, 'goals_for': 0, 'goals_against': 0} for label in ('0–15', '15–30', '30–45', '45–60', '60–75', '75+')]
    completed = eligible_match_rows(rows, include_forfeits, include_forfeits)
    for row in completed:
        data, date = row.coaching_data, row.match_date
        for key, (_, success_key, trials_key) in SHOT_PAIRS.items():
            success, trials = number(data.get('shoot', {}), success_key), number(data.get('shoot', {}), trials_key)
            if success is not None and trials is not None and success <= trials:
                series[key].append((date, success, trials))
        for key, success_key, trials_key in (('team_tackle', 'tackleSuccess', 'tackleTry'), ('team_block', 'blockSuccess', 'blockTry')):
            success, trials = number(data.get('defence', {}), success_key), number(data.get('defence', {}), trials_key)
            if success is not None and trials is not None and success <= trials:
                series[key].append((date, success, trials))
        for key, field in (('possession', 'possession'), ('offside', 'offsideCount'), ('foul', 'foul'), ('yellow', 'yellowCards'), ('red', 'redCards'), ('corner', 'cornerKick'), ('injury', 'injury'), ('team_distance', 'dribble'), ('average_rating', 'averageRating')):
            value = number(data.get('detail', {}), field)
            if value is not None:
                series[key].append((date, value / 100 if key == 'possession' else value))
        for key, source in (('goals_for', 'shoot'), ('goals_against', 'opponent_shoot'), ('shots_against', 'opponent_shoot')):
            value = number(data.get(source, {}), 'shootTotal') if key == 'shots_against' else number(data.get(source, {}), 'goalTotalDisplay', 'goalTotal')
            if value is not None:
                series[key].append((date, value))
        for key, field in (('display_goals', 'goalTotalDisplay'), ('own_goals', 'ownGoal'), ('shootout_shots', 'shootOutScore')):
            value = number(data.get('shoot', {}), field)
            if value is not None:
                series[key].append((date, value))
        if row.result in ('승', '무', '패'):
            series['win_rate'].append((date, int(row.result == '승'), 1))

        player_pairs = {key: [0, 0, False] for key in PLAYER_LABELS}
        player_counts = {key: [0, False] for key in COUNTERS}
        for player in active_players(row):
            for key in player_pairs:
                success_key, trials_key, *_ = PLAYER_PAIRS[key]
                if not player.get(f'{key}_observed', False):
                    continue
                player_pairs[key][0] += player[success_key]
                player_pairs[key][1] += player[trials_key]
                player_pairs[key][2] = True
            for key in player_counts:
                if player.get(f'{key}_observed', False):
                    player_counts[key][0] += player[key]
                    player_counts[key][1] = True
        for key, (success, trials, observed) in player_pairs.items():
            if observed:
                series[key].append((date, success, trials))
        for key, (value, observed) in player_counts.items():
            if observed:
                series[key].append((date, value))

        if data.get('shots_observed'):
            per_type = defaultdict(lambda: [0, 0, 0])
            for shot in data['shots']:
                key = f"shot_type_{int(shot['type'])}" if shot['type'] is not None else 'shot_type_unknown'
                per_type[key][0] += int(shot['result'] == 3)
                per_type[key][1] += 1
                per_type[key][2] += int(shot['result'] in (1, 3))
                if shot['x'] is not None and shot['y'] is not None:
                    points.append({**shot, 'date': date, 'match_id': row.match_id,
                                   'player_name': (player_names or {}).get(shot.get('sp_id'))})
            # 일치하는 유형이 없는 경기의 0회도 유효한 표본으로 보존한다.
            shot_groups.append((date, dict(per_type)))
        for source, field, observed in (('shots', 'goals_for', 'shots_observed'), ('opponent_shots', 'goals_against', 'opponent_shots_observed')):
            if not data.get(observed):
                continue
            goals = [s for s in data[source] if s['result'] == 3 and s['minute'] is not None]
            for shot in goals:
                periods[min(int(shot['minute'] // 15), 5)][field] += 1
            if field == 'goals_against':
                series['late_conceded'].append((date, sum(s['minute'] >= 60 for s in goals), len(goals)))

    metrics = {key: _metric(key, label, series[key], 20, guide='shoot') for key, (label, *_) in SHOT_PAIRS.items()}
    type_keys = {f'shot_type_{code}' for code in SHOT_TYPES} | {key for _, group in shot_groups for key in group}
    total_detail_shots = sum(v[1] for _, group in shot_groups for v in group.values())
    total_detail_misses = total_detail_shots - sum(v[0] for _, group in shot_groups for v in group.values())
    for key in sorted(type_keys, key=lambda k: int(k.removeprefix('shot_type_')) if k.removeprefix('shot_type_').isdigit() else 999):
        code = key.removeprefix('shot_type_')
        label = SHOT_TYPES.get(int(code), f'종류 미확인 슈팅 · 코드 {code}') if code.isdigit() else '종류 미확인 슈팅'
        samples = [(date, group.get(key, [0, 0, 0])[0], group.get(key, [0, 0, 0])[1]) for date, group in shot_groups]
        item = _metric(key, f'{label} 득점 전환율', samples, 20, guide='shoot')
        item['on_target'] = sum(group.get(key, [0, 0, 0])[2] for _, group in shot_groups)
        item['on_target_rate'] = round(item['on_target'] / item['trials'], 4) if item['trials'] else None
        item['usage_share'] = round(item['trials'] / total_detail_shots, 4) if item['trials'] else None
        item['failure_share'] = round(item['failures'] / total_detail_misses, 6) if total_detail_misses else None
        metrics[key] = item
    for key, label in (('team_tackle', '태클 성공률'), ('team_block', '블록 성공률'), ('late_conceded', '60분 이후 실점 비중')):
        metrics[key] = _metric(key, label, series[key], 10, guide='defend')
    for key, label in PLAYER_LABELS.items():
        metrics[key] = _metric(key, label, series[key], 20, guide='aerial' if key == 'aerial' else 'carry')
    for key, (label, _) in COUNTERS.items():
        metrics[key] = _metric(key, f'{label} / 경기', series[key], unit='yards' if key == 'dribble_distance' else 'goals' if key == 'goals' else 'average', guide='defend' if key == 'intercept' else 'observe')
    labels = {'possession': ('평균 점유율', 'percent'), 'offside': ('경기당 오프사이드', 'average'), 'foul': ('경기당 파울', 'average'), 'yellow': ('경기당 옐로카드', 'average'), 'red': ('경기당 레드카드', 'average'), 'corner': ('경기당 코너킥', 'average'), 'injury': ('경기당 부상', 'average'), 'team_distance': ('경기당 팀 드리블 거리', 'yards'), 'average_rating': ('평균 경기 평점', 'rating'), 'goals_for': ('경기당 팀 득점', 'goals'), 'goals_against': ('경기당 실점', 'goals'), 'shots_against': ('경기당 상대 슈팅', 'average')}
    for key, (label, unit) in labels.items():
        metrics[key] = _metric(key, label, series[key], unit=unit, guide='discipline' if key in ('offside', 'foul', 'yellow', 'red') else 'observe')
    for key, label in (('display_goals', '경기당 팀 득점'), ('own_goals', '경기당 자책골'), ('shootout_shots', '경기당 승부차기 슈팅')):
        metrics[key] = _metric(key, label, series[key], unit='average' if key == 'shootout_shots' else 'goals')
    metrics['win_rate'] = _metric('win_rate', '승률', series['win_rate'], 5)
    return [
        {'id': 'shooting', 'label': '슈팅', 'description': '슈팅 종류·지역별 득점 전환과 유효 슈팅', 'focus_metric': 'box_outside',
         'metrics': [metrics[key] for key in (*SHOT_PAIRS, *(k for k in metrics if k.startswith('shot_type_')), 'goals', 'assists', 'display_goals', 'own_goals', 'shootout_shots')], 'shot_map': points,
         'note': '박스 안·밖·PK와 헤딩·프리킥은 겹치는 분류여서 비중을 합산하지 않습니다. 종류별 지표는 shootDetail, 지역·상황별 지표는 shoot 집계 기록을 사용합니다. 두 출처의 분류 수가 다를 수 있습니다. result 1·3은 유효 슈팅, 3은 득점입니다. 미정의 종류는 이름을 추정하지 않습니다. 득점 전환율에는 goalTotal을 사용하고, 경기 결과의 팀 득점·자책골 기록·승부차기는 별도로 표시합니다.'},
        {'id': 'defending', 'label': '수비', 'description': '태클·블록·인터셉트와 실점 시간대', 'focus_metric': 'team_tackle',
         'metrics': [metrics[key] for key in ('team_tackle', 'team_block', 'intercept', 'defending_actions', 'goals_against', 'shots_against', 'late_conceded')], 'periods': periods,
         'note': '태클·블록은 팀 defence 기록, 인터셉트·선방(골 차단) 기록은 유효 선수 기록 합산입니다. 수비 위치·압박 상황·골키퍼 선방 시도는 제공되지 않습니다. 실점 시간대는 상대 슈팅 상세 중 시간 정보가 있는 득점만 사용하며 75+에 연장전을 포함합니다.'},
        {'id': 'carrying', 'label': '드리블·경합', 'description': '드리블·볼 소유·공중볼 경합', 'focus_metric': 'ball_possession',
         'metrics': [metrics[key] for key in (*PLAYER_LABELS, 'dribble_distance', 'team_distance')],
         'note': '성공률과 선수 거리는 출전이 확인된 선수의 유효 기록만 합산합니다. 팀 드리블 거리는 별도 matchDetail 기록이라 선수 합산 거리와 일치하지 않을 수 있습니다. 원본 거리는 야드로 제공되며 화면에서는 m로 환산합니다. 이동 경로나 실제 압박 위치는 알 수 없습니다.'},
        {'id': 'discipline', 'label': '경기 운영', 'description': '오프사이드·파울·카드·세트피스', 'focus_metric': 'offside',
         'metrics': [metrics[key] for key in ('offside', 'foul', 'yellow', 'red', 'corner', 'injury', 'yellow_cards', 'red_cards')],
         'note': '카드는 팀 matchDetail과 선수 합산 기록을 별도로 표시합니다. 부상·코너킥 횟수가 좋고 나쁨을 뜻하지 않으며 인과관계는 확인할 수 없습니다.'},
        {'id': 'overview', 'label': '경기 종합', 'description': '승률·득실·점유율·평점', 'focus_metric': 'goals_against',
         'metrics': [metrics[key] for key in ('win_rate', 'goals_for', 'goals_against', 'possession', 'average_rating')],
         'note': '점유율·평점은 확인된 경기별 값의 평균, 승률은 선택한 분석 경기의 승/무/패 중 승 비율입니다. 몰수 포함 여부는 분석 조건을 확인하세요. xG는 기존 화면의 추정치여서 이 실제 기록 비교에 포함하지 않습니다. 이 지표만으로 전술·선수 능력·조작 중 원인을 확정하지 않습니다.'},
    ]
