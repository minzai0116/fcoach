from __future__ import annotations

import os
import tempfile
import unittest
from contextlib import closing
from dataclasses import replace
from unittest.mock import patch

from app.db import connect, init_db, upsert_matches
from app.services.match_review import build_match_review, get_match_review
from app.services.opponent_profile import get_competitive_profile


def participant(ouid, nickname, **kwargs):
    return {'ouid': ouid, 'nickname': nickname, 'matchDetail': {'matchEndType': 0, 'matchResult': '승', 'possession': 50},
            'shoot': {'shootTotal': 4, 'effectiveShootTotal': 4, 'goalTotal': 2, 'goalTotalDisplay': 2},
            'pass': {'passTry': 20, 'passSuccess': 16}, 'defence': {'tackleTry': 4, 'tackleSuccess': 2}, **kwargs}


def payload():
    return {'matchId': 'match-id', 'matchDate': '2026-10-20T05:00:33', 'matchType': 60,
            'matchInfo': [participant('opponent-ouid', '상대', shoot={'shootTotal': 4, 'effectiveShootTotal': 2, 'goalTotal': 0, 'goalTotalDisplay': 0}),
                          participant('my-ouid-123', '나', shootDetail=[{'x': .9, 'y': .5, 'result': 3, 'type': 14, 'spId': 123, 'spGrade': 8, 'goalTime': 60}])]}


class MatchReviewTest(unittest.TestCase):
    def test_new_instance_reads_shared_match_cache_and_checks_mode_and_owner(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'HABIT_LAB_DB_PATH': temp + '/test.sqlite3'}):
            init_db()
            with patch('app.services.analysis._MATCH_CACHE.get_json', return_value=[{'match_id': 'match-id', 'payload': payload()}]), \
                 patch('app.services.analysis._spid_name_map', return_value={}), \
                 patch('app.services.match_review.get_competitive_profile', side_effect=lambda ouid: {
                     'current': {'status': 'no_current_season_match'} if ouid == 'my-ouid-123'
                     else {'status': 'available', 'name': '챌린지1'}, 'highest': {'name': '마스터1'},
                 }) as profile:
                result = get_match_review('my-ouid-123', 60, 'match-id')
                self.assertEqual(result['mine']['nickname'], '나')
                self.assertEqual(result['mine']['profile']['current']['status'], 'no_current_season_match')
                self.assertEqual(result['opponent']['profile']['current']['name'], '챌린지1')
                profile.reset_mock()
                with self.assertRaises(LookupError):
                    get_match_review('my-ouid-123', 50, 'match-id')
                with self.assertRaises(ValueError):
                    get_match_review('other-ouid', 60, 'match-id')
                profile.assert_not_called()

    def test_ownership_uses_ouid_not_participant_order_and_preserves_shooter(self):
        result = build_match_review(payload(), 'my-ouid-123', {123: '슈팅 선수'})
        self.assertEqual(result['mine']['nickname'], '나')
        self.assertEqual(result['opponent']['nickname'], '상대')
        self.assertEqual(result['mine']['shots'][0]['player_name'], '슈팅 선수')
        self.assertEqual(result['mine']['shots'][0]['type'], 14)
        self.assertTrue(result['mine']['shots'][0]['is_goal'])
        self.assertEqual(result['match_date'], '2026-10-20T05:00:33Z')
        metric = next(row for row in result['metrics'] if row['key'] == 'on_target')
        self.assertEqual(metric['gap'], 50)
        self.assertTrue(result['positives'])
        with self.assertRaises(ValueError):
            build_match_review(payload(), 'unrelated-ouid', {})

    def test_absent_zero_and_invalid_metrics_are_not_false_zero_percent(self):
        source = payload()
        source['matchInfo'][1]['pass'] = {'passTry': 0, 'passSuccess': 0, 'throughPassTry': 1, 'throughPassSuccess': 2}
        source['matchInfo'][0]['defence'] = {}
        metrics = {row['key']: row for row in build_match_review(source, 'my-ouid-123', {})['metrics']}
        self.assertIsNone(metrics['pass']['mine']['value'])
        self.assertEqual(metrics['pass']['mine']['trials'], 0)
        self.assertIsNone(metrics['through_pass']['mine']['trials'])
        self.assertIsNone(metrics['tackle']['opponent']['value'])
        self.assertIsNone(metrics['tackle']['gap'])

    def test_opponent_controller_uses_each_participants_record_and_aggregates_by_mode(self):
        from app.services.analysis import _extract_user_match, _recent_match_summary
        from app.services.opponent_controllers import opponent_controller_comparison

        source = payload()
        source['matchInfo'][0]['matchDetail']['controller'] = 'gamepad'
        source['matchInfo'][1]['matchDetail']['controller'] = 'keyboard'
        review = build_match_review(source, 'my-ouid-123', {})
        self.assertEqual((review['mine']['controller'], review['opponent']['controller']), ('keyboard', 'gamepad'))
        row = _extract_user_match(source, 'my-ouid-123')
        match = _recent_match_summary([row])[0]
        self.assertEqual((match['controller'], match['opponent_controller']), ('keyboard', 'gamepad'))

        forfeit_data = {**row.coaching_data, 'pass': {'passSuccess': 2, 'passTry': 2}}
        comparison = opponent_controller_comparison([
            row, replace(row, match_end_type=2, coaching_data=forfeit_data),
            replace(row, opponent_controller='keyboard'), replace(row, opponent_controller=None),
            replace(row, match_type=50), replace(row, match_type=52),
        ])
        self.assertEqual([entry['match_type'] for entry in comparison], [50, 60])
        self.assertIsNone(comparison[0]['keyboard']['win_rate'])
        friendly = comparison[1]
        self.assertEqual(friendly['unknown_matches'], 1)
        self.assertEqual(friendly['keyboard']['matches'], 1)
        pad = friendly['gamepad']
        self.assertEqual((pad['matches'], pad['wins'], pad['losses'], pad['win_rate']), (2, 1, 1, .5))
        self.assertEqual(pad['goals_for'], {'value': 2.0, 'matches': 1})
        self.assertEqual(pad['pass'], {'value': 18 / 22, 'success': 18, 'trials': 22, 'matches': 2})

        source['matchInfo'][0]['matchDetail']['controller'] = 'unknown-type'
        self.assertIsNone(_extract_user_match(source, 'my-ouid-123').opponent_controller)

    def test_forfeit_retains_score_but_does_not_judge_performance(self):
        source = payload()
        source['matchInfo'][1]['matchDetail']['matchEndType'] = 1
        source['matchInfo'][1]['shoot']['goalTotalDisplay'] = 3
        result = build_match_review(source, 'my-ouid-123', {})
        self.assertEqual(result['mine']['score'], 3)
        self.assertEqual(result['mine']['record_goals'], 2)
        self.assertFalse(result['normal'])
        self.assertEqual(result['positives'], [])
        self.assertEqual(result['checks'], [])
        from app.services.analysis import _extract_user_match, _recent_match_summary
        summary = _recent_match_summary([_extract_user_match(source, 'my-ouid-123')])[0]
        self.assertEqual(summary['score_for_display'], result['mine']['score'])
        self.assertEqual(summary['score_for'], result['mine']['record_goals'])

    def test_nickname_lookup_failure_keeps_both_divisions(self):
        divisions = {'current': {'status': 'no_current_season_match'}, 'highest': {'name': '마스터1'}}
        with patch('app.services.opponent_profile.get_user_divisions', return_value=divisions) as lookup, \
             patch('app.services.opponent_profile.NexonOpenApiClient', side_effect=RuntimeError('Missing key')):
            self.assertEqual(get_competitive_profile('no-key-unique-test'), divisions)
        lookup.assert_called_once_with('no-key-unique-test')

    def test_lookup_checks_owner_mode_and_retention_before_profile_fetch(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'HABIT_LAB_DB_PATH': temp + '/test.sqlite3'}):
            init_db()
            upsert_matches('my-ouid-123', 60, [{'match_id': 'match-id', 'match_date': '2026-10-20T05:00:33', 'payload_hash': 'hash', 'payload': payload()}])
            with patch('app.services.match_review.get_competitive_profile', return_value={'current': {}, 'highest': {}}) as profile, patch('app.services.analysis._spid_name_map', return_value={}):
                with self.assertRaises(LookupError):
                    get_match_review('other-ouid', 60, 'match-id')
                with self.assertRaises(LookupError):
                    get_match_review('my-ouid-123', 50, 'match-id')
                profile.assert_not_called()
                self.assertEqual(get_match_review('my-ouid-123', 60, 'match-id')['mine']['nickname'], '나')
                with closing(connect()) as conn:
                    conn.execute("UPDATE matches_raw SET created_at = '2000-01-01T00:00:00+00:00'")
                    conn.commit()
                with self.assertRaises(LookupError):
                    get_match_review('my-ouid-123', 60, 'match-id')


if __name__ == '__main__':
    unittest.main()
