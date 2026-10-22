import unittest
from unittest.mock import patch

from app.services.openapi_client import NexonOpenApiClient


def _match_payload(ouid: str, end_type: int) -> dict:
    return {
        "matchDate": "2026-09-01T12:00:00Z",
        "matchInfo": [
            {"ouid": ouid, "matchDetail": {"matchEndType": end_type}},
            {"ouid": "opponent", "matchDetail": {"matchEndType": end_type}},
        ],
    }


class StubOpenApiClient(NexonOpenApiClient):
    def __init__(self, match_ids: list[str], payloads: dict[str, dict]) -> None:
        self.match_ids = match_ids
        self.payloads = payloads
        self.fetched_details: list[str] = []

    def fetch_match_ids(self, ouid: str, match_type: int, limit: int = 100) -> list[str]:
        return self.match_ids[:limit]

    def fetch_match_detail(self, match_id: str) -> dict:
        self.fetched_details.append(match_id)
        return self.payloads[match_id]


class OpenApiClientTest(unittest.TestCase):
    @patch("app.services.openapi_client.time.sleep", return_value=None)
    def test_collect_match_rows_keeps_fetching_until_completed_target(self, _sleep) -> None:
        ouid = "user-ouid"
        match_ids = ["forfeit-win", "completed-1", "forfeit-loss", "completed-2", "unused"]
        payloads = {
            "forfeit-win": _match_payload(ouid, 1),
            "completed-1": _match_payload(ouid, 0),
            "forfeit-loss": _match_payload(ouid, 2),
            "completed-2": _match_payload(ouid, 0),
            "unused": _match_payload(ouid, 0),
        }
        client = StubOpenApiClient(match_ids, payloads)

        rows = client.collect_match_rows(
            ouid=ouid,
            match_type=50,
            limit=5,
            completed_match_target=2,
        )

        self.assertEqual(client.fetched_details, match_ids[:4])
        self.assertEqual([row["match_id"] for row in rows], match_ids[:4])

    @patch("app.services.openapi_client.time.sleep", return_value=None)
    def test_collect_match_rows_skips_known_ids_when_filling_sample(self, _sleep) -> None:
        ouid = "user-ouid"
        match_ids = ["known", "forfeit", "completed"]
        payloads = {
            "known": _match_payload(ouid, 0),
            "forfeit": _match_payload(ouid, 2),
            "completed": _match_payload(ouid, 0),
        }
        client = StubOpenApiClient(match_ids, payloads)

        client.collect_match_rows(
            ouid=ouid,
            match_type=50,
            limit=3,
            known_match_ids={"known"},
            completed_match_target=2,
            existing_completed_count=1,
        )

        self.assertEqual(client.fetched_details, ["forfeit", "completed"])


if __name__ == "__main__":
    unittest.main()
