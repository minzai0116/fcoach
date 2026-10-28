"""같은 경기의 유효한 양 팀 기록끼리 성공률을 비교한다."""
from app.services.coaching_data import number
from app.services.comparison_evidence import compare_rates, rate_sample
from app.services.domain_coaching import SHOT_PAIRS
from app.services.passing_coaching import PASS_TYPES


RATIOS = (
    *((('finishing' if key == 'conversion' else key), label, 'shoot', made, tried)
      for key, (label, made, tried) in SHOT_PAIRS.items()),
    ('pass', '전체 패스 성공률', 'pass', 'passSuccess', 'passTry'),
    *((key, f'{label} 성공률', 'pass', f'{prefix}Success', f'{prefix}Try')
      for key, (label, prefix) in PASS_TYPES.items()),
    ('tackle', '태클 성공률', 'defence', 'tackleSuccess', 'tackleTry'),
    ('block', '블록 성공률', 'defence', 'blockSuccess', 'blockTry'),
)


def opponent_comparison(rows):
    completed = [row for row in rows if row.match_end_type == 0]
    comparisons = []
    for key, label, section, made, attempted in RATIOS:
        mine_success = mine_trials = their_success = their_trials = 0
        dates = []
        for row in completed:
            mine = row.coaching_data.get(section, {})
            theirs = row.coaching_data.get(f'opponent_{section}', {})
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
        compared = compare_rates(current, opponent, 20)
        gap = compared['gap_pp']
        status = compared['status']
        if status != 'unavailable':
            difference = (current['value'] - opponent['value']) * 100
            status = 'no_clear_change' if abs(difference) < .05 else 'higher' if difference > 0 else 'lower'
        comparisons.append({'metric': key, 'label': label, 'mine': current, 'opponent': opponent,
                            'status': status, 'gap_pp': gap, 'method': 'paired_observed_rates'})
    return {'source': 'same_matches_opponents', 'matches': len(completed), 'metrics': comparisons,
            'note': '정상 종료 경기에서 양 팀의 유효한 성공·시도가 함께 있는 기록만 비교합니다. 각 5경기·20회 이상인 항목의 실제 성공률 차이를 표시하며 통계적 유의성이나 실력 차이를 뜻하지 않습니다.'}
