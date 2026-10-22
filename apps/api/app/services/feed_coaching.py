from __future__ import annotations

from collections import defaultdict

from app.services.analysis_models import MatchStats
from app.services.analysis_utils import normalize_nickname
from app.services.feed_diagnosis import build_contextual_coaching


MATCH_LABELS = {'matched': '카드·강화·자리 일치', 'card_mismatch': '다른 시즌 카드', 'grade_mismatch': '강화 불일치',
                'position_mismatch': '자리 불일치', 'identity_missing': '피드의 강화·자리 정보 없음',
                'not_in_feed': '피드에 없는 선수', 'ambiguous': '중복 설정 · 연결 보류'}


def _identity(player: dict) -> tuple:
    return player['sp_id'], player['grade'], player['position']


def _brief(player: dict) -> dict:
    return {key: player[key] for key in ('sp_id', 'grade', 'position', 'name')}


def _checks(player: dict, settings: dict, observation: bool) -> list[dict]:
    result = []
    for metric, field, action in (
        ('pass', 'personal_tactics', '개인 전술과 공/수 참여도를 확인하고 가까운 지원 경로를 확보하는 선택을 시험하세요.'),
        ('shot', 'intrinsic_traits', '슈팅 관련 기본 특성과 슈팅 종류·박스 안팎 기록을 함께 보고 막힌 각도의 슈팅을 줄여 보세요.'),
        ('finishing', 'acquired_traits', '저장된 획득 특성과 슈팅 선택을 확인하되 특성이 득점 차이의 원인이라고 단정하지 마세요.'),
        ('tackle', 'personal_tactics', '저장된 차단·공격 가담 전술을 확인하고 무리한 전진 경합을 줄이는 선택을 시험하세요.'),
        ('block', 'personal_tactics', '저장된 차단 전술과 수비 가담을 확인하고 슈팅 경로을 먼저 지키는 선택을 시험하세요.'),
        ('dribble', 'training_coach', '저장된 코치 특성을 확인하고 지원 없이 연속 드리블하는 선택을 줄여 보세요.'),
        ('ball_possession', 'training_coach', '볼 소유 시도·성공과 코치 설정을 함께 확인하고 가까운 지원 방향을 확보해 보세요.'),
        ('aerial', 'intrinsic_traits', '공중볼 관련 기본 특성을 확인하고 경합 위치와 지원 선수를 확보하는 선택을 시험하세요.'),
    ):
        measured = next((m for m in player['measurements'] if m['metric'] == metric), None)
        if not measured or measured['value'] is None or measured['status'] != 'sufficient':
            continue
        setting = settings[field]
        available = setting['status'] == 'present'
        if not available:
            action = f"피드의 해당 설정은 {'미설정' if setting['status'] == 'unset' else '확인 불가'}입니다. 실제 게임의 미장착으로 해석하거나 이 값으로 교정하지 않습니다."
        elif observation:
            action = '감독 모드에서는 직접 조작을 교정하지 않습니다. 같은 선수·자리와 이 피드 구성을 유지해 자동 경기 기록을 비교하세요.'
        result.append({'metric': metric, 'label': measured['label'], 'value': round(measured['success'] / measured['trials'], 6),
                       'success': measured['success'], 'trials': measured['trials'], 'setting': field,
                       'setting_available': available, 'action': action,
                       'verification': '이 피드로 새 실험을 시작한다면 같은 모드·선수·자리에서 5경기 이상 시도량과 득실도 함께 비교하세요.'})
    return result


def build_feed_coaching(snapshot: dict, coaching: dict, rows: list[MatchStats], match_type: int, history_rows: list[MatchStats] | None = None) -> dict:
    exact, card_grade, card, names = (defaultdict(list) for _ in range(4))
    missing_grades, missing_positions = set(), set()
    for p in snapshot['players']:
        exact[_identity(p)].append(p)
        card_grade[(p['sp_id'], p['grade'])].append(p)
        card[p['sp_id']].append(p)
        names[normalize_nickname(p['name'])].append(p)
        if p['grade'] is None:
            missing_grades.add(p['sp_id'])
        if p['position'] is None:
            missing_positions.add((p['sp_id'], p['grade']))
    authors = {normalize_nickname(r.user_nickname) for r in rows if r.user_nickname}
    author = normalize_nickname(snapshot['author'])
    author_status = 'matched' if author and authors == {author} else 'mismatch' if authors and author not in authors else 'unverified'
    expected_mode = 2 if match_type == 52 else 1
    mode_status = 'matched' if snapshot['mode'] == expected_mode else 'unverified' if snapshot['mode'] is None else 'mismatch'
    allowed = author_status == mode_status == 'matched'
    comparisons, observed, linked, linked_issues = [], set(), 0, set()
    for player in coaching['players']:
        key = player['sp_id'], player['sp_grade'], player['position_name']
        observed.add(key)
        candidates = exact.get(key, [])
        status = 'matched' if len(candidates) == 1 else 'ambiguous' if candidates else None
        if status is None:
            for index, lookup, reason in ((card_grade, key[:2], 'position_mismatch'), (card, key[0], 'grade_mismatch'),
                                         (names, normalize_nickname(player['player_name']), 'card_mismatch')):
                candidates = index.get(lookup, [])
                if candidates:
                    missing = reason == 'position_mismatch' and lookup in missing_positions or reason == 'grade_mismatch' and lookup in missing_grades
                    status = 'identity_missing' if missing else reason
                    break
        status = status or 'not_in_feed'
        settings = candidates[0] if status == 'matched' and allowed else None
        checks = _checks(player, settings, match_type == 52) if settings else []
        if settings:
            linked_issues.update(f['metric'] for f in player['findings'])
        linked += settings is not None
        comparisons.append({'sp_id': key[0], 'sp_grade': key[1], 'sp_position': player['sp_position'],
                            'position_name': key[2], 'player_name': player['player_name'], 'appearances': player['appearances'],
                            'status': status, 'label': MATCH_LABELS[status], 'linked': settings is not None,
                            'candidates': [_brief(p) for p in candidates[:3]], 'settings': settings, 'checks': checks, 'plans': []})
    diagnosis = build_contextual_coaching(snapshot, coaching, rows, comparisons, match_type, history_rows=history_rows)
    team_checks = []
    starters = [p for p in snapshot['players'] if p.get('lineup_role') == 'starter']
    roster_match = allowed and len(starters) == 11 and all(_identity(p) in observed and len(exact[_identity(p)]) == 1 for p in starters)
    return {'status': 'available', 'snapshot': snapshot, 'author_status': author_status, 'mode_status': mode_status,
            'historical_use_verified': False, 'roster_fully_matched': roster_match, 'summary': {'record_count': len(comparisons), 'linked': linked,
            'different': sum(p['status'] not in ('matched', 'not_in_feed') for p in comparisons),
            'not_in_feed': sum(p['status'] == 'not_in_feed' for p in comparisons),
            'withheld': sum(p['status'] == 'matched' and not p['linked'] for p in comparisons)},
            'comparisons': comparisons, 'feed_only_players': [_brief(p) for p in snapshot['players'] if _identity(p) not in observed],
            'team_checks': team_checks, **diagnosis,
            'note': '카드·강화·자리 일치는 선수 기록을 연결하는 기준입니다. 피드는 편집 가능한 저장본이므로 과거 경기에서 이 설정을 사용했는지는 확인되지 않습니다. 누락·미설정은 실제 게임의 미장착을 뜻하지 않습니다.'}
