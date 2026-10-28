from dataclasses import replace
from pathlib import Path
import os
import tempfile
import unittest
from unittest.mock import patch

from app.db import init_db
from app.services.analysis import _player_report_summary, run_analysis
from app.services.coaching_data import recorded_team_goals
from app.services.match_trends import build_match_trends
from app.services.metric_catalog import metric_catalog
from app.services.opponent_comparison import opponent_comparison
from app.services.passing_coaching import extract_pass_breakdown
from app.services.position_coaching import build_position_coaching
from test_metric_comparisons import find
from test_position_coaching import POSITIONS, sample


def played(index, end=0, result='승', success=8, trials=10):
    passing = {f'{prefix}{suffix}': 0 for prefix in ('shortPass', 'longPass', 'bouncingLobPass', 'drivenGroundPass', 'throughPass', 'lobbedThroughPass') for suffix in ('Try', 'Success')}
    passing.update(passTry=trials, passSuccess=success, shortPassTry=trials, shortPassSuccess=success)
    shoot = {'goalTotal': 1, 'goalTotalDisplay': 3 if end == 1 else 1, 'shootTotal': 5, 'effectiveShootTotal': 3, 'ownGoal': 0}
    return replace(sample(pass_try=trials, pass_success=success), match_id=f'match{index:08}',
        match_date=f'2026-10-28T12:{index:02}:00+00:00', match_end_type=end, result=result,
        pass_try=trials, pass_success=success, pass_breakdown=extract_pass_breakdown(passing),
        coaching_data={'shoot': shoot, 'opponent_shoot': {**shoot, 'goalTotal': 0, 'goalTotalDisplay': 3 if end == 2 else 0},
                       'pass': passing, 'opponent_pass': passing})


class PartialMatchTest(unittest.TestCase):
    @patch('app.services.analysis._position_name_map', return_value=POSITIONS)
    @patch('app.services.analysis._season_meta_map', return_value={})
    def test_twenty_player_cards_are_not_truncated_to_eighteen(self, *_):
        rows = [sample(sp_id=10000 + i) for i in range(20)]
        report = _player_report_summary(rows, {10000 + i: f'선수 {i}' for i in range(20)})
        self.assertEqual(report['player_count'], 20)
        self.assertEqual(len(report['players']), 20)

    def test_success_rates_weight_actual_attempts_and_players_include_partial_appearances(self):
        rows = [played(1), played(2, 1, success=4, trials=5), played(3, 2, '패', success=2, trials=5)]
        passing = find(metric_catalog(rows), 'passing:overall')
        self.assertEqual((passing['success'], passing['trials'], passing['matches'], passing['value']), (14, 20, 3, .7))
        players = build_position_coaching(rows, {'players': []}, POSITIONS, include_forfeits=True)
        self.assertEqual(players['sample_count'], 3)
        self.assertEqual(players['players'][0]['appearances'], 3)
        self.assertEqual(players['passing']['overall']['success_rate'], .7)

    def test_forfeit_award_is_not_a_goal_and_actual_opponent_own_goals_are_preserved(self):
        row = played(1, 1)
        self.assertEqual(recorded_team_goals(row), 1)
        self.assertEqual(find(metric_catalog([row]), 'overview:goals_for')['value'], 1)
        self.assertEqual(find(metric_catalog([row]), 'shooting:conversion')['value'], .2)
        row.coaching_data['opponent_shoot']['ownGoal'] = 1
        self.assertEqual(recorded_team_goals(row), 2)
        row.coaching_data['shoot'].pop('goalTotal')
        self.assertIsNone(recorded_team_goals(row))

    def test_four_full_and_seven_partial_games_create_eleven_points_and_all_results(self):
        rows = [played(i, 0 if i < 4 else 1 if i < 9 else 2, '승' if i < 9 else '패') for i in range(11)]
        data = build_match_trends(rows)
        self.assertEqual(data['point_count'], 11)
        self.assertEqual(sum(p['match_end_type'] != 0 for p in data['points']), 7)
        self.assertAlmostEqual(find(data['groups'], 'overview:win_rate')['history'][-1]['value'], 9 / 11, places=6)
        self.assertEqual(data['points'][-1]['match_end_type'], 2)
        self.assertEqual(data['points'][-1]['result'], '패')

    def test_missing_play_records_still_keep_result_and_do_not_create_zero_percentages(self):
        missing = replace(played(2, 1), player_stats=[], pass_breakdown={}, coaching_data={})
        data = build_match_trends([played(1), missing])
        self.assertEqual(data['point_count'], 2)
        self.assertEqual(find(data['groups'], 'overview:win_rate')['history'][-1]['observed_matches'], 2)
        passing = find(data['groups'], 'passing:overall')['history'][-1]
        self.assertEqual((passing['observed_matches'], passing['trials'], passing['value']), (1, 10, .8))
        players = build_position_coaching([played(1), missing], {'players': []}, POSITIONS, include_forfeits=True)
        self.assertEqual(players['players'][0]['appearances'], 1)
        self.assertEqual(players['latest_lineup']['match_id'], played(1).match_id)

    def test_final_trend_and_current_metrics_use_identical_records(self):
        rows = [played(i, i % 3, success=i % 7, trials=10) for i in range(35)]
        trend = build_match_trends(rows)
        current = metric_catalog(rows[-30:])
        for group in current:
            for metric in group['metrics']:
                if metric['value'] is not None:
                    point = find(trend['groups'], metric['id'])['history'][-1]
                    self.assertAlmostEqual(metric['value'], point['value'], places=6, msg=metric['id'])
                    self.assertEqual(metric['matches'], point['observed_matches'])

    def test_partial_opponent_comparisons_require_both_teams_actual_fields(self):
        rows = [played(1), played(2, 1), played(3, 2)]
        rows[-1].coaching_data.pop('opponent_pass')
        metric = next(m for m in opponent_comparison(rows)['metrics'] if m['metric'] == 'pass')
        self.assertEqual(metric['mine']['matches'], 2)
        self.assertEqual((metric['mine']['success'], metric['opponent']['success']), (16, 16))
        self.assertEqual(build_match_trends([replace(played(4), match_end_type=-1)])['point_count'], 0)

    @patch('app.services.ranker_benchmark.get_ranker_benchmark', return_value={'status': 'unavailable'})
    @patch('app.services.analysis._spid_name_map', return_value={12345: '선수'})
    @patch('app.services.analysis._position_name_map', return_value=POSITIONS)
    @patch('app.services.analysis._season_meta_map', return_value={})
    def test_recent_analysis_propagates_partial_records_to_every_current_view(self, *_):
        rows = [played(i, 0 if i < 4 else 1) for i in range(11)]
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'HABIT_LAB_DB_PATH': str(Path(folder) / 'test.db')}), patch('app.services.analysis.load_recent_modes', return_value=(rows[::-1], 0, None, False)):
            init_db()
            result = run_analysis('test-ouid', 0, 30)
        self.assertEqual(result['sample_selection']['normal_count'], 4)
        self.assertEqual(result['coaching']['sample_count'], 11)
        self.assertEqual(result['opponent_comparison']['matches'], 11)
        self.assertEqual(result['match_trends']['point_count'], 11)
        self.assertEqual(find(result['comparison_metrics']['all'], 'passing:overall')['matches'], 11)
