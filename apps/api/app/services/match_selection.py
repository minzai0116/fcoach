from __future__ import annotations

from app.services.analysis_models import MatchStats


def eligible_match_rows(rows: list[MatchStats], include_forfeit_wins: bool = False,
                        include_forfeit_losses: bool = False) -> list[MatchStats]:
    allowed = {0} | ({1} if include_forfeit_wins else set()) | ({2} if include_forfeit_losses else set())
    return [row for row in rows if row.match_end_type in allowed]


def select_match_sample(rows: list[MatchStats], window: int | None, *, include_forfeit_wins: bool = False,
                        include_forfeit_losses: bool = False, start_match_id: str | None = None,
                        end_match_id: str | None = None) -> tuple[list[MatchStats], dict]:
    indices = {row.match_id: i for i, row in enumerate(rows)}
    for match_id, label in ((start_match_id, '시작'), (end_match_id, '종료')):
        if match_id and match_id not in indices:
            raise ValueError(f'선택한 {label} 경기를 조회할 수 없습니다. 경기 목록을 다시 불러와 선택해주세요.')
    start = indices[start_match_id] if start_match_id else len(rows) - 1
    end = indices[end_match_id] if end_match_id else 0
    if rows and end > start:
        raise ValueError('종료 경기는 시작 경기와 같거나 이후 경기여야 합니다.')
    # 최신순 목록의 양 끝 경기를 포함한 뒤 종료 유형을 적용한다.
    candidates = rows[end:start + 1]
    eligible = eligible_match_rows(candidates, include_forfeit_wins, include_forfeit_losses)
    selected = eligible if window is None else eligible[:window]
    counts = {code: sum(row.match_end_type == code for row in selected) for code in (0, 1, 2)}
    return selected, {'include_forfeit_wins': include_forfeit_wins, 'include_forfeit_losses': include_forfeit_losses,
                      'start_match_id': start_match_id, 'start_match_date': rows[start].match_date if rows else None,
                      'end_match_id': end_match_id, 'end_match_date': rows[end].match_date if rows else None,
                      'direction': 'range', 'available_count': len(candidates), 'eligible_count': len(eligible),
                      'normal_count': counts[0], 'forfeit_win_count': counts[1], 'forfeit_loss_count': counts[2]}
