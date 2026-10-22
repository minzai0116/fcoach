from dataclasses import replace
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from app.db import init_db
from app.services.analysis import create_experiment, evaluate_latest_experiment
from test_position_coaching import sample


class TrackingRefreshTest(unittest.TestCase):
    def test_refresh_fetches_matches_itself_and_compares_only_normal_matches(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'HABIT_LAB_DB_PATH': str(Path(folder) / 'test.db')}):
            init_db()
            create_experiment({'ouid': 'test-ouid', 'match_type': 60, 'action_code': 'BUILDUP_INEFFICIENCY',
                               'action_title': '가까운 지원 선수에게 연결', 'window_size': 10, 'started_at': '2026-10-20T00:00:00Z'})
            rows = [replace(sample(), match_id=f'post{i}', match_date='2026-10-21T00:00:00Z') for i in range(3)]
            rows += [replace(sample(), match_id='forfeit', match_date='2026-10-21T01:00:00Z', match_end_type=1)]
            rows += [replace(sample(), match_id=f'pre{i}', match_date='2026-10-19T00:00:00Z') for i in range(5)]
            with patch('app.services.analysis._load_rows_for_analysis', return_value=(rows, 3, None, True)) as refresh:
                result = evaluate_latest_experiment('test-ouid', 60)
            self.assertTrue(refresh.call_args.kwargs['live_sync_enabled'])
            self.assertTrue(refresh.call_args.kwargs['manual_refresh_probe'])
            self.assertEqual(result['pre_match_count'], 5)
            self.assertEqual(result['post_match_count'], 3)
            self.assertEqual(result['sync_new_rows'], 3)
            self.assertEqual(result['sample_scope'], 'completed_only')


if __name__ == '__main__':
    unittest.main()
