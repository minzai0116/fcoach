from types import SimpleNamespace
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

    def test_current_uses_latest_official_record_not_highest_or_friendly(self):
        rows = [SimpleNamespace(match_date='2026-10-29T00:00:00Z', match_id='new', coaching_data={'division': 1200}),
                SimpleNamespace(match_date='2026-10-01T00:00:00Z', match_id='old', coaching_data={'division': 1100})]
        with patch.object(profiles, 'NexonOpenApiClient', return_value=self.client), \
             patch('app.services.analysis._available_match_stats', return_value=rows) as lookup:
            result = profiles.get_user_divisions('user-id-123')
            lookup.assert_called_once_with('user-id-123', 50)
            self.assertEqual(result['current']['name'], '슈퍼챌린지')
            self.assertEqual(result['highest']['name'], '챔피언스')
            self.client.fetch_match_ids.assert_not_called()
            self.assertEqual(profiles.get_user_divisions('user-id-123'), result)
            self.assertEqual(self.client._get.call_count, 2)

    def test_no_cached_official_record_fetches_one_latest_match_and_checks_owner(self):
        self.client.fetch_match_ids.return_value = ['latest-match']
        self.client.fetch_match_detail.return_value = {'matchDate': '2026-10-30T00:00:00', 'matchInfo': [
            {'ouid': 'other', 'division': 1100}, {'ouid': 'user-id-123', 'division': 1200}]}
        with patch.object(profiles, 'NexonOpenApiClient', return_value=self.client), \
             patch('app.services.analysis._available_match_stats', return_value=[]):
            result = profiles.get_user_divisions('user-id-123')
        self.client.fetch_match_ids.assert_called_once_with('user-id-123', 50, limit=1)
        self.assertEqual(result['current']['name'], '슈퍼챌린지')

    def test_missing_current_never_uses_highest_as_current(self):
        self.client.fetch_match_ids.return_value = []
        with patch.object(profiles, 'NexonOpenApiClient', return_value=self.client), \
             patch('app.services.analysis._available_match_stats', return_value=[]):
            result = profiles.get_user_divisions('user-id-123')
        self.assertIsNone(result['current']['name'])
        self.assertEqual(result['highest']['name'], '챔피언스')

    def test_missing_credentials_do_not_block_analysis_or_invent_a_tier(self):
        with patch.object(profiles, 'NexonOpenApiClient', side_effect=RuntimeError('No key')):
            result = profiles.get_user_divisions('user-id-123')
        self.assertIsNone(result['current']['name'])
        self.assertIsNone(result['highest']['name'])
