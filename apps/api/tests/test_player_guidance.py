from copy import deepcopy
import unittest

from app.services.player_guidance import build_player_guidance
from test_feed_diagnosis import player, settings, metric


class PlayerGuidanceTest(unittest.TestCase):
    def test_no_comparison_still_offers_play_without_inventing_a_problem(self):
        result = build_player_guidance(player('LM', measurements=[metric('pass', 35, 48)]), settings())
        self.assertEqual(result['strengths'], [])
        self.assertEqual(result['improvements'], [])
        self.assertEqual(result['recommendations'][0]['kind'], 'play')
        self.assertIn('35/48회', result['recommendations'][0]['basis'])
        self.assertNotIn('다음 5경기', str(result))

    def test_only_verified_history_changes_become_strengths_and_improvements(self):
        metrics = [metric('pass', 90, 100), metric('tackle', 10, 30)]
        for row, status in zip(metrics, ('higher', 'lower')):
            row['comparison'] = {'status': status, 'previous': {'value': .6, 'success': 60, 'trials': 100}}
        result = build_player_guidance(player('RB', measurements=metrics))
        self.assertEqual([s['title'] for s in result['strengths']], ['pass'])
        self.assertEqual([s['title'] for s in result['improvements']], ['tackle'])
        self.assertIn('수비 위치', result['recommendations'][0]['title'])

    def test_missing_coach_is_not_treated_as_uninstalled(self):
        result = build_player_guidance(player(), settings(trainer=None))
        self.assertFalse(any(r['kind'] == 'coach' for r in result['recommendations']))

    def test_keeper_and_manager_receive_role_appropriate_advice(self):
        result = build_player_guidance(player('GK', measurements=[metric('pass', 8, 10)]))
        self.assertIn('배급', result['recommendations'][0]['title'])
        self.assertNotIn('개인기', str(result))
        result = build_player_guidance(player(), settings(), mode=52)
        self.assertFalse(any(r['kind'] == 'play' for r in result['recommendations']))

    def test_current_coach_is_preserved_instead_of_recommending_same_replacement(self):
        saved = deepcopy(settings())
        saved['training_coach'] = {'status': 'present', 'value': [{'code': 36, 'label': '안정적인 빌드업', 'known': True}]}
        result = build_player_guidance(player('LM', measurements=[metric('pass', 35, 48)]), saved)
        self.assertIn('현재 코치 활용', result['recommendations'][-1]['title'])


if __name__ == '__main__':
    unittest.main()
