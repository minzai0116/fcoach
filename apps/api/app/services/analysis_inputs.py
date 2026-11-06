from concurrent.futures import ThreadPoolExecutor

from app.services.squad_feed import SquadFeedError


def load_analysis_inputs(load_rows, metadata_loaders, load_feed=None):
    """독립적인 외부 조회를 겹치되, 피드 실패를 경기 기록 실패와 구분한다."""
    def feed():
        try:
            return load_feed(), None
        except SquadFeedError as error:
            return None, str(error)

    with ThreadPoolExecutor(max_workers=2 + len(metadata_loaders)) as pool:
        rows = pool.submit(load_rows)
        metadata = {key: pool.submit(loader) for key, loader in metadata_loaders.items()}
        snapshot = pool.submit(feed) if load_feed else None
        return (rows.result(),
                {key: future.result() for key, future in metadata.items()},
                snapshot.result() if snapshot else (None, None))
