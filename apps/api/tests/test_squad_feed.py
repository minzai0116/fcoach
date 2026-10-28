from __future__ import annotations

from dataclasses import replace
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import requests
from fastapi import HTTPException
from pydantic import ValidationError
from starlette.requests import Request

from app.db import init_db
from app.models import AnalysisRunRequest
from app.services.cache import CacheClient
from app.services.squad_feed import SquadFeedError, get_public_feed, search_public_feeds
from app.services.squad_feed_data import normalize_snapshot
from app.services.feed_coaching import build_feed_coaching
from app.services.position_coaching import build_position_coaching
from app.services.analysis import run_analysis, get_latest_analysis
from test_position_coaching import sample, POSITIONS


FEED_ID = '8NZXDVG8KM09QIN'


def raw_player(**kw):
    return {'spid': 12345, 'name': '테스트 선수', 'role': 'cam', 'state': 1, 'buildUp': 5, 'trait': '예리한 감아차기',
            'traits': [13, -2, -2], 'trainer': [0, -2, -2], 'strategy': [['IN0', 1]], 'participation': [2, 2], **kw}


def raw_feed(**kw):
    return {'strCharacterName': '맹장축구', 'SquadInfo': {'squadName': '검증 스쿼드', 'mode': 1, 'formation': '4-2-3-1',
            'teamSt': {'defensivestyle': 0, 'offwidth': 8, 'defdepth': 6}, 'players': [raw_player()], **kw}}


def snapshot(**kw):
    return normalize_snapshot(raw_feed(**kw), FEED_ID, '2026-10-16T00:00:00+00:00')


def link(feed=None, rows=None, mode=60):
    rows = rows or [replace(sample(), user_nickname='맹장축구')] * 5
    coaching = build_position_coaching(rows, {'players': [{'sp_id': 12345, 'sp_grade': 5, 'player_name': '테스트 선수'}]}, POSITIONS, mode)
    return build_feed_coaching(feed or snapshot(), coaching, rows, mode)


class FeedNormalizationTest(unittest.TestCase):
    def test_selected_portrait_and_saved_overall_are_preserved(self):
        player = snapshot(players=[raw_player(spid=863231747, thumb_custom='/playersActionHigh/p854231747.png?rd=202610280410',
                                              thumb='/players/p231747.png', ovr=150, pay=31)])['players'][0]
        self.assertTrue(player['portrait_img'].endswith('/playersActionHigh/p854231747.png?rd=202610280410'))
        self.assertEqual((player['overall'], player['salary']), (150, 31))

    def test_portraits_reject_other_players_and_untrusted_paths(self):
        for path in ('https://example.com/p12345.png', '/playersAction/p99999.png', '//evil.test/p12345.png',
                     '/playersAction/../p12345.png', '/players/p12345.png?url=https://evil.test'):
            self.assertEqual(snapshot(players=[raw_player(thumb_custom=path)])['players'][0]['portrait_img'], '')
        player = snapshot(players=[raw_player(thumb_custom='', thumb='/players/p12345.png', ovr=True, pay=-1)])['players'][0]
        self.assertTrue(player['portrait_img'].endswith('/players/p12345.png'))
        self.assertIsNone(player['overall'])
        self.assertIsNone(player['salary'])

    def test_saved_xy_coordinates_are_preserved_and_not_guessed(self):
        p = snapshot(players=[raw_player(x=89.612605, y=15.575539)])['players'][0]
        self.assertEqual(p['pitch_position'], {'status': 'present', 'value': {'x': 89.612605, 'y': 15.575539}})
        self.assertEqual(snapshot()['players'][0]['pitch_position']['status'], 'missing')
        for x in (-1, 101, True, float('nan'), '50'):
            self.assertEqual(snapshot(players=[raw_player(x=x, y=50)])['players'][0]['pitch_position']['status'], 'invalid')
        self.assertEqual(snapshot(players=[raw_player(x=0, y=100)])['players'][0]['pitch_position']['status'], 'present')

    def test_bellingham_acquired_traits_and_all_three_coaches_stay_separate(self):
        player = snapshot(players=[raw_player(spid=856252371, name='주드 벨링엄', role='ldm', buildUp=8,
                                              traits=[66, 22, -2], trainer=[12, 30, 44])])['players'][0]
        self.assertEqual([v['label'] for v in player['acquired_traits']['value']], ['레이저 슈터', '파워 헤더'])
        self.assertEqual([v['label'] for v in player['training_coach']['value']], ['능숙한 몸 싸움', '퍼스트 터치 후 바로 이동', '재정비'])
        self.assertTrue(all(v['icon_url'] for v in player['acquired_traits']['value'] + player['training_coach']['value']))

    def test_valid_zero_codes_and_labels_are_not_missing(self):
        feed = snapshot()
        self.assertEqual(feed['team_tactics'][0]['value'], '후퇴')
        self.assertEqual(feed['players'][0]['training_coach']['value'][0]['label'], '근거리 슛 향상')
        self.assertEqual(feed['players'][0]['personal_tactics']['value'][0]['label'], '적극적 차단')

    def test_missing_unset_and_invalid_values_are_distinct(self):
        player = raw_player(traits=[-2, -2, -2], strategy=None, participation=[True, 2])
        player.pop('trainer')
        feed = snapshot(players=[player])
        p = feed['players'][0]
        self.assertEqual(p['acquired_traits']['status'], 'unset')
        self.assertEqual(p['training_coach']['status'], 'missing')
        self.assertEqual(p['personal_tactics']['status'], 'missing')
        self.assertEqual(p['participation']['status'], 'invalid')
        self.assertEqual(feed['team_tactics'][1]['status'], 'missing')

    def test_unknown_codes_keep_identity_and_do_not_invent_labels(self):
        p = snapshot(players=[raw_player(trainer=[9999], traits=[9998], strategy=[['XYZ0', 2]])])['players'][0]
        for field in ('training_coach', 'acquired_traits', 'personal_tactics'):
            self.assertFalse(p[field]['value'][0]['known'])
            self.assertIn('미정의', p[field]['value'][0]['label'])

    def test_empty_substitutes_invalid_grades_and_fields_do_not_become_defaults(self):
        data = snapshot(players=[raw_player(buildUp=None, trainer=[False]), raw_player(spid=0)], teamSt={'defwidth': -1, 'defdepth': 11, 'offwidth': True})
        self.assertEqual(len(data['players']), 1)
        self.assertIsNone(data['players'][0]['grade'])
        self.assertEqual(data['players'][0]['training_coach']['status'], 'invalid')
        values = {v['key']: v for v in data['team_tactics']}
        for key in ('defwidth', 'defdepth', 'offwidth'):
            self.assertEqual(values[key]['status'], 'invalid')

    def test_personal_tactic_absence_is_not_reconstructed_as_default_zero(self):
        self.assertEqual(snapshot(players=[raw_player(strategy=None)])['players'][0]['personal_tactics'], {'status': 'missing', 'value': None})
        self.assertEqual(snapshot(players=[raw_player(strategy=[])])['players'][0]['personal_tactics'], {'status': 'unset', 'value': []})

    def test_saved_personal_tactic_strings_are_read_without_accepting_invalid_values(self):
        for role, strategy, expected in [('rb', [['SR', '2']], '오버랩'), ('rdm', [['DP', '1']], '센터 커버'),
                                         ('rs', [['SR', '1'], ['AR', '1']], '넓은 지역으로')]:
            player = snapshot(players=[raw_player(role=role, strategy=strategy)])['players'][0]
            self.assertEqual(player['personal_tactics']['status'], 'present')
            self.assertEqual(player['personal_tactics']['value'][0]['label'], expected)
        for value in ('1.0', '-1', '11', 'true', '', True):
            player = snapshot(players=[raw_player(strategy=[['IN', value]])])['players'][0]
            self.assertEqual(player['personal_tactics']['status'], 'invalid')

    def test_starters_and_substitutes_keep_separate_status(self):
        players = snapshot(players=[raw_player(state=1), raw_player(state=0), raw_player(state=None), raw_player(state=True)])['players']
        self.assertEqual([p['lineup_role'] for p in players], ['starter', 'substitute', 'unknown', 'unknown'])

    def test_private_account_identifiers_are_not_in_normalized_payload(self):
        raw = raw_feed(); raw['n8NexonSN'] = 'private-account'; raw['SquadInfo']['contents'] = 'untrusted text'
        text = json.dumps(normalize_snapshot(raw, FEED_ID, 'now'))
        self.assertNotIn('private-account', text)
        self.assertNotIn('untrusted text', text)
        self.assertIsNone(snapshot()['created_at'])
        self.assertIsNone(snapshot()['last_modified_at'])


class FeedLinkingTest(unittest.TestCase):
    def test_only_exact_card_grade_position_is_linked(self):
        result = link()
        self.assertEqual(result['summary']['linked'], 1)
        record = result['comparisons'][0]
        self.assertEqual(record['status'], 'matched')
        self.assertTrue(record['checks'][0]['setting_available'])
        self.assertFalse(result['historical_use_verified'])
        self.assertFalse(result['roster_fully_matched'])
        self.assertEqual(result['team_checks'], [])

    def test_each_mismatch_is_explained_and_has_no_attached_settings(self):
        for changed, expected in [({'spid': 54321}, 'card_mismatch'), ({'buildUp': 6}, 'grade_mismatch'), ({'role': 'st'}, 'position_mismatch')]:
            with self.subTest(expected=expected):
                result = link(snapshot(players=[raw_player(**changed)]))
                record = result['comparisons'][0]
                self.assertEqual(record['status'], expected)
                self.assertIsNone(record['settings'])
                self.assertEqual(record['checks'], [])

    def test_names_are_only_candidates_and_missing_players_are_distinct(self):
        result = link(snapshot(players=[raw_player(spid=54321, name='다른 선수')]))
        self.assertEqual(result['comparisons'][0]['status'], 'not_in_feed')
        self.assertEqual(result['summary']['not_in_feed'], 1)
        self.assertEqual(len(result['feed_only_players']), 1)

    def test_mode_author_and_unknown_context_prevent_linking(self):
        for feed, rows, mode in [(snapshot(mode=2), None, 60), (snapshot(mode=None), None, 60),
                                 (snapshot(), [replace(sample(), user_nickname='다른 구단주')] * 5, 60),
                                 (snapshot(), [sample()] * 5, 60)]:
            with self.subTest(mode=mode):
                result = link(feed, rows, mode)
                self.assertEqual(result['summary']['linked'], 0)
                self.assertIsNone(result['comparisons'][0]['settings'])

    def test_duplicate_exact_entries_are_ambiguous(self):
        result = link(snapshot(players=[raw_player(), raw_player()]))
        self.assertEqual(result['comparisons'][0]['status'], 'ambiguous')
        self.assertEqual(result['summary']['linked'], 0)

    def test_missing_identity_is_not_a_confirmed_grade_or_position_mismatch(self):
        for changed in ({'buildUp': None}, {'role': None}):
            with self.subTest(changed=changed):
                result = link(snapshot(players=[raw_player(**changed)]))
                self.assertEqual(result['comparisons'][0]['status'], 'identity_missing')
                self.assertIsNone(result['comparisons'][0]['settings'])

    def test_missing_coach_is_not_a_missing_equipment_diagnosis(self):
        result = link(snapshot(players=[raw_player(trainer=[-2, -2, -2])]))
        check = next(c for c in result['comparisons'][0]['checks'] if c['metric'] == 'dribble')
        self.assertFalse(check['setting_available'])
        self.assertIn('미장착으로 해석', check['action'])

    def test_manager_mode_never_recommends_manual_controls(self):
        result = link(snapshot(mode=2), mode=52)
        self.assertTrue(all('직접 조작을 교정하지 않습니다' in check['action'] for check in result['comparisons'][0]['checks']))

    def test_empty_match_sample_keeps_reference_and_no_link(self):
        coaching = build_position_coaching([], {'players': []}, POSITIONS)
        result = build_feed_coaching(snapshot(), coaching, [], 60)
        self.assertEqual(result['summary']['record_count'], 0)
        self.assertEqual(result['summary']['linked'], 0)

    def test_team_trials_require_full_starting_roster_and_are_not_added_in_manager_mode(self):
        positions = {0: 'GK', 3: 'RB', 4: 'RCB', 5: 'CB', 6: 'LCB', 7: 'LB', 10: 'CDM', 14: 'CM', 15: 'LCM', 18: 'CAM', 25: 'ST'}
        feed = snapshot(players=[raw_player(spid=12345 + i, role=role.lower()) for i, role in enumerate(positions.values())])
        players = [{**sample().player_stats[0], 'sp_id': 12345 + i, 'sp_position': position} for i, position in enumerate(positions)]
        rows = [replace(sample(), user_nickname='맹장축구', player_stats=players)] * 5
        coaching = build_position_coaching(rows, {'players': []}, positions)
        result = build_feed_coaching(feed, coaching, rows, 60)
        self.assertTrue(result['roster_fully_matched'])
        self.assertEqual(result['summary']['linked'], 11)
        self.assertEqual(result['team_checks'], [])
        feed['players'].append(snapshot(players=[raw_player(spid=99999, state=0)])['players'][0])
        self.assertTrue(build_feed_coaching(feed, coaching, rows, 60)['roster_fully_matched'])
        feed['mode'] = 2
        self.assertEqual(build_feed_coaching(feed, coaching, rows, 52)['team_checks'], [])


class FeedClientTest(unittest.TestCase):
    def setUp(self):
        self.cache = patch('app.services.squad_feed._cache', CacheClient()); self.cache.start()
        self.post = patch('app.services.squad_feed.requests.post'); self.http = self.post.start()
        self.http.return_value = Mock(status_code=200)

    def tearDown(self):
        self.post.stop(); self.cache.stop()

    def answer(self, data):
        self.http.return_value.json.return_value = {'ResultCode': 1, 'ResultData': data}

    def test_search_filters_partial_author_matches_and_uses_cached_page(self):
        item = {'strFeedId': FEED_ID, 'strWriterName': '맹장축구', 'strTitle': '맨유', 'dtCreateDate': '2026-07-31T10:27:47'}
        self.answer({'FeedList': [item, {**item, 'strWriterName': '맹장축구2'}], 'n4TotalCnt ': 12})
        result = search_public_feeds('맹장축구')
        self.assertEqual(len(result['items']), 1)
        self.assertTrue(result['has_more'])
        self.assertEqual(search_public_feeds('맹장축구'), result)
        self.assertEqual(self.http.call_count, 1)
        call = self.http.call_args
        self.assertEqual(call.args[0], 'https://fconline.nexon.com/squadmakerapi/SquadMakerFeedProc')
        self.assertFalse(call.kwargs['allow_redirects'])

    def test_invalid_id_and_out_of_range_page_make_no_external_request(self):
        for value in ('https://example.com/8ABCDEF0000000', '../secret', 'x'):
            with self.assertRaises(SquadFeedError): get_public_feed(value)
        with self.assertRaises(SquadFeedError): search_public_feeds('맹장축구', 21)
        with self.assertRaises(ValidationError): AnalysisRunRequest(ouid='test-ouid', match_type=60, squad_feed_id='../secret')
        self.http.assert_not_called()

    def test_fresh_lookup_does_not_use_cached_deleted_or_private_settings(self):
        self.answer(raw_feed()); get_public_feed(FEED_ID)
        self.http.return_value.status_code = 404
        with self.assertRaises(SquadFeedError): get_public_feed(FEED_ID, refresh=True)
        self.assertEqual(self.http.call_count, 2)
        with self.assertRaises(SquadFeedError): get_public_feed(FEED_ID)
        self.assertEqual(self.http.call_count, 3)

    def test_timeout_and_malformed_payloads_fail_closed(self):
        self.http.side_effect = requests.Timeout()
        with self.assertRaises(SquadFeedError): get_public_feed(FEED_ID)
        self.http.side_effect = None
        for data in ({}, {'SquadInfo': {}}, {'SquadInfo': {'players': None}}):
            self.answer(data)
            with self.assertRaises(SquadFeedError): get_public_feed(FEED_ID)


class FeedPersistenceTest(unittest.TestCase):
    @patch('app.services.analysis._spid_name_map', return_value={12345: '테스트 선수'})
    @patch('app.services.analysis._position_name_map', return_value=POSITIONS)
    @patch('app.services.analysis._season_meta_map', return_value={})
    @patch('app.services.analysis._load_official_rankers', return_value=[])
    @patch('app.services.analysis.build_action_explanation', return_value={})
    def test_connection_survives_latest_and_failure_never_reuses_previous_feed(self, *mocks):
        rows = [replace(sample(), user_nickname='맹장축구')] * 5
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'HABIT_LAB_DB_PATH': str(Path(directory) / 'test.db')}), patch('app.services.analysis._load_rows_for_analysis', return_value=(rows, 0, None, False)), patch('app.services.analysis.list_match_stats', return_value=rows):
            init_db()
            with patch('app.services.analysis.get_public_feed', return_value=snapshot()) as fetch:
                result = run_analysis('test-ouid', 60, 5, squad_feed_id=FEED_ID)
            fetch.assert_called_once_with(FEED_ID, refresh=True)
            self.assertEqual(result['tactic_input_mode'], 'missing')
            self.assertEqual(result['coaching']['squad_feed']['summary']['linked'], 1)
            self.assertEqual(get_latest_analysis('test-ouid', 60, 5)['coaching'], result['coaching'])
            with patch('app.services.analysis.get_public_feed', side_effect=SquadFeedError('조회 불가')):
                failed = run_analysis('test-ouid', 60, 5, squad_feed_id=FEED_ID)
            self.assertEqual(failed['coaching']['squad_feed']['status'], 'unavailable')
            self.assertNotIn('snapshot', failed['coaching']['squad_feed'])
            plain = run_analysis('test-ouid', 60, 5)
            self.assertNotIn('squad_feed', plain['coaching'])

    def test_busy_analysis_never_returns_another_selected_feed(self):
        from app.main import analysis_run
        request = Request({'type': 'http', 'client': ('127.0.0.1', 1), 'headers': []})
        req = AnalysisRunRequest(ouid='test-ouid', match_type=60, squad_feed_id=FEED_ID)
        with patch('app.main._enforce_rate_limit'), patch('app.main.cache.acquire_lock', return_value=None), patch('app.main.cache.get_json', return_value={'request_fingerprint': 'another-feed'}):
            with self.assertRaises(HTTPException) as error:
                analysis_run(request, req)
        self.assertEqual(error.exception.status_code, 429)


if __name__ == '__main__':
    unittest.main()
