from dataclasses import replace
import unittest

from app.models import AnalysisRunRequest
from app.services.analysis_errors import MatchSyncWarning
from app.services.match_selection import select_match_sample
from app.services.recent_analysis import load_recent_modes, mode_history, opponent_comparison
from test_position_coaching import sample


def row(index, mode=60, mine=9, opponent=3):
    return replace(sample(), match_id=f'match{index:08}', match_date=f'2026-10-{index:02}T00:00:00Z', match_type=mode,
                   coaching_data={'shoot': {'effectiveShootTotal': mine, 'shootTotal': 10, 'goalTotal': 2},
                                  'opponent_shoot': {'effectiveShootTotal': opponent, 'shootTotal': 10, 'goalTotal': 2}})


class RecentModesTest(unittest.TestCase):
    def test_merge_sorts_both_modes_before_selecting_latest_thirty(self):
        def load(**kw):
            mode = kw['match_type']
            return [row(i, mode) for i in range(1 if mode == 50 else 2, 32, 2)], 0, None, True
        rows, count, warning, refreshed = load_recent_modes('private-user', load)
        selected, _ = select_match_sample(rows, 30)
        self.assertEqual(len(selected), 30)
        self.assertEqual([r.match_date for r in selected], sorted([r.match_date for r in selected], reverse=True))
        self.assertEqual(sum(r.match_type == 50 for r in selected), 15)
        self.assertEqual(sum(r.match_type == 60 for r in selected), 15)
        self.assertIsNone(warning)
        self.assertTrue(refreshed)

    def test_combined_request_cannot_be_changed_to_a_range_or_other_window(self):
        request = AnalysisRunRequest(ouid='private-user', match_type=0, window=5, start_match_id='match00001')
        self.assertEqual(request.window, 30)
        self.assertIsNone(request.start_match_id)
        self.assertIsNone(request.end_match_id)

    def test_unavailable_mode_keeps_warning_and_does_not_become_zero_usage(self):
        def load(**kw):
            return ([row(3, 60)], 0, None, False) if kw['match_type'] == 60 else ([], 0, MatchSyncWarning('일시 조회 실패'), True)
        rows, _, warning, _ = load_recent_modes('private-user', load)
        self.assertEqual(len(rows), 1)
        self.assertIsInstance(warning, MatchSyncWarning)
        self.assertIn('공식경기', warning)

    def test_history_does_not_compare_official_with_friendly(self):
        current = [row(i, 50, mine=1) for i in range(21, 26)]
        different_mode_history = [row(i, 60, mine=10) for i in range(1, 11)]
        result = mode_history(current, current + different_mode_history)
        self.assertEqual(result['actions'], [])
        self.assertTrue(all(c['status'] == 'unavailable' for c in result['comparisons'].values()))

    def test_direct_comparison_uses_paired_valid_normal_matches(self):
        valid = [row(i) for i in range(1, 11)]
        invalid = replace(row(11), coaching_data={'shoot': {'effectiveShootTotal': 10, 'shootTotal': 10}})
        forfeit = replace(row(12, mine=0, opponent=10), match_end_type=1)
        result = opponent_comparison(valid + [invalid, forfeit])['metrics'][0]
        self.assertEqual(result['mine']['matches'], 10)
        self.assertEqual(result['mine']['success'], 90)
        self.assertEqual(result['opponent']['success'], 30)
        self.assertEqual(result['status'], 'higher')
        self.assertEqual(result['gap_pp'], 60)

    def test_close_or_missing_comparisons_never_become_weaknesses(self):
        equal = opponent_comparison([row(i, mine=5, opponent=5) for i in range(1, 11)])['metrics']
        self.assertEqual(equal[0]['status'], 'no_clear_change')
        self.assertTrue(all(metric['status'] != 'lower' for metric in equal))
        self.assertTrue(all(metric['status'] == 'unavailable' for metric in opponent_comparison([])['metrics']))
