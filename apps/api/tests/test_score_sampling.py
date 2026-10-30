from dataclasses import replace
import unittest

from app.services.domain_scores import build_domain_scores
from app.services.metric_catalog import metric_catalog
from app.services.ranker_benchmark import aggregate_rankers
from app.services.score_sampling import PROFILE_VERSION, score_metric_groups
from test_position_coaching import sample


def row(i, end=0):
    return replace(sample(), match_id=f'match{i:08}', match_date=f'2026-10-01T00:{i:02}:00Z', match_type=50,
        match_end_type=end, coaching_data={
            'shoot': {'effectiveShootTotal': 8 if end == 0 else 2, 'shootTotal': 10 if end == 0 else 2, 'goalTotal': 3},
            'opponent_shoot': {'shootTotal': 8 if end == 0 else 0, 'goalTotal': 2 if end == 0 else 0},
            'detail': {'offsideCount': 1 if end == 0 else 0, 'foul': 2 if end == 0 else 0}})


def find(groups, key):
    return next(m for g in groups for m in g['metrics'] if m['id'] == key)


class ScoreSamplingTest(unittest.TestCase):
    def test_short_forfeits_do_not_raise_count_scores_but_rates_keep_observed_attempts(self):
        completed = [row(i) for i in range(10)]
        rows = completed + [row(i, 1) for i in range(10, 30)]
        raw = metric_catalog(rows)
        sampled = score_metric_groups(rows, raw)
        self.assertAlmostEqual(find(raw, 'defending:shots_against')['value'], 80 / 30, places=5)
        self.assertEqual(find(sampled, 'defending:shots_against')['value'], 8)
        self.assertEqual(find(sampled, 'defending:shots_against')['matches'], 10)
        self.assertEqual(find(sampled, 'discipline:foul')['value'], 2)
        self.assertEqual(find(sampled, 'shooting:on_target'), find(raw, 'shooting:on_target'))
        self.assertEqual(find(sampled, 'shooting:on_target')['trials'], 140)
        baseline = score_metric_groups(completed, metric_catalog(completed))
        for key in ('defending:shots_against', 'defending:goals_against', 'discipline:foul', 'discipline:offside'):
            self.assertEqual(find(baseline, key)['value'], find(sampled, key)['value'])

    def test_goal_production_uses_only_observed_completed_match_goals(self):
        rows = [row(i) for i in range(10)] + [row(i, 1) for i in range(10, 30)]
        rows[-1] = replace(rows[-1], coaching_data={'shoot': {'goalTotal': 30}})
        sampled = score_metric_groups(rows, metric_catalog(rows))
        goals = find(sampled, 'shooting:display_goals')
        self.assertEqual(goals['value'], 3)
        self.assertEqual(goals['matches'], 10)
        self.assertEqual(goals['record_scope'], 'completed_only')
        missing = [replace(row(i), coaching_data={}) for i in range(6)]
        self.assertIsNone(find(score_metric_groups(missing, metric_catalog(missing)), 'shooting:display_goals')['value'])

    def test_ranker_count_distribution_uses_the_same_completed_match_rule(self):
        rows = [row(i) for i in range(10)] + [row(i, 1) for i in range(10, 30)]
        data = aggregate_rankers([({'rank_no': 1, 'nickname': 'ranker'}, rows)], 1)
        self.assertEqual(data['score_profile_version'], PROFILE_VERSION)
        self.assertEqual(data['score_profiles'][0]['defending:shots_against'], 8)
        self.assertAlmostEqual(find(data['groups'], 'defending:shots_against')['value'], 80 / 30, places=5)

    def test_missing_completed_records_are_not_invented_zeroes(self):
        rows = [row(i, 1) for i in range(10)]
        sampled = score_metric_groups(rows, metric_catalog(rows))
        self.assertIsNone(find(sampled, 'discipline:foul')['value'])
        self.assertEqual(find(sampled, 'discipline:foul')['matches'], 0)
        rows = [replace(row(1), coaching_data={'detail': {}, 'opponent_shoot': {}})]
        self.assertIsNone(find(score_metric_groups(rows, metric_catalog(rows)), 'defending:goals_against')['value'])

    def test_genuine_zero_counts_are_kept_and_input_records_are_unchanged(self):
        rows = [replace(row(i), coaching_data={'detail': {'foul': 0}, 'opponent_shoot': {'shootTotal': 0, 'goalTotal': 0}}) for i in range(6)]
        raw = metric_catalog(rows)
        original_label = find(raw, 'discipline:foul')['label']
        sampled = score_metric_groups(rows, raw)
        self.assertEqual(find(sampled, 'discipline:foul')['value'], 0)
        self.assertEqual(find(sampled, 'discipline:foul')['matches'], 6)
        self.assertEqual(find(raw, 'discipline:foul')['label'], original_label)

    def test_previous_score_distribution_is_not_used_for_new_scope(self):
        rows = [row(i) for i in range(10)]
        groups = score_metric_groups(rows, metric_catalog(rows))
        result = build_domain_scores(groups, {'score_profiles': [{'defending:shots_against': 8}] * 5}, scope={'count_basis': 'completed_only'})
        self.assertTrue(all(a['mine'] is None for a in result['areas']))
