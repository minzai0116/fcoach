from __future__ import annotations

import argparse
import json

from app.db import init_db
from app.services.ranker_source import ensure_official_rankers


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync official rankers into local store")
    parser.add_argument("--mode", default="1vs1")
    parser.add_argument("--match-type", type=int, default=50)
    parser.add_argument("--pages", type=int, default=2)
    parser.add_argument("--max-rankers", type=int, default=30)
    parser.add_argument("--per-ranker-matches", type=int, default=8)
    parser.add_argument("--max-age-hours", type=int, default=24)
    parser.add_argument("--force-refresh", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    init_db()
    result = ensure_official_rankers(
        mode=args.mode,
        match_type=args.match_type,
        pages=args.pages,
        max_rankers=args.max_rankers,
        per_ranker_matches=args.per_ranker_matches,
        max_age_hours=args.max_age_hours,
        force_refresh=args.force_refresh,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
