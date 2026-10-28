import unittest
from unittest.mock import Mock, patch

import requests

from app.services.analysis import _build_visual_summary
from app.services.player_names import PlayerNameCatalog, name_index, player_name
from app.services.position_coaching import build_position_coaching
from test_position_coaching import POSITIONS, sample


class PlayerNamesTest(unittest.TestCase):
    def test_new_season_uses_consistent_official_player_identity(self):
        names = name_index([{'id': 252238794, 'name': '비니시우스'}, {'id': 252205452, 'name': '안토니오 뤼디거'}])
        self.assertEqual(player_name(names, 856238794), '비니시우스')
        self.assertEqual(player_name(names, 852205452), '안토니오 뤼디거')
        self.assertEqual(player_name(names, 999999999), '이름 확인 중')

    def test_conflicting_names_never_create_a_player_identity_fallback(self):
        names = name_index([{'id': 101234567, 'name': '선수 A'}, {'id': 102234567, 'name': '선수 B'}, {}, None])
        self.assertEqual(player_name(names, 101234567), '선수 A')
        self.assertEqual(player_name(names, 103234567), '이름 확인 중')

    def test_failed_first_fetch_is_retried_and_success_refreshes_after_an_hour(self):
        clock = Mock(return_value=0)
        loader = Mock(side_effect=[requests.Timeout(), [{'id': 856238794, 'name': '비니시우스'}], [{'id': 856238794, 'name': '갱신 이름'}]])
        catalog = PlayerNameCatalog(loader, clock)
        self.assertEqual(catalog.get(), {})
        clock.return_value = 30
        self.assertEqual(catalog.get(), {})
        self.assertEqual(loader.call_count, 1)
        clock.return_value = 60
        self.assertEqual(player_name(catalog.get(), 856238794), '비니시우스')
        clock.return_value = 3659
        self.assertEqual(player_name(catalog.get(), 856238794), '비니시우스')
        clock.return_value = 3660
        self.assertEqual(player_name(catalog.get(), 856238794), '갱신 이름')
        self.assertEqual(loader.call_count, 3)

    def test_refresh_failure_keeps_last_good_names_and_retries(self):
        clock = Mock(return_value=0)
        loader = Mock(side_effect=[[{'id': 852205452, 'name': '안토니오 뤼디거'}], {}, requests.Timeout(), [{'id': 852205452, 'name': '뤼디거'}]])
        catalog = PlayerNameCatalog(loader, clock)
        catalog.get()
        for now in (3600, 3660):
            clock.return_value = now
            self.assertEqual(player_name(catalog.get(), 852205452), '안토니오 뤼디거')
        clock.return_value = 3720
        self.assertEqual(player_name(catalog.get(), 852205452), '뤼디거')

    @patch('app.services.analysis._season_meta_map', return_value={})
    @patch('app.services.analysis._position_name_map', return_value=POSITIONS)
    def test_feed_names_propagate_to_report_coaching_and_shots(self, *_):
        rows = [sample()]
        rows[0].shots_for_points = [{'sp_id': 12345, 'x': .8, 'y': .5}]
        names = name_index([{'sp_id': 12345, 'name': '피드 선수'}], 'sp_id')
        visuals = _build_visual_summary(rows, names)
        coaching = build_position_coaching(rows, visuals['player_report'], POSITIONS, player_names=names)
        self.assertEqual(visuals['player_report']['players'][0]['player_name'], '피드 선수')
        self.assertEqual(coaching['players'][0]['player_name'], '피드 선수')
        self.assertEqual(visuals['shot_map'][0]['player_name'], '피드 선수')
