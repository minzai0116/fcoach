import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException
from starlette.requests import Request

from app.models import AnalysisRunRequest
from app.services.analysis import run_analysis
from app.services.analysis_errors import AnalysisRequestError, MatchSyncWarning
from app.services.match_selection import select_match_sample
from test_match_selection import rows


class AnalysisErrorsTest(unittest.TestCase):
    def test_loader_marks_upstream_failure_without_parsing_display_text(self):
        from app.services.analysis import _load_rows_for_analysis
        from app.services.openapi_client import OpenApiRateLimitError
        with patch('app.services.analysis.list_match_stats', return_value=[]), \
             patch('app.services.analysis._list_match_stats_from_cache', return_value=[]), \
             patch('app.services.analysis._refresh_match_rows', side_effect=OpenApiRateLimitError('limited', 10)), \
             patch('app.services.analysis._available_match_stats', return_value=[]):
            _, _, warning, _ = _load_rows_for_analysis('test-ouid', 60, 30, True)
        self.assertIsInstance(warning, MatchSyncWarning)

    def test_expired_range_and_reversed_range_have_different_recovery(self):
        for kwargs, code, status in [({'start_match_id': 'missingmatch'}, 'match_range_expired', 409),
                                     ({'start_match_id': 'match0001', 'end_match_id': 'match0003'}, 'invalid_match_range', 400)]:
            with self.subTest(code=code), self.assertRaises(AnalysisRequestError) as raised:
                select_match_sample(rows(), None, **kwargs)
            self.assertEqual(raised.exception.code, code)
            self.assertEqual(raised.exception.status_code, status)

    def test_empty_history_and_upstream_failure_are_not_bad_input(self):
        for warning, code, status in [('조회할 수 있는 경기 내역이 없습니다.', 'no_match_history', 404),
                                     (MatchSyncWarning('Nexon Open API 호출 제한으로 최신 동기화에 실패했습니다.'), 'match_sync_unavailable', 503)]:
            with self.subTest(code=code), patch('app.services.analysis.purge_stale_nexon_api_data'), \
                 patch('app.services.analysis._load_rows_for_analysis', return_value=([], 0, warning, True)), \
                 self.assertRaises(AnalysisRequestError) as raised:
                run_analysis('test-ouid', 60, None, start_match_id='missingmatch')
            self.assertEqual(raised.exception.code, code)
            self.assertEqual(raised.exception.status_code, status)

    def test_forfeit_only_range_explains_filter_instead_of_sync_failure(self):
        with patch('app.services.analysis.purge_stale_nexon_api_data'), \
             patch('app.services.analysis._load_rows_for_analysis', return_value=(rows(), 0, None, False)), \
             self.assertRaises(AnalysisRequestError) as raised:
            run_analysis('test-ouid', 60, None, start_match_id='match0000')
        self.assertEqual(raised.exception.code, 'no_matching_matches')
        self.assertEqual(raised.exception.action, 'change_filters')

    def test_route_keeps_safe_reason_and_releases_lock_even_on_error(self):
        from app.main import analysis_run
        request = Request({'type': 'http', 'headers': [], 'client': ('test', 1)})
        for error, status in [(AnalysisRequestError('다시 선택해주세요.', 'match_range_expired', 'reload_matches', 409), 409),
                              (ValueError('private internal detail'), 500)]:
            cache = Mock()
            cache.acquire_lock.return_value = 'token'
            with self.subTest(status=status), patch('app.main.cache', cache), patch('app.main._enforce_rate_limit'), \
                 patch('app.main.run_analysis', side_effect=error), self.assertRaises(HTTPException) as raised:
                analysis_run(request, AnalysisRunRequest(ouid='test-ouid', match_type=60))
            self.assertEqual(raised.exception.status_code, status)
            self.assertIn('code', raised.exception.detail)
            self.assertNotIn('private', str(raised.exception.detail))
            cache.release_lock.assert_called_once()
