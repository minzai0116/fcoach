from datetime import date
import unittest
from unittest.mock import Mock, patch

from app.services import user_divisions as profiles
from app.services.cache import CacheClient


class UserDivisionTest(unittest.TestCase):
    def test_official_emblems_match_tiers_across_master_code_gap(self):
        for code, image in [(800, 0), (1300, 5), (1700, 6), (2000, 9), (3100, 20)]:
            tier = profiles._tier(code, {code: '공식 등급'}, None, 'test')
            self.assertTrue(tier['icon_url'].endswith(f'/update_2026/ico_rank{image}.png'))
        self.assertIsNone(profiles._tier(9999, {9999: '새 등급'}, None, 'test')['icon_url'])
        self.assertIsNone(profiles._tier(None, {}, None, 'test')['icon_url'])

    def setUp(self):
        self.cache = patch.object(profiles, '_CACHE', CacheClient())
        self.cache.start()
        self.addCleanup(self.cache.stop)
        self.client = Mock()
        self.client._get.side_effect = lambda path, params: (
            [{'divisionId': 1100, 'divisionName': '챔피언스'}, {'divisionId': 1200, 'divisionName': '슈퍼챌린지'}]
            if 'static' in path else [{'matchType': 52, 'division': 1100}, {'matchType': 50, 'division': 1100, 'achievementDate': '2026-08-01T00:00:00'}])
        self.client.fetch_match_ids.return_value = ['latest-match']
        self.client.fetch_match_detail.return_value = {'matchType': 50, 'matchDate': '2026-10-30T00:00:00', 'matchInfo': [
            {'ouid': 'other', 'division': 1100}, {'ouid': 'user-id-123', 'division': 1200}]}

    def _lookup(self, season_end=date(2026, 10, 29)):
        with patch.object(profiles, 'NexonOpenApiClient', return_value=self.client), \
             patch.object(profiles, '_previous_season_end', return_value=season_end):
            return profiles.get_user_divisions('user-id-123')

    def test_current_uses_latest_official_record_not_highest_or_friendly(self):
        result = self._lookup()
        self.client.fetch_match_ids.assert_called_once_with('user-id-123', 50, limit=1)
        self.assertEqual(result['current']['name'], '슈퍼챌린지')
        self.assertEqual(result['highest']['name'], '챔피언스')
        self.assertEqual(self._lookup(), result)
        self.client.fetch_match_detail.assert_called_once_with('latest-match')

    def test_new_season_does_not_reuse_cached_tier_or_last_season_match(self):
        self.assertEqual(self._lookup(date(2026, 9, 10))['current']['status'], 'available')
        result = self._lookup(date(2026, 11, 12))
        self.assertEqual(result['current']['status'], 'no_current_season_match')
        self.assertIsNone(result['current']['name'])
        self.assertEqual(result['highest']['name'], '챔피언스')

    def test_match_on_season_change_day_keeps_tier_unverified(self):
        self.client.fetch_match_detail.return_value['matchDate'] = '2026-10-28T23:00:00'
        self.assertEqual(self._lookup()['current']['status'], 'unavailable')

    def test_unknown_season_keeps_highest_tier_available(self):
        result = self._lookup(None)
        self.assertEqual(result['current']['status'], 'unavailable')
        self.assertEqual(result['highest']['name'], '챔피언스')
        self.client.fetch_match_ids.assert_not_called()

    def test_missing_current_never_uses_highest_as_current(self):
        self.client.fetch_match_ids.return_value = []
        result = self._lookup()
        self.assertEqual(result['current']['status'], 'no_current_season_match')
        self.assertEqual(result['highest']['name'], '챔피언스')

    def test_previous_season_end_is_taken_from_official_1v1_selector_and_cached(self):
        html = '''<div class="wrap_season"><a class="club_item" onclick="ChangeSeason(0);">현재 시즌</a>
        <a class="selector_item" onclick="ChangeSeason(93);">시즌 5 (2026-09-10~2026-10-29)</a></div>'''
        with patch.object(profiles.requests, 'get', return_value=Mock(text=html)) as get:
            for _ in range(2):
                self.assertEqual(profiles._previous_season_end(date(2026, 11, 15)), date(2026, 10, 29))
            get.assert_called_once_with(profiles._OFFICIAL_RANK_URL, params={'rt': '1vs1'}, timeout=4)

    def test_missing_credentials_do_not_block_analysis_or_invent_a_tier(self):
        with patch.object(profiles, 'NexonOpenApiClient', side_effect=RuntimeError('No key')), \
             patch.object(profiles, '_previous_season_end', return_value=date(2026, 10, 29)):
            result = profiles.get_user_divisions('user-id-123')
        self.assertIsNone(result['current']['name'])
        self.assertIsNone(result['highest']['name'])
