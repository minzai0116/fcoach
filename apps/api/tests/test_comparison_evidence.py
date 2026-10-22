from dataclasses import replace
import unittest
from unittest.mock import patch

from app.services.comparison_evidence import compare_rates, previous_matches, rate_sample
from app.services.position_coaching import build_position_coaching
from app.services.passing_coaching import build_passing_coaching
from app.services.team_history_coaching import build_team_history_coaching
from test_position_coaching import sample, POSITIONS
from test_passing_coaching import passing_row
import test_position_coaching as fixtures


def dated(row, date='2026-10-05T00:00:00Z', **kw):
    return replace(row, match_date=date, **kw)


class HistoricalEvidenceTest(unittest.TestCase):
    def test_history_precedes_entire_selection_and_excludes_forfeits_and_same_ids(self):
        current = [dated(sample(), '2026-10-06T00:00:00Z', match_id='selected'), dated(sample(), '2026-10-07T00:00:00Z')]
        old = dated(sample(), match_id='old')
        candidates = [old, dated(sample(), match_id='selected'), dated(sample(), match_end_type=1),
                      dated(sample(), '2026-10-06T12:00:00Z'), dated(sample(), 'invalid'), *current]
        self.assertEqual(previous_matches(candidates, current), [old])
        self.assertEqual(previous_matches(candidates, [dated(sample(), '')]), [])
        self.assertEqual(previous_matches(candidates, [*current, dated(sample(), 'invalid')]), [])
        self.assertEqual(previous_matches([dated(sample(), '2026-10-06T09:00:00+09:00')], current), [])

    def test_no_reference_never_becomes_an_arbitrary_threshold(self):
        report = build_position_coaching([sample()] * 5, {'players': []}, POSITIONS)
        self.assertEqual(report['players'][0]['findings'], [])
        self.assertTrue(all(m['reference'] is None for m in report['players'][0]['measurements']))
        team = build_team_history_coaching([sample()] * 5, [], 60)
        self.assertEqual(team['benchmark'], {})
        self.assertEqual(team['issues'], {})
        self.assertEqual(team['actions'], [])
        self.assertEqual(build_passing_coaching([passing_row(long=(100, 1))] * 5, 60)['priorities'], [])

    def test_low_unchanged_or_uncertain_rates_are_not_problems(self):
        low = rate_sample(10, 100, 5, [])
        self.assertEqual(compare_rates(low, low, 10)['status'], 'no_clear_change')
        self.assertEqual(compare_rates(rate_sample(4, 12, 5, []), rate_sample(16, 40, 5, []), 10)['status'], 'no_clear_change')
        self.assertEqual(compare_rates(rate_sample(0, 0, 10, []), low, 10)['status'], 'unavailable')
        self.assertEqual(compare_rates(rate_sample(0, 100, 4, []), low, 10)['status'], 'unavailable')

    def test_real_decline_requires_same_card_grade_position_and_older_normal_matches(self):
        now = [sample(pass_try=100, pass_success=40)] * 5
        past = [dated(sample(pass_try=100, pass_success=95))] * 5
        def coach(history):
            return build_position_coaching(now, {'players': []}, POSITIONS, history_rows=history)['players'][0]
        finding = next(f for f in coach(past)['findings'] if f['metric'] == 'pass')
        self.assertEqual(finding['reference'], .95)
        self.assertEqual(finding['target'], .95)
        self.assertEqual(finding['comparison']['previous']['trials'], 500)
        for changed in ('sp_id', 'sp_grade', 'sp_position'):
            row = dated(sample(pass_try=100, pass_success=95, **{changed: 9}))
            self.assertEqual(coach([row] * 5)['findings'], [])
        for history in (now, [dated(sample(pass_try=100, pass_success=95), match_end_type=1)] * 5):
            self.assertEqual(coach(history)['findings'], [])

    def test_invalid_counts_are_not_zero_successes(self):
        for invalid in (None, float('nan'), -1, True):
            report = build_position_coaching([sample(pass_success=invalid)] * 5, {'players': []}, POSITIONS)
            measured = next(m for m in report['players'][0]['measurements'] if m['metric'] == 'pass')
            self.assertIsNone(measured['value'])

    def test_team_uses_observed_raw_counts_and_keeps_actual_comparison(self):
        now = [replace(sample(), coaching_data={'defence': {'tackleSuccess': 1, 'tackleTry': 20}})] * 5
        past = [dated(replace(sample(), coaching_data={'defence': {'tackleSuccess': 19, 'tackleTry': 20}}))] * 5
        result = build_team_history_coaching(now, past, 60)
        self.assertEqual(result['benchmark'], {'tackle_success_rate': .95})
        self.assertEqual(len(result['actions']), 1)
        self.assertEqual(result['actions'][0]['tactic_delta'], {})
        self.assertEqual(result['actions'][0]['evidence']['comparison']['previous']['success'], 95)
        self.assertEqual(build_team_history_coaching(now, now, 60)['actions'], [])
        self.assertEqual(build_team_history_coaching([replace(row, match_end_type=1) for row in now], past, 60)['actions'], [])
        manager = build_team_history_coaching(now, past, 52)['actions'][0]
        self.assertIn('직접 조작을 교정하지 않습니다', manager['tactic_direction'])


class HistoricalPersistenceTest(unittest.TestCase):
    setUp = fixtures.CoachingPersistenceTest.setUp
    tearDown = fixtures.CoachingPersistenceTest.tearDown

    @patch('app.services.analysis._spid_name_map', return_value={})
    @patch('app.services.analysis._position_name_map', return_value=POSITIONS)
    @patch('app.services.analysis._season_meta_map', return_value={})
    @patch('app.services.analysis._load_official_rankers', return_value=[])
    @patch('app.services.analysis._load_rows_for_analysis', return_value=([sample()] * 5, 0, None, False))
    def test_run_never_calls_static_benchmark_or_manual_issue_rules(self, *mocks):
        from app.services.analysis import get_latest_analysis, get_latest_actions, run_analysis
        from app.db import connect
        with patch('app.services.analysis._resolve_benchmark', side_effect=AssertionError('static fallback')), \
             patch('app.services.analysis._issue_scores', side_effect=AssertionError('manual threshold')):
            result = run_analysis('test-ouid', 60, 5)
        self.assertEqual(result['actions'], [])
        self.assertEqual(result['benchmark'], {})
        self.assertEqual(get_latest_actions('test-ouid', 60, 5), [])
        conn = connect()
        try:
            conn.execute("UPDATE user_metrics_snapshot SET analysis_json = ?", ('{"benchmark":{"tackle_success_rate":0.4},"actions":[{"title":"old"}]}',))
            conn.commit()
        finally:
            conn.close()
        latest = get_latest_analysis('test-ouid', 60, 5)
        self.assertEqual(latest['benchmark'], {})
        self.assertIsNone(latest['coaching'])
        self.assertEqual(get_latest_actions('test-ouid', 60, 5), [])

    def test_ranker_metadata_alone_never_becomes_a_play_style_comparison(self):
        from app.services.analysis import _similar_rankers
        result = _similar_rankers({'win_rate': .5}, official_rankers=[
            {'rank_no': 1, 'ouid': 'ranker-user', 'nickname': '랭커', 'win_rate': .5}], ranker_profiles=[])
        self.assertEqual(result, [])
