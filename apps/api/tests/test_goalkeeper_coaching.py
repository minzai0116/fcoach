from dataclasses import replace
import unittest

from app.services.coaching_data import extract_player_coaching
from app.services.position_coaching import build_position_coaching
from test_position_coaching import sample, POSITIONS


def keeper_row(status, *, conceded=None, grade=5, end=0, date='2026-10-20T00:00:00Z'):
    status = extract_player_coaching({'spRating': 6, **status})
    row = sample(0, **status, sp_grade=grade)
    return replace(row, match_date=date, match_end_type=end,
                   coaching_data={'opponent_shoot': {} if conceded is None else {'goalTotal': conceded}})


def goalkeeper(rows, history=None):
    result = build_position_coaching(rows, {'players': []}, POSITIONS, history_rows=history)
    return result['players'][0]


class GoalkeeperCoachingTest(unittest.TestCase):
    def test_keeper_has_distribution_instead_of_outfield_success_rates(self):
        player = goalkeeper([keeper_row({'defending': 3, 'passTry': 4, 'passSuccess': 3}, conceded=1)])
        self.assertEqual([m['metric'] for m in player['measurements']], ['pass'])
        self.assertEqual(player['measurements'][0]['label'], '배급 패스 성공률')
        self.assertEqual(player['measurements'][0]['value'], .75)
        self.assertNotIn('save_rate', str(player))

    def test_direct_save_counter_and_rating_have_their_own_valid_denominators(self):
        rows = [keeper_row({'defending': 4, 'spRating': 8}, conceded=2),
                keeper_row({'defending': 2, 'spRating': 6}, conceded=0), keeper_row({})]
        values = {m['metric']: m['current'] for m in goalkeeper(rows)['goalkeeper_metrics']}
        self.assertEqual(values['defending_actions'], {'total': 6, 'matches': 2, 'value': 3})
        self.assertAlmostEqual(values['rating']['value'], 20 / 3, places=3)
        self.assertEqual(values['conceded'], {'total': 2, 'matches': 2, 'value': 1})
        self.assertEqual(values['clean_sheets'], {'total': 1, 'matches': 2, 'value': 1})

    def test_missing_values_are_not_zero_saves_or_clean_sheets(self):
        values = {m['metric']: m['current'] for m in goalkeeper([keeper_row({})])['goalkeeper_metrics']}
        self.assertIsNone(values['defending_actions']['value'])
        self.assertIsNone(values['clean_sheets']['value'])
        zero = {m['metric']: m['current'] for m in goalkeeper([keeper_row({'defending': 0}, conceded=0)])['goalkeeper_metrics']}
        self.assertEqual(zero['defending_actions']['value'], 0)
        self.assertEqual(zero['clean_sheets']['value'], 1)

    def test_forfeits_and_invalid_values_are_excluded(self):
        values = {m['metric']: m['current'] for m in goalkeeper([
            keeper_row({'defending': 2}, conceded=1), keeper_row({'defending': True}, conceded=-1),
            keeper_row({'defending': 50}, conceded=0, end=1)])['goalkeeper_metrics']}
        self.assertEqual(values['defending_actions']['total'], 2)
        self.assertEqual(values['conceded']['matches'], 1)

    def test_team_conceded_uses_final_score_when_available(self):
        row = keeper_row({'defending': 2}, conceded=0)
        row.coaching_data['opponent_shoot']['goalTotalDisplay'] = 1
        values = {m['metric']: m['current'] for m in goalkeeper([row])['goalkeeper_metrics']}
        self.assertEqual(values['conceded']['value'], 1)
        self.assertEqual(values['clean_sheets']['value'], 0)

    def test_history_is_older_and_matches_the_same_card_grade_and_position(self):
        now = [keeper_row({'defending': 4})]
        older = keeper_row({'defending': 2}, date='2026-10-19T00:00:00Z')
        result = goalkeeper(now, [older, *now])
        metric = result['goalkeeper_metrics'][0]
        self.assertEqual(metric['previous']['value'], 2)
        changed = keeper_row({'defending': 20}, grade=8, date='2026-10-19T00:00:00Z')
        self.assertIsNone(goalkeeper(now, [changed])['goalkeeper_metrics'][0]['previous']['value'])
        self.assertEqual(result['findings'], [])
