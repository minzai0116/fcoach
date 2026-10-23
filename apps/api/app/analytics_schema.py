from __future__ import annotations

from typing import Mapping


MEASUREMENT_VERSION = "2026-10-23"
PRODUCTION_HOSTS = frozenset({"fcoach.fun", "www.fcoach.fun"})
FEATURE_STAGES = {
    "feed_list": "squad_feed_list",
    "feed_selection": "squad_feed_selection",
    "feed_connection": "squad_feed_connection",
    "comparison_match_list": "before_after_match_list",
    "before_after": "before_after",
}
LEGACY_FUNNEL_EVENTS = ("search_user", "run_analysis", "adopt_action", "view_evaluation")
FAILURE_EVENTS = ("search_user_failed", "run_analysis_failed", "adopt_action_failed", *(f"{stage}_failed" for stage in FEATURE_STAGES.values()))
EVENT_USER_NAMES = (*LEGACY_FUNNEL_EVENTS, "visitor_first_seen", "visitor_return", *FAILURE_EVENTS,
                    *(f"{stage}_completed" for stage in FEATURE_STAGES.values()))


def usage_summary(events: Mapping[str, int], users: Mapping[str, int]) -> dict:
    return {
        "feature_usage": {
            feature: {
                "completed_events": events.get(f"{stage}_completed", 0),
                "completed_users": users.get(f"{stage}_completed", 0),
                "failed_events": events.get(f"{stage}_failed", 0),
                "failed_users": users.get(f"{stage}_failed", 0),
            }
            for feature, stage in FEATURE_STAGES.items()
        },
        "visitor_lifecycle": {
            label: {"events": events.get(event, 0), "unique_users": users.get(event, 0)}
            for label, event in (("new", "visitor_first_seen"), ("returning", "visitor_return"))
        },
    }


def measurement_metadata() -> dict:
    return {
        "version": MEASUREMENT_VERSION,
        "production_hosts": sorted(PRODUCTION_HOSTS),
        "page_view_rule": "initial_load_or_path_change",
        "unique_user_unit": "anonymous_browser",
        "event_intersections_are_ordered": False,
        "legacy_events_may_include_nonproduction": True,
        "note": "새 수집 규칙은 적용 이후 기록부터 유효합니다. 이전 수치는 소급 보정하지 않습니다.",
    }
