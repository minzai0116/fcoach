from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, model_validator


MatchType = Literal[50, 60, 52]


class AnalysisRunRequest(BaseModel):
    ouid: str = Field(min_length=8)
    match_type: Literal[0, 50, 60, 52]
    window: Literal[5, 10, 30] | None = 30
    current_tactic: dict[str, Any] | None = None
    squad_feed_id: str | None = Field(default=None, pattern=r'^[A-Za-z0-9]{8,32}$')
    include_forfeit_wins: bool = False
    include_forfeit_losses: bool = False
    start_match_id: str | None = Field(default=None, pattern=r'^[A-Za-z0-9_-]{8,128}$')
    end_match_id: str | None = Field(default=None, pattern=r'^[A-Za-z0-9_-]{8,128}$')


    @model_validator(mode='after')
    def fixed_recent_modes(self):
        if self.match_type == 0:
            self.window = 30
            self.start_match_id = self.end_match_id = None
            self.include_forfeit_wins = self.include_forfeit_losses = True
        return self


class ExperimentCreateRequest(BaseModel):
    ouid: str
    match_type: MatchType
    action_code: str
    action_title: str
    window_size: Literal[5, 10, 30] = 10
    started_at: str | None = None
    ended_at: str | None = None
    notes: str | None = None


class BeforeAfterRequest(BaseModel):
    ouid: str = Field(min_length=8)
    match_type: MatchType
    before_match_ids: list[Annotated[str, Field(pattern=r'^[A-Za-z0-9_-]{8,128}$')]] = Field(min_length=1, max_length=200)
    after_match_ids: list[Annotated[str, Field(pattern=r'^[A-Za-z0-9_-]{8,128}$')]] = Field(min_length=1, max_length=200)
    include_forfeit_wins: bool = False
    include_forfeit_losses: bool = False


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
