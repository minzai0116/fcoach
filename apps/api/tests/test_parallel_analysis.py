import os
import threading
import unittest
from unittest.mock import Mock, patch

from app.services.analysis_inputs import load_analysis_inputs
from app.services.nexon_requests import RequestPacer
from app.services.openapi_client import NexonOpenApiClient, OpenApiRateLimitError
from app.services.squad_feed import SquadFeedError
from test_openapi_client import StubOpenApiClient, _match_payload


class ParallelAnalysisTest(unittest.TestCase):
    def test_details_overlap_keep_order_and_do_not_fetch_past_the_target(self):
        ids = [f'match{i}' for i in range(9)]
        client = StubOpenApiClient(ids, {key: _match_payload('user', 1) for key in ids})
        barrier = threading.Barrier(4)
        original = client.fetch_match_detail
        def detail(key):
            barrier.wait(timeout=2)
            return original(key)
        client.fetch_match_detail = detail
        rows = client.collect_match_rows('user', 60, total_match_target=4)
        self.assertEqual([r['match_id'] for r in rows], ids[:4])
        self.assertCountEqual(client.fetched_details, ids[:4])

    def test_incremental_sync_stops_before_known_records_even_with_parallel_fetch(self):
        ids = ['new1', 'new2', 'known', 'older']
        client = StubOpenApiClient(ids, {key: _match_payload('user', 1) for key in ids})
        rows = client.collect_incremental_match_rows('user', 60, {'known'})
        self.assertEqual([r['match_id'] for r in rows], ids[:2])
        self.assertCountEqual(client.fetched_details, ids[:2])

    def test_detail_failure_does_not_continue_into_the_next_batch(self):
        client = StubOpenApiClient(list(map(str, range(12))), {})
        client.fetch_match_detail = Mock(side_effect=OpenApiRateLimitError('limited', 2))
        with self.assertRaises(OpenApiRateLimitError):
            client.collect_match_rows('user', 60, total_match_target=12)
        self.assertLessEqual(client.fetch_match_detail.call_count, 4)

    def test_sessions_are_isolated_per_worker_and_closed_after_fetch(self):
        barrier, sessions, thread_ids = threading.Barrier(4), [], {}
        def make_session():
            session = Mock(headers={})
            def get(url, params, timeout):
                thread_ids[id(session)] = threading.get_ident()
                barrier.wait(timeout=2)
                return Mock(status_code=200, json=lambda: {'match_id': params['matchid']})
            session.get.side_effect = get
            sessions.append(session)
            return session
        with patch.dict(os.environ, {'NEXON_OPEN_API_KEY': 'test-only'}), \
             patch('app.services.openapi_client.requests.Session', side_effect=make_session), \
             patch('app.services.openapi_client.REQUEST_PACER.acquire'), \
             patch.object(NexonOpenApiClient, 'cooldown_remaining_sec', return_value=0):
            client = NexonOpenApiClient(retries=1)
            self.assertEqual(client._fetch_match_details(['1', '2', '3', '4']),
                             [{'match_id': str(i)} for i in range(1, 5)])
        self.assertEqual(len(thread_ids), 4)
        self.assertEqual(len(set(thread_ids.values())), 4)
        for session in sessions[1:]:
            session.close.assert_called_once()
        sessions[0].get.assert_not_called()

    def test_rate_gate_reserves_distinct_slots_and_has_a_safe_default(self):
        waits = []
        pacer = RequestPacer(clock=lambda: 0, sleep=waits.append)
        with patch.dict(os.environ, {'HABIT_LAB_NEXON_REQUESTS_PER_SECOND': '4'}):
            for _ in range(4):
                pacer.acquire()
        self.assertEqual(waits, [.25, .5, .75])

    def test_feed_and_metadata_start_before_matches_finish_and_feed_failures_are_explicit(self):
        barrier = threading.Barrier(3)
        def rows():
            barrier.wait(timeout=2)
            return ['complete-records']
        def names():
            barrier.wait(timeout=2)
            return {1: 'name'}
        def feed():
            barrier.wait(timeout=2)
            raise SquadFeedError('deleted feed', 404)
        loaded, metadata, (snapshot, error) = load_analysis_inputs(rows, {'names': names}, feed)
        self.assertEqual(loaded, ['complete-records'])
        self.assertEqual(metadata, {'names': {1: 'name'}})
        self.assertIsNone(snapshot)
        self.assertEqual(error, 'deleted feed')


if __name__ == '__main__':
    unittest.main()
