from __future__ import annotations

import argparse

from app.db import init_db, upsert_matches
from app.services.openapi_client import NexonOpenApiClient


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest FC Online match details into SQLite")
    parser.add_argument("--ouid", required=True)
    parser.add_argument("--match-type", type=int, required=True, choices=[50, 60, 52])
    parser.add_argument("--max-matches", type=int, default=100)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    init_db()
    client = NexonOpenApiClient()
    rows = client.collect_match_rows(ouid=args.ouid, match_type=args.match_type, limit=args.max_matches)
    inserted = upsert_matches(ouid=args.ouid, match_type=args.match_type, rows=rows)
    print(f"fetched={len(rows)} inserted={inserted}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

