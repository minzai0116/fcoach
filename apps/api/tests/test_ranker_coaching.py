import unittest
from app.services.ranker_coaching import build_ranker_coaching


def metric(key, value, direction='higher', unit='rate', matches=30, trials=100):
    return {'id': key, 'label': key, 'value': value, 'direction': direction, 'unit': unit, 'matches': matches, 'trials': trials, 'success': value * trials}


def benchmark(*metrics):
    return {'status': 'available', 'ranker_count': 20, 'record_count': 480, 'groups': [{'metrics': [
        {**m, 'ranker_count': 20, 'q1': m['value'] * .9, 'q3': m['value'] * 1.1, 'spread': .1} for m in metrics]}]}


def coach(*metrics, reference=None, **kw):
    return build_ranker_coaching([{'id': 'test', 'metrics': list(metrics)}], reference or benchmark(), {'players': [], **kw})


class RankerCoachTest(unittest.TestCase):
    def test_actual_distribution_replaces_absolute_success_thresholds(self):
        result = coach(metric('passing:overall', .2), reference=benchmark(metric('passing:overall', .1)))
        self.assertEqual(len(result['strengths']), 1)
        self.assertEqual(result['weaknesses'], [])

    def test_conceding_less_is_a_strength_and_neutral_metrics_are_not_judged(self):
        result = coach(metric('overview:goals_against', 1, 'lower', 'goals'), metric('overview:possession', .8, 'neutral'),
                       reference=benchmark(metric('overview:goals_against', 2, 'lower', 'goals'), metric('overview:possession', .5, 'neutral')))
        self.assertEqual([item['id'] for item in result['strengths']], ['overview:goals_against'])
        self.assertEqual(result['weaknesses'], [])

    def test_no_data_or_close_values_do_not_generate_a_problem(self):
        self.assertEqual(coach(metric('passing:overall', .2))['advice'], [])
        self.assertEqual(coach(metric('passing:overall', .8), reference=benchmark(metric('passing:overall', .8)))['weaknesses'], [])
        self.assertEqual(coach(metric('passing:overall', .2, trials=0), reference=benchmark(metric('passing:overall', .8)))['weaknesses'], [])
        self.assertEqual(coach(metric('passing:overall', .2, matches=2), reference=benchmark(metric('passing:overall', .8)))['weaknesses'], [])

    def test_low_goal_volume_with_good_conversion_gets_creation_advice(self):
        result = coach(metric('overview:goals_for', 1, unit='goals'), metric('shooting:conversion', .6),
                       reference=benchmark(metric('overview:goals_for', 3, unit='goals'), metric('shooting:conversion', .3)))
        self.assertEqual(result['advice'][0]['title'], '슈팅 기회 늘리기')
        self.assertIn('평균 이상', result['advice'][0]['context'])

    def test_saved_settings_are_used_only_when_author_and_mode_match(self):
        feed = {'status': 'available', 'author_status': 'matched', 'mode_status': 'matched', 'snapshot': {'team_tactics': [
            {'key': 'offensive_style_buildup', 'label': '빌드업', 'status': 'present', 'value': '긴 패스'}]}}
        result = coach(metric('passing:long:success', .3), reference=benchmark(metric('passing:long:success', .8)), squad_feed=feed)
        self.assertIn('밸런스', result['advice'][0]['tactic'])
        self.assertEqual(result['advice'][0]['setting']['value'], '긴 패스')
        feed['author_status'] = 'mismatch'
        result = coach(metric('passing:long:success', .3), reference=benchmark(metric('passing:long:success', .8)), squad_feed=feed)
        self.assertIsNone(result['advice'][0]['setting'])

    def test_position_focus_uses_measured_failed_attempts_without_team_threshold(self):
        players = [{'player_name': '선수', 'position_name': 'LM', 'measurements': [
            {'metric': 'pass', 'success': 35, 'trials': 48, 'observed_matches': 8}]}]
        result = coach(metric('passing:overall', .5), reference=benchmark(metric('passing:overall', .9)), players=players)
        player = result['advice'][0]['players'][0]
        self.assertEqual((player['position'], player['success'], player['trials']), ('LM', 35, 48))
        self.assertIn('직접 비교한 판정은 아닙니다', player['note'])

    def test_low_assists_do_not_infer_a_finishing_problem(self):
        result = coach(metric('shooting:assists', 1, unit='average'),
                       reference=benchmark(metric('shooting:assists', 3, unit='average')))
        self.assertEqual(result['advice'][0]['title'], '슈팅 기회 늘리기')
        self.assertNotEqual(result['advice'][0]['title'], '슈팅 선택')
        self.assertEqual(result['advice'][0]['players'], [])

    def test_win_rate_is_excluded_from_both_coaching_highlight_groups(self):
        result = coach(metric('overview:win_rate', .1), metric('passing:overall', .3),
                       reference=benchmark(metric('overview:win_rate', .8), metric('passing:overall', .9)))
        self.assertNotIn('overview:win_rate', [item['id'] for item in result['weaknesses']])
        self.assertEqual(result['weaknesses'][0]['id'], 'passing:overall')

    def test_sector_highlights_are_not_lost_to_global_family_or_top_three_limit(self):
        rows = [metric('passing:short:success', .2), metric('passing:long:success', .3),
                metric('shooting:conversion', .9), metric('defending:team_tackle', .2), metric('carrying:dribble', .9)]
        ref = benchmark(*(metric(item['id'], .6) for item in rows))
        groups = [{'id': area, 'metrics': [item for item in rows if item['id'].startswith(area + ':')]}
                  for area in ('passing','shooting','defending','carrying')]
        result = build_ranker_coaching(groups, ref, {'players':[]})
        self.assertEqual(len(result['by_group']['passing']['weaknesses']),2)
        self.assertEqual(result['by_group']['shooting']['strengths'][0]['id'],'shooting:conversion')
        self.assertEqual(result['by_group']['defending']['strengths'],[])
        self.assertEqual(result['by_group']['carrying']['strengths'][0]['id'],'carrying:dribble')
