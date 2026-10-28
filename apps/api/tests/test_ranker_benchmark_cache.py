from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch

from app.services import ranker_benchmark as benchmark


def snapshot(days=0):
    return {'status': 'available', 'ranker_count': 20,
            'ranking_fetched_at': (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()}


class RankerBenchmarkCacheTest(unittest.TestCase):
    @patch.object(benchmark, '_CACHE')
    def test_cold_instance_reuses_last_real_snapshot(self, cache):
        saved = snapshot(1)
        cache.get_json.side_effect = lambda key: saved if key == benchmark.LAST_VALID_KEY else None
        self.assertEqual(benchmark.get_ranker_benchmark(), saved)
        self.assertIsNone(benchmark.cached_ranker_benchmark(max_age_hours=24))

    @patch.object(benchmark, 'list_official_rankers', return_value=[])
    @patch.object(benchmark, '_CACHE')
    def test_empty_refresh_preserves_real_snapshot(self, cache, _):
        saved = snapshot(1)
        cache.get_json.return_value = saved
        self.assertEqual(benchmark.get_ranker_benchmark(refresh=True), saved)
        cache.set_json.assert_not_called()

    @patch.object(benchmark, '_CACHE')
    def test_expired_snapshot_is_not_used_or_extended(self, cache):
        cache.get_json.return_value = snapshot(31)
        self.assertIsNone(benchmark.cached_ranker_benchmark())
        benchmark.store_ranker_benchmark(snapshot(31))
        cache.set_json.assert_not_called()

    @patch.object(benchmark, '_CACHE')
    def test_storage_respects_source_retention_and_keeps_timestamp(self, cache):
        saved = snapshot(2)
        benchmark.store_ranker_benchmark(saved)
        self.assertEqual(cache.set_json.call_args_list[0].args, (benchmark.CACHE_KEY, saved))
        backup = cache.set_json.call_args_list[1]
        self.assertEqual(backup.args, (benchmark.LAST_VALID_KEY, saved))
        self.assertLessEqual(backup.kwargs['ttl_sec'], 28 * 86400)
        self.assertGreater(backup.kwargs['ttl_sec'], 27 * 86400)

    @patch.object(benchmark, '_BUNDLED_SNAPSHOT')
    @patch.object(benchmark, '_CACHE')
    def test_bundled_real_aggregate_primes_empty_deployment(self, cache, bundled):
        import json
        cache.get_json.return_value = None
        saved = snapshot(1)
        bundled.read_text.return_value = json.dumps(saved)
        self.assertEqual(benchmark.prime_ranker_benchmark(), saved)
        self.assertEqual(cache.set_json.call_count, 2)

    @patch.object(benchmark, '_BUNDLED_SNAPSHOT')
    @patch.object(benchmark, '_CACHE')
    def test_bundled_aggregate_cannot_extend_expired_data(self, cache, bundled):
        import json
        cache.get_json.return_value = None
        bundled.read_text.return_value = json.dumps(snapshot(31))
        self.assertIsNone(benchmark.prime_ranker_benchmark())
        cache.set_json.assert_not_called()
