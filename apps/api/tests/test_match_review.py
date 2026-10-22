from __future__ import annotations

import os
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch

from app.db import connect, init_db, upsert_matches
from app.services.match_review import build_match_review, get_match_review
from app.services.opponent_profile import parse_current_rank, get_competitive_profile


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
                 patch('app.services.match_review.get_competitive_profile', return_value={}) as profile:
                result = get_match_review('my-ouid-123', 60, 'match-id')
                self.assertEqual(result['mine']['nickname'], '나')
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

    def test_public_rank_exact_name_and_explicit_unranked_vs_failure(self):
        html = '<div class="tbody"><div class="tr"><span class="rank_no">1,234</span><div class="rank_coach"><span class="name profile_pointer">나</span></div><span class="rank_r_win_point">2800.15</span></div></div><p>2026-10-20 16:00:00 기준</p>'
        result = parse_current_rank(html, '나')
        self.assertEqual(result['rank'], 1234)
        self.assertEqual(result['as_of'], '2026-10-20T16:00:00+09:00')
        self.assertEqual(parse_current_rank(html, '다른 이름')['status'], 'unavailable')
        self.assertEqual(parse_current_rank('순위 내 포함되어 있지 않네요. 1~10,000위까지만 제공됩니다.', '나')['status'], 'outside_public_range')
        self.assertEqual(parse_current_rank('서버 오류', '나')['status'], 'unavailable')

    def test_missing_credentials_does_not_block_cached_match_metrics(self):
        with patch('app.services.opponent_profile.NexonOpenApiClient', side_effect=RuntimeError('Missing key')):
            result = get_competitive_profile('no-key-unique-test')
        self.assertIsNone(result['highest_division'])
        self.assertEqual(result['current_rank']['status'], 'unavailable')

    def test_lookup_checks_owner_mode_and_retention_before_profile_fetch(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {'HABIT_LAB_DB_PATH': temp + '/test.sqlite3'}):
            init_db()
            upsert_matches('my-ouid-123', 60, [{'match_id': 'match-id', 'match_date': '2026-10-20T05:00:33', 'payload_hash': 'hash', 'payload': payload()}])
            with patch('app.services.match_review.get_competitive_profile', return_value={'highest_division': None}) as profile, patch('app.services.analysis._spid_name_map', return_value={}):
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
