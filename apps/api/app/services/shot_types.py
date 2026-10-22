from __future__ import annotations

# 2026-10-20 공식 매치 문서에 정의된 코드만 이름으로 변환한다.
SHOT_TYPES = {
    1: '일반 슈팅', 2: '감아차기', 3: '헤딩 슈팅', 4: '로빙슛',
    5: '플레어슛', 6: '낮은 슛', 7: '발리슛', 8: '프리킥',
    9: '페널티킥', 10: '무회전슛', 11: '바이시클킥', 12: '파워샷',
}


def shot_type_label(code: int | None) -> str:
    return SHOT_TYPES.get(code, f'종류 미확인 슈팅 · 코드 {code}' if code is not None else '종류 미확인 슈팅')
