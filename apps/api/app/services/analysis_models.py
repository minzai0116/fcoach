from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class MatchStats:
    match_date: str
    result: str
    opponent_nickname: str
    goals_for: float
    goals_against: float
    shots: float
    shots_on_target: float
    offside: float
    xg_for: float
    xg_against: float
    late_goals_against: float
    in_box_shots: float
    total_shots_detail: float
    possession: float
    pass_try: float
    pass_success: float
    through_pass_try: float
    through_pass_success: float
    tackle_try: float
    tackle_success: float
    shots_for_points: list[dict[str, float | bool]]
    goals_for_minutes: list[float]
    goals_against_minutes: list[float]
    goals_for_types: list[int]
    shots_on_target_against: float = 0.0
    goals_heading: float = 0.0
    goals_freekick: float = 0.0
    goals_penaltykick: float = 0.0
    goals_in_penalty: float = 0.0
    goals_out_penalty: float = 0.0
    controller: str = ""
    player_stats: list[dict[str, float | int]] = field(default_factory=list)
