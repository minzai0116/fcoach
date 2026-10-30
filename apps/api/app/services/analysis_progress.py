"""분석 요청의 실제 단계만 짧게 보관한다. 완료율이나 남은 시간은 추정하지 않는다."""
from contextlib import contextmanager
from contextvars import ContextVar
import time

from app.services.cache import CacheClient

_CACHE = CacheClient()
_CURRENT = ContextVar('analysis_progress', default=None)
STAGES = {
    'accepted': '분석 요청을 준비하고 있어요',
    'matches': '공식·친선 경기 기록을 불러오고 있어요',
    'feed': '선택한 피드의 선수·전술을 확인하고 있어요',
    'metrics': '선수·팀 지표를 계산하고 있어요',
    'rankers': '랭커 평균과 비교하고 있어요',
    'saving': '분석 결과를 정리하고 있어요',
}


def update_progress(stage):
    run = _CURRENT.get()
    if run is not None:
        _CACHE.set_json('analysis_progress:' + run['id'],
                        {'stage': stage, 'label': STAGES[stage], 'status': 'running', 'started': run['started']}, ttl_sec=600)


@contextmanager
def track_analysis_progress(progress_id):
    run = {'id': progress_id, 'started': time.time()} if progress_id else None
    token = _CURRENT.set(run)
    status = 'completed'
    try:
        update_progress('accepted')
        yield
    except Exception:
        status = 'failed'
        raise
    finally:
        if run is not None:
            _CACHE.set_json('analysis_progress:' + run['id'],
                            {'stage': status, 'label': '분석 완료' if status == 'completed' else '분석이 중단됐어요',
                             'status': status, 'started': run['started'], 'ended': time.time()}, ttl_sec=600)
        _CURRENT.reset(token)


def get_analysis_progress(progress_id):
    value = _CACHE.get_json('analysis_progress:' + progress_id)
    if value is None:
        return {'status': 'pending', 'stage': 'accepted', 'label': STAGES['accepted'], 'elapsed_seconds': 0}
    return {key: value[key] for key in ('status', 'stage', 'label')} | {
        'elapsed_seconds': max(0, int(value.get('ended', time.time()) - value['started']))}
