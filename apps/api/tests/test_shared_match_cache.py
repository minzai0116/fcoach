from dataclasses import replace
import unittest
from unittest.mock import patch

from app.services.analysis import _merge_match_stats, _load_rows_for_analysis
from test_position_coaching import sample


class SharedMatchCacheTest(unittest.TestCase):
    def test_equal_times_have_same_order_across_instances(self):
        first = replace(sample(), match_id='first')
        second = replace(sample(), match_id='second', match_date=first.match_date)
        self.assertEqual([r.match_id for r in _merge_match_stats([first], [second])],
                         [r.match_id for r in _merge_match_stats([second], [first])])

    def test_refresh_preserves_rows_loaded_before_cache_changes(self):
        from app.services.analysis import _refresh_match_rows
        existing = replace(sample(), match_id='existing')
        with patch('app.services.analysis.NexonOpenApiClient') as api, \
             patch('app.services.analysis._latest_known_match_ids', return_value=['existing']), \
             patch('app.services.analysis._cached_match_ids', return_value=set()), \
             patch('app.services.analysis._available_match_stats', return_value=[]):
            api.return_value.collect_incremental_match_rows.return_value = []
            rows, count = _refresh_match_rows('test-ouid', 60, 1, [existing])
        self.assertEqual([r.match_id for r in rows], ['existing'])
        self.assertEqual(count, 0)

    def test_partial_instance_data_and_shared_cache_are_merged_once_in_date_order(self):
        latest = replace(sample(), match_id='latest', match_date='2026-10-22T00:00:00Z')
        older = replace(sample(), match_id='older', match_date='2026-10-21T00:00:00Z')
        stale_duplicate = replace(latest, goals_for=999)
        rows = _merge_match_stats([latest], [stale_duplicate, older])
        self.assertEqual([row.match_id for row in rows], ['latest', 'older'])
        self.assertEqual(rows[0].goals_for, latest.goals_for)

    def test_existing_local_rows_never_hide_shared_games_from_range_selection(self):
        latest = replace(sample(), match_id='latest', match_date='2026-10-22T00:00:00Z')
        older = replace(sample(), match_id='older', match_date='2026-10-21T00:00:00Z')
        with patch('app.services.analysis.list_match_stats', return_value=[latest]), \
             patch('app.services.analysis._list_match_stats_from_cache', return_value=[older]):
            rows, _, _, _ = _load_rows_for_analysis('test-ouid', 60, 2, False)
        self.assertEqual([row.match_id for row in rows], ['latest', 'older'])
