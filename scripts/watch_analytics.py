#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any


DEFAULT_API_URL = "https://fcoach-api.vercel.app"
DEFAULT_INTERVAL_SEC = 10
EVENT_LABELS = {
    "page_view": "페이지 방문",
    "tab_click": "탭 클릭",
    "search_user": "닉네임 검색",
    "search_user_failed": "닉네임 조회 실패",
    "run_analysis": "분석 실행",
    "run_analysis_failed": "분석 실패",
    "adopt_action": "액션 실험 시작",
    "adopt_action_failed": "액션 실험 실패",
    "view_evaluation": "실험 평가 조회",
    "change_match_type": "모드 변경",
    "change_window_size": "경기수 변경",
}


def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def parse_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


def load_local_env(env_file: str | None) -> dict[str, str]:
    root = project_root()
    paths = [Path(env_file)] if env_file else []
    paths += [
        root / ".env.local",
        root / ".env",
        root / "apps" / "api" / ".env.local",
        root / "apps" / "api" / ".env",
    ]
    merged: dict[str, str] = {}
    for path in paths:
        merged.update(parse_env_file(path.expanduser()))
    return merged


def env_value(local_env: dict[str, str], *keys: str) -> str:
    for key in keys:
        value = os.getenv(key) or local_env.get(key)
        if value:
            return value.strip()
    return ""


def fetch_summary(api_url: str, admin_key: str, hours: int, limit: int, timeout: float) -> dict[str, Any]:
    base_url = api_url.rstrip("/")
    params = urllib.parse.urlencode({"hours": hours, "limit": limit})
    request = urllib.request.Request(
        f"{base_url}/events/summary?{params}",
        headers={"x-admin-key": admin_key, "accept": "application/json"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def event_count(summary: dict[str, Any], event_name: str) -> int:
    for event in summary.get("events", []):
        if event.get("event_name") == event_name:
            return int(event.get("count") or 0)
    return 0


def format_local_time(value: str | None) -> str:
    if not value:
        return "-"
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return value
    return parsed.astimezone().strftime("%Y-%m-%d %H:%M:%S")


def print_bar(label: str, value: int, max_value: int) -> None:
    width = min(36, max(12, shutil.get_terminal_size((100, 24)).columns - 34))
    filled = 0 if max_value <= 0 else round(width * value / max_value)
    bar = "█" * filled + "░" * (width - filled)
    print(f"{label:<14} {value:>5}  {bar}")


def render_recent_failures(summary: dict[str, Any]) -> None:
    failures = summary.get("recent_failures", [])
    print("최근 실패 원인")
    if not failures:
        print("- 최근 실패 이벤트가 없습니다.")
        return
    for row in failures[:8]:
        properties = row.get("properties") if isinstance(row.get("properties"), dict) else {}
        name = str(row.get("event_name") or "-")
        label = EVENT_LABELS.get(name, name)
        stage = str(properties.get("stage") or "-")
        mode = str(properties.get("mode") or "-")
        message = str(properties.get("error_message") or "-")
        created_at = format_local_time(str(row.get("created_at") or ""))
        print(f"- {created_at} · {label} · {stage}/{mode} · {message}")


def render_summary(summary: dict[str, Any], api_url: str, interval_sec: int) -> None:
    events = summary.get("events", [])
    page_views = summary.get("page_views", [])
    max_event_count = max([int(event.get("count") or 0) for event in events] + [1])

    print("FCOACH 실시간 이용 현황")
    print("=" * 64)
    print(f"API: {api_url}")
    print(f"조회 범위: 최근 {summary.get('hours', 24)}시간")
    print(f"기준 시각: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"집계 시작: {format_local_time(summary.get('since'))}")
    print("-" * 64)
    print(f"방문자 수: {int(summary.get('unique_users') or 0)}명")
    print(f"전체 이벤트: {int(summary.get('total_events') or 0)}건")
    print()
    print("핵심 이벤트")
    print_bar("페이지 방문", event_count(summary, "page_view"), max_event_count)
    print_bar("닉네임 검색", event_count(summary, "search_user"), max_event_count)
    print_bar("닉네임 실패", event_count(summary, "search_user_failed"), max_event_count)
    print_bar("분석 실행", event_count(summary, "run_analysis"), max_event_count)
    print_bar("분석 실패", event_count(summary, "run_analysis_failed"), max_event_count)
    print_bar("실험 시작", event_count(summary, "adopt_action"), max_event_count)
    print_bar("평가 조회", event_count(summary, "view_evaluation"), max_event_count)
    print()
    print("이벤트 상세")
    if events:
        for event in events:
            name = str(event.get("event_name") or "-")
            label = EVENT_LABELS.get(name, name)
            print(f"- {label}: {int(event.get('count') or 0)}건")
    else:
        print("- 아직 수집된 이벤트가 없습니다.")
    print()
    print("인기 페이지")
    if page_views:
        for row in page_views:
            print(f"- {row.get('path') or '/'}: {int(row.get('count') or 0)}회")
    else:
        print("- 아직 페이지 방문 기록이 없습니다.")
    print()
    render_recent_failures(summary)
    print()
    print(f"{interval_sec}초마다 자동 갱신됩니다. 종료: Ctrl+C")


def clear_screen() -> None:
    print("\033[2J\033[H", end="")


def render_error(error: Exception, api_url: str) -> None:
    print("FCOACH 실시간 이용 현황")
    print("=" * 64)
    print(f"API: {api_url}")
    print("조회 실패")
    print("-" * 64)
    if isinstance(error, urllib.error.HTTPError):
        detail = error.read().decode("utf-8", errors="replace")
        if error.code == 403:
            print("관리자키가 맞지 않습니다. .env.local 또는 Vercel 환경변수를 확인해주세요.")
        elif error.code == 404:
            print("집계 API가 비활성화되어 있거나 아직 재배포가 반영되지 않았습니다.")
        else:
            print(f"HTTP {error.code}: {detail}")
    else:
        print(str(error))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="FCOACH 이용 로그를 터미널에서 실시간 조회합니다.")
    parser.add_argument("--api-url", default=None, help=f"API 주소. 기본값: {DEFAULT_API_URL}")
    parser.add_argument("--hours", type=int, default=24, help="조회 시간 범위. 기본값: 24")
    parser.add_argument("--limit", type=int, default=20, help="상세 항목 개수. 기본값: 20")
    parser.add_argument("--interval", type=int, default=DEFAULT_INTERVAL_SEC, help="갱신 주기(초). 기본값: 10")
    parser.add_argument("--timeout", type=float, default=8.0, help="요청 타임아웃(초). 기본값: 8")
    parser.add_argument("--env-file", default=None, help="관리자키를 읽을 env 파일 경로")
    parser.add_argument("--once", action="store_true", help="한 번만 조회하고 종료")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    local_env = load_local_env(args.env_file)
    api_url = args.api_url or env_value(local_env, "FCOACH_API_URL", "NEXT_PUBLIC_API_BASE_URL") or DEFAULT_API_URL
    admin_key = env_value(local_env, "FCOACH_ANALYTICS_KEY", "HABIT_LAB_ANALYTICS_ADMIN_KEY")
    if not admin_key:
        print("관리자키를 찾지 못했습니다. .env.local에 HABIT_LAB_ANALYTICS_ADMIN_KEY를 설정해주세요.")
        return 1

    while True:
        clear_screen()
        try:
            summary = fetch_summary(api_url, admin_key, args.hours, args.limit, args.timeout)
            render_summary(summary, api_url, max(3, args.interval))
        except Exception as error:
            render_error(error, api_url)
        if args.once:
            return 0
        time.sleep(max(3, args.interval))


if __name__ == "__main__":
    raise SystemExit(main())
