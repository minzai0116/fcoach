from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


MatchType = Literal[50, 60, 52]


class AnalysisRunRequest(BaseModel):
    ouid: str = Field(min_length=8)
    match_type: MatchType
    window: Literal[5, 10, 30] = 30
    current_tactic: dict[str, Any] | None = None


class ExperimentCreateRequest(BaseModel):
    ouid: str
    match_type: MatchType
    action_code: str
    action_title: str
    window_size: Literal[5, 10, 30] = 10
    started_at: str | None = None
    ended_at: str | None = None
    notes: str | None = None


class UserSearchResponse(BaseModel):
    ouid: str
    nickname: str
    source: str = "nexon_open_api"


class EventTrackRequest(BaseModel):
    event_name: str = Field(min_length=2, max_length=120)
    distinct_id: str | None = Field(default=None, max_length=120)
    session_id: str | None = Field(default=None, max_length=120)
    path: str | None = Field(default=None, max_length=255)
    screen: str | None = Field(default=None, max_length=120)
    referrer: str | None = Field(default=None, max_length=255)
    properties: dict[str, Any] = Field(default_factory=dict)
