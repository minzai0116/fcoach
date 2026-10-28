import unittest
from statistics import mean
from app.services.metric_catalog import NEUTRAL
from app.services.domain_scores import AREAS, build_domain_scores, distribution_scores, score_inputs


def groups():
    return [{'id': area, 'metrics': [
        {'id': key, 'label': key, 'value': 2 if any(word in key for word in ('against', 'foul', 'offside')) else .6,
         'direction': 'neutral' if key.split(':')[-1] in NEUTRAL else 'lower' if any(word in key for word in ('against', 'foul', 'offside')) else 'higher',
         'unit': 'average' if any(word in key for word in ('against', 'foul', 'offside')) else 'rate',
         'matches': 30, 'trials': 100} for key in keys]} for area, _, keys in AREAS]


def benchmark(data, factors=(.6, .8, 1, 1.2, 1.4)):
    own = score_inputs(data)
    return {'score_profiles': [{key: value * factor for key, value in own.items()} for factor in factors]}


class DomainScoreTest(unittest.TestCase):
    def test_target_uses_observed_upper_decile_and_mean_is_not_fixed(self):
        own, peers, target, spread = distribution_scores(3, [1, 2, 3, 4, 5])
        self.assertEqual(target, 4.6)
        self.assertAlmostEqual(own, 100 - 10 * (4.6 - 3) / spread)
        self.assertEqual(peers[-1], 100)
        self.assertNotEqual(round(mean(peers), 6), 90)
        self.assertGreater(len(set(peers)), 3)
        skewed = distribution_scores(3, [1, 2, 3, 4, 50])[1]
        self.assertNotAlmostEqual(mean(peers), mean(skewed), places=1)

    def test_lower_metrics_reverse_direction_and_scores_are_bounded(self):
        self.assertGreater(distribution_scores(1, [1, 2, 3, 4, 5], 'lower')[0], distribution_scores(4, [1, 2, 3, 4, 5], 'lower')[0])
        self.assertEqual(distribution_scores(-100, [1, 2, 3, 4, 5])[0], 1)
        self.assertEqual(distribution_scores(100, [1, 2, 3, 4, 5])[0], 100)
        self.assertEqual(distribution_scores(0, [0] * 5)[0], 100)

    def test_actual_distribution_width_changes_same_raw_gap(self):
        data = groups()
        wide, narrow = benchmark(data), benchmark(data, (.96, .98, 1, 1.02, 1.04))
        data[0]['metrics'][0]['value'] = .5
        wide_result, narrow_result = build_domain_scores(data, wide), build_domain_scores(data, narrow)
        self.assertLess(narrow_result['areas'][1]['mine'], wide_result['areas'][1]['mine'] - 20)

    def test_missing_data_is_not_zero_or_overall_score(self):
        data = groups()
        self.assertTrue(all(area['mine'] is None for area in build_domain_scores(data, {})['areas']))
        own = score_inputs(data)
        data[0]['metrics'][0]['value'] = None
        result = build_domain_scores(data, {'score_profiles': [own] * 5})
        self.assertIsNone(result['areas'][0]['mine'])
        self.assertIsNone(result['areas'][1]['mine'])
        self.assertEqual(result['areas'][2]['mine'], 100)

    def test_zero_spread_does_not_create_invented_gap_scale(self):
        data = groups()
        peers = {'score_profiles': [score_inputs(data)] * 5}
        data[0]['metrics'][0]['value'] = .9
        result = build_domain_scores(data, peers)
        self.assertIsNone(result['areas'][1]['mine'])
        self.assertIsNone(result['areas'][0]['mine'])
        self.assertEqual(distribution_scores(0, [-1e-16, 0, 1e-16])[0], 100)
        self.assertIsNone(distribution_scores(1, [-1e-16, 0, 1e-16])[0])

    def test_only_same_metrics_and_eligible_people_compared(self):
        data = groups()
        own = score_inputs(data)
        profiles = [own] * 4 + [{key: value for key, value in own.items() if key != 'passing:overall'}]
        self.assertIsNone(build_domain_scores(data, {'score_profiles': profiles})['areas'][1]['reference'])
        data[0]['metrics'][0]['trials'] = 1
        self.assertNotIn('passing:overall', score_inputs(data))
        self.assertNotIn('overview:win_rate', own)

    def test_area_score_is_reconciled_with_detail_scores_and_impacts(self):
        data = groups()
        peers = benchmark(data)
        data[1]['metrics'][0]['value'] = .4
        result = build_domain_scores(data, peers)
        for area in result['areas'][1:]:
            active = [m for m in area['metrics'] if m['weight'] > 0]
            self.assertEqual(area['mine'], round(sum(m['score'] * m['weight'] for m in active), 1))
            self.assertEqual(area['reference'], round(sum(m['reference_score'] * m['weight'] for m in active), 1))
            self.assertAlmostEqual(sum(m['point_impact'] for m in area['metrics']), area['mine'] - area['reference'], delta=.11)
        self.assertEqual(result['areas'][0]['mine'], round(mean(a['mine'] for a in result['areas'][1:]), 1))

    def test_only_actual_out_of_range_records_get_improvement_advice(self):
        data = groups()
        peers = benchmark(data)
        self.assertFalse(any(a['kind'] == 'improve' for a in build_domain_scores(data, peers)['areas'][1]['advice']))
        data[0]['metrics'][0]['value'] = .3
        advice = build_domain_scores(data, peers)['areas'][1]['advice']
        self.assertEqual(advice[0]['kind'], 'improve')
        self.assertEqual(advice[0]['metric_id'], 'passing:overall')
        self.assertIn('패스', advice[0]['play'])

    def test_offside_advice_targets_run_timing_rather_than_tackling(self):
        data = groups()
        peers = benchmark(data)
        data[-1]['metrics'][1]['value'] = 4
        advice = build_domain_scores(data, peers)['areas'][-1]['advice'][0]
        self.assertEqual(advice['metric_id'], 'discipline:offside')
        self.assertIn('패스', advice['play'])
        self.assertNotIn('태클', advice['play'])

    def test_distinct_foul_and_offside_actions_are_not_deduplicated_together(self):
        data = groups()
        peers = benchmark(data)
        for metric in data[-1]['metrics']:
            metric['value'] = 4
        advice = build_domain_scores(data, peers)['areas'][-1]['advice']
        self.assertEqual({a['metric_id'] for a in advice}, {'discipline:foul', 'discipline:offside'})


def extra(key, value, usage=None, trials=100, direction='higher', unit='rate'):
    return {'id':key,'label':key,'value':value,'matches':30,'trials':trials,'success':value * trials,
            'direction':direction,'unit':unit,'usage_share':usage,'attempts_per_match':trials / 30}


class WeightedScoreTest(unittest.TestCase):
    def passing(self):
        source = [{'id':'passing','metrics':[extra('passing:overall', .9),
                  extra('passing:short:success', .8, .8), extra('passing:through:success', .3, .2)]}]
        peers = {'score_profiles': [{'passing:overall':v,'passing:short:success':v,'passing:through:success':v,
                                    'passing:short:success@usage':.6,'passing:through:success@usage':.4}
                                   for v in (.4,.5,.6,.7,.8)]}
        return source, peers

    def test_frequent_weak_type_has_more_impact_and_total_is_not_double_counted(self):
        source, peers = self.passing()
        result = build_domain_scores(source, peers)['areas'][1]
        self.assertEqual(result['metric_count'], 2)
        self.assertEqual([m['id'] for m in result['summaries']], ['passing:overall'])
        self.assertAlmostEqual(sum(m['weight'] for m in result['metrics']), 1)
        self.assertEqual(result['metrics'][0]['weight'], .8)
        self.assertEqual(result['metrics'][0]['reference_usage'], .6)
        source[0]['metrics'][1]['usage_share'], source[0]['metrics'][2]['usage_share'] = .2, .8
        weaker_mix = build_domain_scores(source, peers)['areas'][1]
        self.assertLess(weaker_mix['mine'], result['mine'])
        self.assertEqual(weaker_mix['reference'], result['reference'])

    def test_usage_is_not_itself_a_high_is_good_score(self):
        source, peers = self.passing()
        source[0]['metrics'][2]['value'] = source[0]['metrics'][1]['value']
        first = build_domain_scores(source, peers)['areas'][1]['mine']
        source[0]['metrics'][1]['usage_share'], source[0]['metrics'][2]['usage_share'] = .1, .9
        self.assertEqual(build_domain_scores(source, peers)['areas'][1]['mine'], first)

    def test_rare_type_shows_records_without_a_fabricated_score(self):
        source, peers = self.passing()
        source[0]['metrics'].append(extra('passing:lobbed_through:success', .5, .05, trials=4))
        metric = build_domain_scores(source, peers)['areas'][1]['metrics'][-1]
        self.assertEqual(metric['usage'], .05)
        self.assertIsNone(metric['score'])
        self.assertEqual(metric['weight'], 0)
        self.assertEqual(metric['status'], 'record')

    def test_unclassified_pass_records_do_not_raise_the_passing_grade(self):
        source, peers = self.passing()
        before = build_domain_scores(source, peers)['areas'][1]['mine']
        source[0]['metrics'].append(extra('passing:unclassified:success', 1, .1, direction='neutral'))
        for profile in peers['score_profiles']:
            profile['passing:unclassified:success'] = .2
        result = build_domain_scores(source, peers)['areas'][1]
        self.assertEqual(result['mine'], before)
        self.assertIsNone(result['metrics'][-1]['score'])

    def test_shooting_sections_are_balanced_and_regions_use_shot_mix(self):
        rows = [extra('shooting:on_target', .8), extra('shooting:conversion', .7),
                extra('shooting:box_inside', .6, .8), extra('shooting:box_outside', .2, .2),
                extra('shooting:shot_type_2', .5, .7), extra('shooting:shot_type_3', .4, .3)]
        source = [{'id':'shooting','metrics':rows}]
        peers = {'score_profiles': [{m['id']: .4 + i * .1 for m in rows} for i in range(5)]}
        result = build_domain_scores(source, peers)['areas'][2]
        self.assertEqual(result['metric_count'], 5)
        self.assertNotIn('shooting:conversion', [m['id'] for m in result['metrics']])
        for section in ('정확도','지역별','유형별'):
            self.assertAlmostEqual(sum(m['weight'] for m in result['metrics'] if m['section']==section), 1/3)
        inside = next(m for m in result['metrics'] if m['id']=='shooting:box_inside')
        self.assertAlmostEqual(inside['weight'], .8/3)

    def test_distance_and_intercepts_are_context_not_ability_bonuses(self):
        source = [{'id':'carrying','metrics':[extra('carrying:dribble',.7),
                  extra('carrying:dribble_distance',300,unit='meters',direction='neutral')]}]
        peers = {'score_profiles':[{'carrying:dribble':.5 + i*.1,'carrying:dribble_distance':200+i*50} for i in range(5)]}
        result = build_domain_scores(source, peers)['areas'][4]
        neutral = result['metrics'][1]
        self.assertIsNone(neutral['score'])
        self.assertEqual(neutral['status'],'context')
        source[0]['metrics'][1]['value'] = 10000
        self.assertEqual(build_domain_scores(source, peers)['areas'][4]['mine'],result['mine'])
