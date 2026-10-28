from dataclasses import replace
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from app.db import init_db
from app.services.match_selection import select_match_sample
from app.services.analysis import run_analysis, get_latest_analysis
from test_position_coaching import sample, POSITIONS


def rows():
    return [replace(sample(), match_id=f'match000{i}', match_end_type=end, match_date=f'2026-10-{19-i:02d}T00:00:00+00:00')
            for i, end in enumerate([1, 0, 2, 0, -1, 0])]


class MatchSelectionTest(unittest.TestCase):
    def test_range_includes_both_boundaries_and_applies_forfeit_filter(self):
        selected, meta = select_match_sample(rows(), None, start_match_id='match0005', end_match_id='match0001')
        self.assertEqual([r.match_id for r in selected], ['match0001', 'match0003', 'match0005'])
        self.assertEqual(meta['end_match_id'], 'match0001')
        selected, _ = select_match_sample(rows(), None, start_match_id='match0003', end_match_id='match0002', include_forfeit_losses=True)
        self.assertEqual([r.match_id for r in selected], ['match0002', 'match0003'])

    def test_range_is_not_silently_capped_at_thirty(self):
        data = [replace(sample(), match_id=f'match{i:04}', match_end_type=0) for i in range(45)]
        selected, _ = select_match_sample(data, None, start_match_id='match0040', end_match_id='match0000')
        self.assertEqual(len(selected), 41)

    def test_same_match_range_and_invalid_end_boundary(self):
        selected, _ = select_match_sample(rows(), None, start_match_id='match0001', end_match_id='match0001')
        self.assertEqual([r.match_id for r in selected], ['match0001'])
        with self.assertRaisesRegex(ValueError, '종료 경기'):
            select_match_sample(rows(), None, start_match_id='match0001', end_match_id='match0003')
        with self.assertRaisesRegex(ValueError, '종료 경기'):
            select_match_sample(rows(), None, end_match_id='missingmatch')

    def test_forfeit_win_and_loss_options_are_independent(self):
        for wins, losses, ids in [(False, False, [1, 3, 5]), (True, False, [0, 1, 3, 5]),
                                  (False, True, [1, 2, 3, 5]), (True, True, [0, 1, 2, 3, 5])]:
            with self.subTest(wins=wins, losses=losses):
                selected, meta = select_match_sample(rows(), 30, include_forfeit_wins=wins, include_forfeit_losses=losses)
                self.assertEqual([r.match_id for r in selected], [f'match000{i}' for i in ids])
                self.assertEqual(meta['normal_count'], 3)
                self.assertEqual(meta['forfeit_win_count'], int(wins))
                self.assertEqual(meta['forfeit_loss_count'], int(losses))

    def test_start_boundary_is_inclusive_then_filter_then_limit(self):
        selected, meta = select_match_sample(rows(), 5, start_match_id='match0002')
        self.assertEqual([r.match_id for r in selected], ['match0001'])
        self.assertEqual(meta['available_count'], 3)
        self.assertEqual(meta['start_match_date'], rows()[2].match_date)
        selected, _ = select_match_sample(rows(), 2, include_forfeit_wins=True, include_forfeit_losses=True, start_match_id='match0003')
        self.assertEqual([r.match_id for r in selected], ['match0000', 'match0001'])

    def test_unknown_boundary_rejects_instead_of_using_recent_games(self):
        with self.assertRaisesRegex(ValueError, '시작 경기'):
            select_match_sample(rows(), 5, start_match_id='expiredmatch')

    def test_empty_selection_does_not_fill_from_before_boundary(self):
        selected, meta = select_match_sample(rows(), 30, start_match_id='match0000')
        self.assertEqual(selected, [])
        self.assertEqual(meta['eligible_count'], 0)

    def test_match_id_disambiguates_equal_times(self):
        data = [replace(r, match_date=rows()[0].match_date) for r in rows()]
        selected, _ = select_match_sample(data, 30, start_match_id='match0001')
        self.assertEqual([r.match_id for r in selected], ['match0001'])


class SelectionPersistenceTest(unittest.TestCase):
    @patch('app.services.analysis._spid_name_map', return_value={12345: '테스트 선수'})
    @patch('app.services.analysis._position_name_map', return_value=POSITIONS)
    @patch('app.services.analysis._season_meta_map', return_value={})
    @patch('app.services.analysis._load_official_rankers', return_value=[])
    @patch('app.services.analysis.build_action_explanation', return_value={})
    def test_latest_preserves_options_and_actual_sample_when_new_matches_arrive(self, *mocks):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'HABIT_LAB_DB_PATH': str(Path(folder)/'test.db')}), patch('app.services.analysis._load_rows_for_analysis', return_value=(rows(), 0, None, False)):
            init_db()
            result = run_analysis('test-ouid', 60, 5, include_forfeit_losses=True, start_match_id='match0003')
            self.assertEqual(result['sample_count'], 3)
            self.assertEqual(result['coaching']['sample_count'], 3)
            self.assertEqual(result['sample_count'], 3)
            self.assertEqual(result['coaching']['passing']['sample_count'], 3)
            self.assertEqual(result['coaching']['players'][0]['appearances'], 3)
            self.assertEqual(result['sample_selection']['forfeit_loss_count'], 1)
            with patch('app.services.analysis.list_match_stats', return_value=[]):
                latest = get_latest_analysis('test-ouid', 60, 5)
            self.assertEqual(latest, result)
            plain = run_analysis('test-ouid', 60, 5)
            self.assertEqual(plain['sample_count'], 3)
            self.assertEqual(plain['sample_scope'], 'completed_only')
            self.assertEqual(plain['coaching']['sample_count'], 3)
            self.assertIsNone(plain['sample_selection']['start_match_id'])
            with self.assertRaisesRegex(ValueError, '경기 내역이 없습니다'):
                run_analysis('test-ouid', 60, 5, start_match_id='match0000')

    def test_request_validation_rejects_unbounded_start_ids(self):
        from app.models import AnalysisRunRequest
        from pydantic import ValidationError
        for mid in ('../secret', 'x'*129):
            with self.assertRaises(ValidationError):
                AnalysisRunRequest(ouid='test-ouid', match_type=60, start_match_id=mid)

    def test_recent_match_route_accepts_query_numbers_and_rejects_unknown_modes(self):
        import asyncio
        from app.main import app
        async def request(mode):
            messages = []
            async def receive():
                await asyncio.Event().wait()
            async def send(message):
                messages.append(message)
            scope = {'type': 'http', 'http_version': '1.1', 'method': 'GET', 'scheme': 'http',
                     'path': '/matches/recent', 'root_path': '', 'headers': [],
                     'query_string': f'ouid=test-ouid&match_type={mode}'.encode(), 'client': ('127.0.0.1', 1)}
            await app(scope, receive, send)
            return next(m['status'] for m in messages if m['type'] == 'http.response.start')
        with patch('app.main.get_recent_matches', return_value={'items': []}) as fetch, patch('app.main._enforce_rate_limit'):
            self.assertEqual(asyncio.run(request(60)), 200)
            fetch.assert_called_once_with('test-ouid', 60)
            self.assertEqual(asyncio.run(request(51)), 400)
