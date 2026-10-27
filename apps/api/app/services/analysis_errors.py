from __future__ import annotations


class MatchSyncWarning(str):
    """동기화 실패를 사용자 안내 문구와 독립적으로 구분한다."""


class AnalysisRequestError(ValueError):
    def __init__(self, message: str, code: str, action: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.action = action
        self.status_code = status_code

    def detail(self) -> dict[str, str]:
        return {"message": str(self), "code": self.code, "action": self.action}
