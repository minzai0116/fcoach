from concurrent.futures import ThreadPoolExecutor
import unittest
from unittest.mock import patch

from app.services import analysis_progress as progress
from app.services.cache import CacheClient


class AnalysisProgressTest(unittest.TestCase):
    def setUp(self):
        self.cache = patch.object(progress, '_CACHE', CacheClient())
        self.cache.start()
        self.addCleanup(self.cache.stop)

    def test_only_actual_stage_updates_are_reported_and_elapsed_time_is_frozen_on_completion(self):
        with patch.object(progress.time, 'time', return_value=100):
            with progress.track_analysis_progress('a' * 32):
                progress.update_progress('matches')
                self.assertEqual(progress.get_analysis_progress('a' * 32)['stage'], 'matches')
                progress.update_progress('rankers')
                self.assertEqual(progress.get_analysis_progress('a' * 32)['stage'], 'rankers')
            result = progress.get_analysis_progress('a' * 32)
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['elapsed_seconds'], 0)
        self.assertEqual(set(result), {'status', 'stage', 'label', 'elapsed_seconds'})
        self.assertNotIn('percent', result)

    def test_failure_is_terminal_and_does_not_expose_exception_details(self):
        with self.assertRaisesRegex(RuntimeError, 'private'):
            with progress.track_analysis_progress('b' * 32):
                raise RuntimeError('private user data')
        result = progress.get_analysis_progress('b' * 32)
        self.assertEqual(result['status'], 'failed')
        self.assertNotIn('private', str(result))

    def test_missing_job_does_not_report_fake_completion(self):
        self.assertEqual(progress.get_analysis_progress('missing')['status'], 'pending')

    def test_parallel_runs_and_untracked_calls_do_not_overwrite_each_other(self):
        def run(key, stage):
            with progress.track_analysis_progress(key):
                progress.update_progress(stage)
                return progress.get_analysis_progress(key)['stage']
        with ThreadPoolExecutor(max_workers=2) as pool:
            one = pool.submit(run, 'c' * 32, 'feed')
            two = pool.submit(run, 'd' * 32, 'metrics')
            self.assertEqual(one.result(), 'feed')
            self.assertEqual(two.result(), 'metrics')
        progress.update_progress('matches')
        self.assertEqual(progress.get_analysis_progress('c' * 32)['status'], 'completed')

    def test_api_progress_id_does_not_change_identical_analysis_cache_identity(self):
        from starlette.requests import Request
        from fastapi import HTTPException
        from pydantic import ValidationError
        from app.models import AnalysisRunRequest
        from app import main
        cache = CacheClient()
        request = Request({'type': 'http', 'method': 'POST', 'path': '/analysis/run', 'headers': [], 'client': ('127.0.0.1', 3000)})
        body = {'ouid': 'test-user-123', 'match_type': 0, 'window': 30, 'progress_id': 'e' * 32}
        with patch.object(main, 'cache', cache), patch.object(main, '_enforce_rate_limit'), \
             patch.object(main, '_trigger_match_sync_async'), \
             patch.object(main, 'run_analysis', return_value={'actions': []}) as run:
            self.assertEqual(main.analysis_run(request, AnalysisRunRequest(**body))['actions'], [])
            self.assertEqual(main.analysis_progress(request, body['progress_id'])['status'], 'completed')
            with patch.object(cache, 'acquire_lock', return_value=None):
                response = main.analysis_run(request, AnalysisRunRequest(**{**body, 'progress_id': 'f' * 32}))
                self.assertEqual(response['actions'], [])
            self.assertEqual(run.call_count, 1)
        with self.assertRaises(HTTPException) as invalid:
            main.analysis_progress(request, 'not-valid')
        self.assertEqual(invalid.exception.status_code, 404)
        with self.assertRaises(ValidationError):
            AnalysisRunRequest(**{**body, 'progress_id': 'not-valid'})
