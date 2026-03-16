from __future__ import annotations

import argparse
import json

from app.db import init_db
from app.services.analysis import run_analysis


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run habit analysis and create action cards")
    parser.add_argument("--ouid", required=True)
    parser.add_argument("--match-type", type=int, required=True, choices=[50, 60, 52])
    parser.add_argument("--window", type=int, default=30, choices=[5, 10, 30])
    parser.add_argument("--current-tactic-json", default="")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    current_tactic = json.loads(args.current_tactic_json) if args.current_tactic_json else None
    init_db()
    payload = run_analysis(
        ouid=args.ouid,
        match_type=args.match_type,
        window_size=args.window,
        current_tactic=current_tactic,
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

