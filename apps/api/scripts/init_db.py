from app.db import init_db, get_db_path


def main() -> int:
    init_db()
    print(f"initialized: {get_db_path()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

