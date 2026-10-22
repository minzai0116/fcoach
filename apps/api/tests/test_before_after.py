from dataclasses import replace
import unittest

from app.services.before_after import compare_match_groups
from test_passing_coaching import passing_row


def match(mid, *, short=(10, 8), goals=2, end=0, possession=40, date='2026-10-20T00:00:00Z'):
    return replace(passing_row(short=short), match_id=mid, match_date=date, match_end_type=end,
                   coaching_data={'shoot': {'shootTotal': 10, 'effectiveShootTotal': 6, 'goalTotal': goals, 'goalTotalDisplay': goals},
                                  'opponent_shoot': {'goalTotal': 1, 'shootTotal': 5}, 'detail': {'possession': possession}})


class BeforeAfterTest(unittest.TestCase):
    def test_unequal_group_sizes_compare_per_match_not_totals(self):
        rows = [match(f'pre{i:05}') for i in range(2)] + [match(f'post{i:04}') for i in range(4)]
        result = compare_match_groups(rows, [r.match_id for r in rows[:2]], [r.match_id for r in rows[2:]])
        goals = next(m for m in result['metrics'] if m['metric'] == 'display_goals')
        self.assertEqual(goals['before']['value'], 2)
        self.assertEqual(goals['after']['value'], 2)
        self.assertEqual(goals['delta'], 0)
        self.assertEqual((result['before']['matches'], result['after']['matches']), (2, 4))

    def test_success_rate_uses_summed_attempts_and_no_arbitrary_target(self):
        rows = [match('prematch1', short=(10, 10)), match('prematch2', short=(100, 0)), match('postmatc1', short=(20, 10))]
        result = compare_match_groups(rows, ['prematch1', 'prematch2'], ['postmatc1'])
        passing = next(m for m in result['metrics'] if m['metric'] == 'pass_short')
        self.assertAlmostEqual(passing['before']['value'], 10 / 110, places=4)
        self.assertEqual(passing['after']['value'], .5)
        self.assertEqual(passing['status'], 'improved')
        self.assertNotIn('target', passing)

    def test_zero_attempts_are_unavailable_not_zero_percent(self):
        rows = [match('prematch1', short=(0, 0)), match('postmatc1', short=(20, 10))]
        result = compare_match_groups(rows, ['prematch1'], ['postmatc1'])
        passing = next(m for m in result['metrics'] if m['metric'] == 'pass_short')
        self.assertIsNone(passing['before']['value'])
        self.assertIsNone(passing['delta'])
        self.assertEqual(passing['status'], 'unavailable')

    def test_forfeits_are_filtered_explicitly_and_optionally_included(self):
        rows = [match('prematch1'), match('prematch2', end=1, goals=9), match('postmatc1')]
        result = compare_match_groups(rows, ['prematch1', 'prematch2'], ['postmatc1'])
        self.assertEqual(result['before']['matches'], 1)
        self.assertEqual(result['before']['excluded_count'], 1)
        result = compare_match_groups(rows, ['prematch1', 'prematch2'], ['postmatc1'], include_forfeit_wins=True)
        self.assertEqual(result['before']['matches'], 2)
        goals = next(m for m in result['metrics'] if m['metric'] == 'display_goals')
        self.assertEqual(goals['before']['value'], 5.5)

    def test_context_metrics_are_not_automatically_good_when_higher(self):
        rows = [match('prematch1', possession=40), match('postmatc1', possession=65)]
        result = compare_match_groups(rows, ['prematch1'], ['postmatc1'])
        metric = next(m for m in result['metrics'] if m['metric'] == 'possession')
        self.assertEqual(metric['status'], 'context')
        self.assertIsNone(metric['higher_is_better'])

    def test_invalid_groups_never_fall_back_to_other_games(self):
        rows = [match('prematch1'), match('postmatc1')]
        for before, after in [([], ['postmatc1']), (['prematch1'], ['prematch1']),
                              (['prematch1', 'prematch1'], ['postmatc1']), (['unknown1'], ['postmatc1'])]:
            with self.subTest(before=before, after=after), self.assertRaises(ValueError):
                compare_match_groups(rows, before, after)

    def test_request_validates_each_id_and_group_size(self):
        from app.models import BeforeAfterRequest
        from pydantic import ValidationError
        for value in ('../secrets', 'a' * 129):
            with self.assertRaises(ValidationError):
                BeforeAfterRequest(ouid='test-ouid', match_type=60, before_match_ids=[value], after_match_ids=['validmid'])


if __name__ == '__main__':
    unittest.main()
