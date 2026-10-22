import json
import unittest
from unittest.mock import Mock, patch

import requests
from fastapi import HTTPException
from starlette.requests import Request

from app.services.openapi_client import NexonOpenApiClient, UserNotFoundError


def upstream_error(code, status=400):
    response = requests.Response()
    response.status_code = status
    response._content = json.dumps({'error': {'name': code}}).encode()
    return requests.HTTPError(response=response)


class SearchFeedbackTest(unittest.TestCase):
    def test_invalid_nickname_is_distinct_from_api_key_and_maintenance_errors(self):
        client = object.__new__(NexonOpenApiClient)
        for code in ('OPENAPI00003', 'OPENAPI00004'):
            with self.subTest(code=code), patch.object(client, '_get', side_effect=upstream_error(code)):
                with self.assertRaisesRegex(UserNotFoundError, '닉네임.*찾을 수 없습니다'):
                    client.find_user_by_nickname('없는닉네임')
        for code in ('OPENAPI00005', 'OPENAPI00009', 'OPENAPI00010'):
            with self.subTest(code=code), patch.object(client, '_get', side_effect=upstream_error(code)):
                with self.assertRaises(requests.HTTPError):
                    client.find_user_by_nickname('정상닉네임')

    def test_search_route_returns_korean_not_found_without_raw_upstream_url(self):
        from app.main import users_search
        request = Request({'type': 'http', 'headers': [], 'client': ('test', 1)})
        cache = Mock()
        cache.get_json.return_value = None
        cache.acquire_lock.return_value = 'test-lock'
        with patch('app.main.cache', cache), patch('app.main.get_user_lookup', return_value=None), \
             patch('app.main._enforce_rate_limit'), patch('app.main.NexonOpenApiClient') as factory:
            factory.cooldown_remaining_sec.return_value = 0
            factory.return_value.find_user_by_nickname.side_effect = UserNotFoundError('해당 닉네임의 구단주를 찾을 수 없습니다. 닉네임을 다시 확인해주세요.')
            with self.assertRaises(HTTPException) as raised:
                users_search(request, '없는닉네임')
            self.assertEqual(raised.exception.status_code, 404)
            self.assertIn('닉네임을 다시 확인', raised.exception.detail)
            self.assertNotIn('http', raised.exception.detail)
            cache.release_lock.assert_called_once()

    def test_empty_recent_matches_keep_valid_user_and_explicit_empty_message(self):
        from app.services.analysis import get_recent_matches
        with patch('app.services.analysis._load_rows_for_analysis', return_value=([], 0, '이 경기 모드에서 조회할 수 있는 경기 내역이 없습니다.', False)):
            result = get_recent_matches('valid-ouid', 60)
        self.assertEqual(result['items'], [])
        self.assertIn('경기 내역이 없습니다', result['sync_warning'])

    def test_empty_analysis_never_creates_a_zero_statistics_snapshot(self):
        from app.services.analysis import run_analysis
        with patch('app.services.analysis.purge_stale_nexon_api_data'), \
             patch('app.services.analysis._load_rows_for_analysis', return_value=([], 0, '조회할 수 있는 경기 내역이 없습니다.', False)), \
             patch('app.services.analysis.connect') as save:
            with self.assertRaisesRegex(ValueError, '경기 내역이 없습니다'):
                run_analysis('valid-ouid', 60, None)
            save.assert_not_called()


if __name__ == '__main__':
    unittest.main()
