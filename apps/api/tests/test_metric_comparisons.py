from dataclasses import replace
import unittest

from app.services.match_trends import build_match_trends
from app.services.metric_catalog import metric_catalog
from app.services.ranker_benchmark import aggregate_rankers
from test_position_coaching import sample


def row(index, made=5, tried=10, end=0, mode=50):
    return replace(sample(), match_id=f'match{index:08}', match_date=f'2026-10-01T00:{index:02}:00Z', match_end_type=end,
                   match_type=mode, coaching_data={'shoot': {'effectiveShootTotal': made, 'shootTotal': tried,
                      'goalTotal': 1, 'goalTotalDisplay': 1}, 'detail': {'possession': 50}},
                   result='승' if index % 2 else '패')


def find(groups, key):
    return next(metric for group in groups for metric in group['metrics'] if metric['id'] == key)


class MetricComparisonTest(unittest.TestCase):
    def test_ranker_average_weights_each_person_equally(self):
        result = aggregate_rankers([({'rank_no': 1, 'nickname': 'a'}, [row(1, 9)]),
                                    ({'rank_no': 2, 'nickname': 'b'}, [row(i, 1) for i in range(2, 11)])], 2)
        metric = find(result['groups'], 'shooting:on_target')
        self.assertEqual(result['ranker_count'], 2)
        self.assertAlmostEqual(metric['value'], .5)
        self.assertEqual(metric['ranker_count'], 2)
        self.assertEqual(metric['matches'], 10)
        self.assertAlmostEqual(metric['q1'], .3)
        self.assertAlmostEqual(metric['q3'], .7)
        self.assertAlmostEqual(metric['spread'], .4)

    def test_forfeits_use_actual_records_and_zero_attempts_do_not_become_zero_rates(self):
        result = aggregate_rankers([({'rank_no': 1, 'nickname': 'a'}, [row(1, 0, 0)]),
                                    ({'rank_no': 2, 'nickname': 'b'}, [row(2, 9, end=1)]),
                                    ({'rank_no': 3, 'nickname': 'c'}, [row(3, 4)])], 3)
        metric = find(result['groups'], 'shooting:on_target')
        self.assertEqual(metric['ranker_count'], 2)
        self.assertEqual(metric['value'], .65)
        self.assertEqual(result['ranker_count'], 3)
        self.assertEqual(aggregate_rankers([], 20)['status'], 'unavailable')

    def test_each_ranker_uses_latest_thirty_recorded_matches(self):
        rows = [row(i, 1 if i <= 5 else 8) for i in range(1, 36)]
        result = aggregate_rankers([({'rank_no': 1, 'nickname': 'a'}, rows)], 1)
        self.assertEqual(result['record_count'], 30)
        self.assertEqual(find(result['groups'], 'shooting:on_target')['value'], .8)

    def test_rolling_rate_uses_success_and_trials_instead_of_mean_percentages(self):
        data = build_match_trends([row(1, 1, 1), row(2, 0, 9)], points=30)
        metric = find(data['groups'], 'shooting:on_target')
        self.assertEqual([point['value'] for point in metric['history']], [1, .1])
        self.assertEqual([point['trials'] for point in metric['history']], [1, 10])
        self.assertEqual([point['window_matches'] for point in data['points']], [1, 2])
        self.assertEqual(len(metric['history']), len(data['points']))

    def test_rolling_thirty_has_no_future_leakage_and_displays_only_last_thirty_points(self):
        rows = [row(i, 1 if i < 20 else 9) for i in range(1, 51)]
        data = build_match_trends(rows)
        metric = find(data['groups'], 'shooting:on_target')
        self.assertEqual(data['point_count'], 30)
        self.assertEqual(data['points'][0]['date'], rows[20].match_date)
        self.assertEqual(data['points'][-1]['window_matches'], 30)
        self.assertAlmostEqual(metric['history'][-1]['value'], .9)
        prefix = build_match_trends(rows[:21])
        self.assertEqual(metric['history'][0]['value'], find(prefix['groups'], 'shooting:on_target')['history'][-1]['value'])

    def test_trends_keep_missing_values_and_include_forfeit_games(self):
        data = build_match_trends([row(1, 0, 0), row(2, 10, end=1), row(3, 8)])
        metric = find(data['groups'], 'shooting:on_target')
        self.assertEqual(data['point_count'], 3)
        self.assertIsNone(metric['history'][0]['value'])
        self.assertEqual(metric['history'][1]['value'], 1)
        self.assertEqual(metric['history'][2]['value'], .9)
        self.assertEqual(build_match_trends([])['point_count'], 0)

    def test_catalog_uses_the_same_units_as_the_screen(self):
        groups = metric_catalog([row(1)])
        self.assertEqual([group['id'] for group in groups], ['overview', 'passing', 'shooting', 'defending', 'carrying', 'discipline'])
        self.assertEqual(find(groups, 'overview:possession')['value'], .5)
        self.assertEqual(find(groups, 'overview:goals_for')['value'], 1)
        self.assertEqual(find(groups, 'defending:late_conceded')['direction'], 'neutral')
        self.assertIsNone(find(groups, 'defending:late_conceded')['attempts_per_match'])

    def test_latest_trend_value_matches_the_same_thirty_match_aggregate(self):
        rows = [replace(row(i), coaching_data={'shoot': {'goalTotalDisplay': i % 7},
                         'detail': {'possession': 40 + i % 11, 'dribble': 180.173 + i * .33}})
                for i in range(1, 41)]
        data = build_match_trends(rows)
        catalog = {metric['id']: metric['value'] for group in metric_catalog(rows[-30:]) for metric in group['metrics']}
        for group in data['groups']:
            for metric in group['metrics']:
                self.assertAlmostEqual(metric['history'][-1]['value'], catalog[metric['id']], places=6)

    def test_pass_remainder_and_usage_keep_the_matched_denominator(self):
        breakdown = {key:{'trials':0,'success':0} for key in ('overall','short','long','bouncing_lob','driven_ground','through','lobbed_through')}
        for key, tries, good in (('overall',100,80),('short',60,50),('long',10,7),('driven_ground',10,8),('through',10,8)):
            breakdown[key] = {'trials':tries,'success':good}
        groups = metric_catalog([replace(row(i),pass_breakdown=breakdown) for i in range(1,6)])
        remaining = find(groups,'passing:unclassified:success')
        self.assertEqual(remaining['value'], .7)
        self.assertEqual(remaining['usage_share'], .1)
        self.assertEqual(remaining['trials'], 50)
        self.assertEqual(remaining['direction'], 'neutral')
        self.assertEqual(find(groups,'passing:short:success')['usage_share'], .6)

    def test_shot_region_share_requires_matching_observed_games(self):
        payload = {'shoot':{'shootInPenalty':8,'goalInPenalty':4,'shootOutPenalty':2,'goalOutPenalty':0}}
        rows = [replace(row(i),coaching_data=payload) for i in range(1,6)]
        groups = metric_catalog(rows)
        self.assertEqual(find(groups,'shooting:box_inside')['usage_share'], .8)
        self.assertEqual(find(groups,'shooting:box_outside')['usage_share'], .2)
        self.assertEqual(find(groups,'shooting:box_inside')['attempts_per_match'], 8)
        rows[0] = replace(rows[0],coaching_data={'shoot':{'shootInPenalty':8,'goalInPenalty':4}})
        self.assertIsNone(find(metric_catalog(rows),'shooting:box_inside')['usage_share'])

    def test_ranker_shot_usage_share_is_an_equal_person_mean(self):
        def shots(i, inside, outside):
            return replace(row(i),coaching_data={'shoot':{'shootInPenalty':inside,'goalInPenalty':1,'shootOutPenalty':outside,'goalOutPenalty':0}})
        result = aggregate_rankers([({'rank_no':1,'nickname':'a'},[shots(1,8,2)]),
                                    ({'rank_no':2,'nickname':'b'},[shots(i,2,8) for i in range(2,12)])],2)
        self.assertAlmostEqual(find(result['groups'],'shooting:box_inside')['usage_share'],.5)
