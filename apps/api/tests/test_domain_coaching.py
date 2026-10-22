from dataclasses import replace
from unittest.mock import patch
import unittest

from app.services.coaching_data import extract_coaching_data, extract_player_coaching, shot_minute
from app.services.analysis import _extract_user_match, _build_visual_summary
from app.services.domain_coaching import build_domain_coaching
from app.services.position_coaching import build_position_coaching
from test_position_coaching import sample, POSITIONS


def domain(rows, name):
    return next(d for d in build_domain_coaching(rows) if d['id'] == name)


def metrics(rows, name):
    return {m['metric']: m for m in domain(rows, name)['metrics']}


def row(user=None, opponent=None, **status):
    result = sample(**extract_player_coaching({'spRating': 6, **status}))
    return replace(result, coaching_data=extract_coaching_data(user or {}, opponent or {}))


class DomainCoachingTest(unittest.TestCase):
    def test_final_score_includes_own_goals_without_changing_shot_conversion(self):
        value = row({'shoot': {'shootTotal': 5, 'goalTotal': 1, 'goalTotalDisplay': 2}},
                    {'shoot': {'goalTotal': 0, 'goalTotalDisplay': 1}})
        self.assertEqual(metrics([value], 'overview')['goals_for']['value'], 2)
        self.assertEqual(metrics([value], 'defending')['goals_against']['value'], 1)
        self.assertEqual(metrics([value], 'shooting')['conversion']['value'], .2)

    def test_missing_negative_boolean_and_impossible_player_counts_are_excluded(self):
        status = extract_player_coaching({'ballPossesionTry': 10, 'ballPossesionSuccess': 11,
                                         'blockTry': True, 'block': 0, 'aerialTry': -1, 'aerialSuccess': 0})
        self.assertEqual(status['ball_possession_observed'], 0)
        self.assertEqual(status['block_observed'], 0)
        self.assertEqual(status['aerial_observed'], 0)
        self.assertEqual(status['dribble_observed'], 0)

    def test_ball_possession_supports_actual_and_documented_names(self):
        for key in ('ballPossesionSuccess', 'ballPossesionSuc'):
            result = extract_player_coaching({'ballPossesionTry': 12, key: 9})
            self.assertEqual(result['ball_possession_success'], 9)
            self.assertEqual(result['ball_possession_observed'], 1)

    def test_ratios_weight_attempts_and_exclude_invalid_games_and_forfeits(self):
        rows = [row({'shoot': {'shootTotal': 100, 'goalTotal': 40}}),
                *[row({'shoot': {'shootTotal': 1, 'goalTotal': 0}}) for _ in range(4)],
                row({'shoot': {'shootTotal': 2, 'goalTotal': 3}}),
                replace(row({'shoot': {'shootTotal': 100, 'goalTotal': 100}}), match_end_type=1)]
        metric = metrics(rows, 'shooting')['conversion']
        self.assertEqual(metric['success'], 40)
        self.assertEqual(metric['trials'], 104)
        self.assertEqual(metric['observed_matches'], 5)
        self.assertAlmostEqual(metric['value'], 40 / 104, places=4)

    def test_missing_and_zero_attempts_do_not_become_zero_success_rate(self):
        result = metrics([row({'shoot': {'shootTotal': 0, 'goalTotal': 0}})] * 5, 'shooting')
        self.assertIsNone(result['conversion']['value'])
        self.assertEqual(result['conversion']['status'], 'insufficient')
        self.assertEqual(result['heading']['observed_matches'], 0)

    def test_shot_types_preserve_same_date_games_unknown_codes_and_valid_results(self):
        shots = [{'type': 2, 'result': 3}, {'type': 2, 'result': 1}, {'type': 2, 'result': 2},
                 {'type': 13, 'result': 3}, {'type': 2, 'result': True}, {'type': 2, 'result': 0}]
        result = metrics([row({'shootDetail': shots}), row({'shootDetail': []})], 'shooting')
        self.assertEqual(result['shot_type_2']['trials'], 3)
        self.assertEqual(result['shot_type_2']['success'], 1)
        self.assertEqual(result['shot_type_2']['on_target'], 2)
        self.assertEqual(result['shot_type_2']['usage_share'], .75)
        self.assertEqual(result['shot_type_2']['failure_share'], 1)
        self.assertEqual(result['shot_type_2']['observed_matches'], 2)
        self.assertIn('코드 13', result['shot_type_13']['label'])
        self.assertIsNone(result['shot_type_4']['value'])

    def test_shot_map_does_not_invent_or_clamp_coordinates(self):
        shots = [{'type': 1, 'result': 3, 'x': 1.2, 'y': .5}, {'type': 1, 'result': 1, 'y': .5},
                 {'type': 1, 'result': 2, 'x': .9, 'y': .4}]
        result = domain([row({'shootDetail': shots})], 'shooting')
        self.assertEqual(len(result['shot_map']), 1)
        self.assertEqual(result['shot_map'][0]['x'], .9)
        self.assertEqual(result['metrics'][0]['observed_matches'], 0)

    def test_shot_identity_survives_extraction_and_both_maps(self):
        shots = [dict(type=14, result=3, spId=12345, spGrade=8, x=.9, y=.4, goalTime=900),
                 dict(type=2, result=1, spId=99999, spGrade=10, x=.8, y=.6, goalTime=1000)]
        payload = {'matchInfo': [{'ouid': 'user', 'shootDetail': shots}, {'ouid': 'other'}]}
        extracted = _extract_user_match(payload, 'user')
        self.assertEqual([(s['sp_id'], s['sp_grade']) for s in extracted.shots_for_points], [(12345, 8), (99999, 10)])
        with patch('app.services.analysis._spid_name_map', return_value={12345: '선수 A'}), \
             patch('app.services.analysis._player_report_summary', return_value={'players': []}):
            visual = _build_visual_summary([extracted])['shot_map']
        self.assertEqual(visual[0]['player_name'], '선수 A')
        self.assertIsNone(visual[1]['player_name'])
        detailed = next(d for d in build_domain_coaching([row({'shootDetail': shots})], player_names={12345: '선수 A'}) if d['id'] == 'shooting')['shot_map']
        self.assertEqual(detailed[0]['player_name'], '선수 A')
        self.assertEqual(detailed[0]['type'], 14)
        self.assertIsNone(detailed[1]['player_name'])

    def test_seconds_half_encoding_extra_time_and_shootouts(self):
        self.assertEqual(shot_minute(786), 13.1)
        self.assertEqual(shot_minute(2 ** 24 + 900), 60)
        self.assertEqual(shot_minute(2 * 2 ** 24 + 600), 100)
        self.assertEqual(shot_minute(3 * 2 ** 24 + 600), 115)
        self.assertIsNone(shot_minute(4 * 2 ** 24 + 60))
        self.assertIsNone(shot_minute(None))

    def test_existing_dashboard_uses_the_same_official_time_decoding(self):
        payload = {'matchInfo': [{'ouid': 'user'}, {'ouid': 'other', 'shootDetail': [
            {'result': 3, 'goalTime': 2 ** 24 + 900},
            {'result': 3, 'goalTime': 786}, {'result': 3},
            {'result': 3, 'goalTime': 4 * 2 ** 24 + 60}]}]}
        result = _extract_user_match(payload, 'user')
        self.assertEqual(result.goals_against_minutes, [60, 13.1])
        self.assertEqual(result.late_goals_against, 1)

    def test_shootout_attempts_are_not_regular_pk_conversion(self):
        result = metrics([row({'shootDetail': [
            {'type': 9, 'result': 3, 'goalTime': 4 * 2 ** 24 + 60},
            {'type': 9, 'result': 2, 'goalTime': 600}]})], 'shooting')['shot_type_9']
        self.assertEqual((result['success'], result['trials']), (0, 1))

    def test_display_precision_preserves_one_decimal_percentage_rounding(self):
        result = metrics([row({'defence': {'tackleTry': 544, 'tackleSuccess': 281}})], 'defending')
        self.assertEqual(round(result['team_tackle']['value'] * 100, 1), 51.7)

    def test_late_concession_uses_only_timed_goals(self):
        shots = [{'result': 3, 'goalTime': 600}, {'result': 3, 'goalTime': 2 ** 24 + 1000},
                 {'result': 1, 'goalTime': 2 ** 24 + 1000}, {'result': 3},
                 {'result': 3, 'goalTime': 4 * 2 ** 24 + 60}]
        result = domain([row(opponent={'shootDetail': shots})], 'defending')
        late = next(m for m in result['metrics'] if m['metric'] == 'late_conceded')
        self.assertEqual((late['success'], late['trials']), (1, 2))
        self.assertEqual(sum(p['goals_against'] for p in result['periods']), 2)

    def test_averages_exclude_missing_and_out_of_range_fields(self):
        rows = [row({'matchDetail': {'possession': 60, 'averageRating': 7, 'OffsideCount': 2}}),
                row({'matchDetail': {'possession': 101, 'averageRating': 11}}), row()]
        result = metrics(rows, 'overview')
        self.assertEqual(result['possession']['value'], .6)
        self.assertEqual(result['possession']['observed_matches'], 1)
        self.assertEqual(result['average_rating']['value'], 7)
        self.assertEqual(metrics(rows, 'discipline')['offside']['value'], 2)

    def test_unused_subs_and_duplicate_players_do_not_inflate_carrying(self):
        value = row(ballPossesionTry=10, ballPossesionSuccess=8, intercept=2)
        value.player_stats += [dict(value.player_stats[0]), {**value.player_stats[0], 'sp_position': 28}]
        result = metrics([value], 'carrying')['ball_possession']
        self.assertEqual((result['success'], result['trials']), (8, 10))
        self.assertEqual(metrics([value], 'defending')['intercept']['total'], 2)

    def test_player_shot_types_require_unique_player_grade_position_binding(self):
        shots = [{'spId': 12345, 'spGrade': 5, 'type': 2, 'result': 3},
                 {'spId': 12345, 'spGrade': 6, 'type': 2, 'result': 3}]
        value = row({'shootDetail': shots}, shoot=2, effectiveShoot=1, goal=1)
        result = build_position_coaching([value], {'players': []}, POSITIONS)
        self.assertEqual(result['players'][0]['shot_types'][0]['trials'], 1)
        value.player_stats.append({**value.player_stats[0], 'sp_position': 25})
        result = build_position_coaching([value], {'players': []}, POSITIONS)
        self.assertTrue(all(not p['shot_types'] for p in result['players']))

    def test_new_metrics_have_no_invented_role_reference_or_findings(self):
        value = row(ballPossesionTry=10, ballPossesionSuccess=1, aerialTry=2, aerialSuccess=0)
        result = build_position_coaching([value] * 5, {'players': []}, POSITIONS)
        metric = next(m for m in result['players'][0]['measurements'] if m['metric'] == 'ball_possession')
        self.assertIsNone(metric['reference'])
        self.assertEqual(metric['status'], 'sufficient')
        self.assertNotIn('ball_possession', [f['metric'] for f in result['players'][0]['findings']])


if __name__ == '__main__':
    unittest.main()
