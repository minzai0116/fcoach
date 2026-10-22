from copy import deepcopy
from dataclasses import replace
import unittest

from app.services.feed_diagnosis import _player_plans, _verify, build_contextual_coaching
from app.services.squad_feed_data import normalize_player, normalize_snapshot
from test_squad_feed import raw_player, raw_feed
from test_passing_coaching import passing_row


def metric(code, success, trials, status='sufficient'):
    return {'metric': code, 'label': code, 'value': success / trials if trials else None, 'success': success,
            'trials': trials, 'status': status, 'observed_matches': 5, 'minimum_trials': 20}


def player(position='LS', sp_id=12345, measurements=None):
    return {'player_name': '테스트 선수', 'sp_id': sp_id, 'sp_grade': 5, 'position_name': position, 'sp_position': 26,
            'appearances': 5, 'findings': [], 'measurements': measurements or [metric('pass', 90, 100),
            metric('shot', 18, 20), metric('finishing', 10, 20), metric('ball_possession', 10, 100)]}


def settings(**kw):
    return normalize_player(raw_player(**{'role': 'ls', 'strategy': [['SR', '1'], ['AR', '1']], 'traits': [52, 22], 'trainer': [28, 30, 42], **kw}))


class ContextualPlayerTest(unittest.TestCase):
    def test_perfect_measurement_is_not_given_a_lower_target(self):
        self.assertIn('이전 구간과 비교', _verify(metric('pass', 100, 100), '시도량 확인'))
        self.assertNotIn('99.0%', _verify(metric('pass', 100, 100), '시도량 확인'))

    def test_saved_role_does_not_generate_correction_without_history(self):
        for saved in (settings(), settings(strategy=None)):
            plan = _player_plans(player(), saved, None, 60)[0]
            self.assertEqual(plan['status'], 'observation')
            self.assertEqual(plan['actions'], [])

    def test_targetman_coach_requires_explicit_incompatible_ar(self):
        saved = settings(); saved['training_coach'] = normalize_player(raw_player(trainer=[46]))['training_coach']
        plans = _player_plans(player(), saved, None, 60)
        self.assertIn('coach_role', [p['id'] for p in plans])
        for value in (None, 2):
            changed = deepcopy(saved)
            changed['personal_tactics'] = {'status': 'missing', 'value': None} if value is None else {'status': 'present', 'value': [{'code': 'AR', 'value': 2, 'label': '타겟맨', 'known': True}]}
            self.assertNotIn('coach_role', [p['id'] for p in _player_plans(player(), changed, None, 60)])

    def test_good_defender_is_maintained_without_forced_change(self):
        p = player('RCB', measurements=[metric('pass', 92, 100), metric('tackle', 65, 100)])
        plans = _player_plans(p, settings(), None, 60)
        self.assertEqual(plans[0]['status'], 'observation')
        self.assertFalse(any(a['kind'] == 'setting' for a in plans[0]['actions']))

    def test_same_settings_with_different_metrics_do_not_repeat_correction(self):
        p = player()
        self.assertEqual(_player_plans(p, settings(), None, 60)[0]['actions'], [])
        p['measurements'][-1] = metric('ball_possession', 70, 100)
        self.assertEqual(_player_plans(p, settings(), None, 60)[0]['id'], 'maintain')

    def test_missing_personal_tactics_never_become_a_default_sr_trial(self):
        p = _player_plans(player(), settings(strategy=None), None, 60)[0]
        self.assertEqual(p['status'], 'observation')
        self.assertFalse(any(a['kind'] == 'setting' for a in p['actions']))

    def test_missing_coach_is_not_invented_or_treated_as_uninstalled(self):
        p = _player_plans(player(), settings(trainer=None), None, 60)[0]
        self.assertFalse(any(s['label'] == '현재 코치' for s in p['settings']))
        self.assertNotIn('미장착', str(p))

    def test_small_sample_and_manager_do_not_get_manual_or_setting_changes(self):
        p = player(measurements=[metric('pass', 2, 10, 'insufficient')])
        plan = _player_plans(p, settings(), None, 60)[0]
        self.assertEqual(plan['status'], 'insufficient'); self.assertEqual(plan['actions'], [])
        plan = _player_plans(player(), settings(), None, 52)[0]
        self.assertEqual(plan['status'], 'observation'); self.assertEqual(plan['actions'], [])

    def test_one_dm_is_chosen_from_paired_metrics_not_both_changed(self):
        ps = [player('RDM', 1, [metric('pass', 90, 100), metric('tackle', 36, 100), metric('ball_possession', 60, 100)]),
              player('LDM', 2, [metric('pass', 90, 100), metric('tackle', 49, 100), metric('ball_possession', 51, 100)])]
        records = [{'sp_id': p['sp_id'], 'sp_grade': 5, 'position_name': p['position_name'], 'player_name': '테스트', 'linked': True,
                    'settings': normalize_player(raw_player(spid=p['sp_id'], role=p['position_name'].lower(), participation=[3, 3])), 'plans': []} for p in ps]
        snap = normalize_snapshot(raw_feed(), 'feed12345', 'now')
        build_contextual_coaching(snap, {'players': ps}, [passing_row()] * 5, records, 60)
        self.assertNotIn('holding_midfielder', [p['id'] for p in records[0]['plans']])
        self.assertNotIn('holding_midfielder', [p['id'] for p in records[1]['plans']])
        self.assertEqual(records[1]['plans'][0]['actions'], [])

    def test_unlinked_players_never_get_feed_plans(self):
        snap = normalize_snapshot(raw_feed(), 'feed12345', 'now')
        record = {'sp_id': 12345, 'sp_grade': 5, 'position_name': 'LS', 'linked': False, 'plans': []}
        result = build_contextual_coaching(snap, {'players': [player()]}, [passing_row()] * 5, [record], 60)
        self.assertEqual(record['plans'], [])
        self.assertEqual(result['priorities'], [])


class ExactTeamScopeTest(unittest.TestCase):
    def test_team_trial_uses_only_simultaneously_matching_rosters(self):
        roles = ['GK', 'RB', 'RCB', 'LCB', 'LB', 'RDM', 'LDM', 'RAM', 'LAM', 'RS', 'LS']
        ps = [dict(player(role, i + 1), sp_position=i) for i, role in enumerate(roles)]
        saved = [raw_player(spid=i + 1, role=role.lower()) for i, role in enumerate(roles)]
        snap = normalize_snapshot(raw_feed(players=saved, teamSt={'offensive_style_buildup': 2}), 'feed12345', 'now')
        records = [{'sp_id': p['sp_id'], 'sp_grade': 5, 'position_name': p['position_name'], 'player_name': '테스트', 'linked': True,
                    'settings': normalize_player(saved[i]), 'plans': []} for i, p in enumerate(ps)]
        lineup = [{'sp_id': i + 1, 'sp_grade': 5, 'sp_position': i, 'rating': 6} for i in range(11)]
        valid = replace(passing_row(short=(90, 85), long=(10, 2)), player_stats=lineup)
        different = replace(passing_row(short=(90, 85), long=(999, 0)), player_stats=lineup[:-1])
        history = [replace(passing_row(short=(90, 85), long=(10, 10)), player_stats=lineup, match_date='2026-10-05T00:00:00Z')] * 5
        result = build_contextual_coaching(snap, {'players': ps}, [valid] * 5 + [different], records, 60, history_rows=history)
        self.assertEqual(result['matched_roster_sample_count'], 5)
        self.assertEqual(result['team_plans'][0]['evidence'][0]['trials'], 50)
        result = build_contextual_coaching(snap, {'players': ps}, [valid] * 4 + [different] * 10, records, 60)
        self.assertEqual(result['team_plans'], [])


class FeatureIconTest(unittest.TestCase):
    def test_intrinsic_alias_and_zero_code_use_official_paths(self):
        p = normalize_player(raw_player(trait='패스마스터,파워 헤더', traits=[0], trainer=[0]))
        self.assertEqual([f['code'] for f in p['intrinsic_features']['value']], [27, 22])
        self.assertTrue(p['acquired_traits']['value'][0]['icon_url'].endswith('/traits/trait_icon_00.png'))
        self.assertTrue(p['training_coach']['value'][0]['icon_url'].endswith('/trainingTrait/training_trait_icon_000.png'))

    def test_unknown_feature_keeps_name_without_fabricated_icon(self):
        p = normalize_player(raw_player(trait='새로운 미정의 특성', traits=[9999], trainer=[9998]))
        for key in ('intrinsic_features', 'acquired_traits', 'training_coach'):
            self.assertFalse(p[key]['value'][0]['known'])
            self.assertIsNone(p[key]['value'][0]['icon_url'])
