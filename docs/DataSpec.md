# Data Spec (SQLite-first)

## Source

- Nexon Open API:
  - `/fconline/v1/id`
  - `/fconline/v1/user/match`
  - `/fconline/v1/match-detail`

## Tables

### `matches_raw`
- Stores minimal raw match payload by `ouid + match_type + match_id`.
- De-dup by `UNIQUE(match_id, payload_hash)`.

### `user_metrics_snapshot`
- Stores computed metrics per `ouid/match_type/window`.
- Includes KPI JSON and issue score JSON.

### `action_cards`
- Top action cards generated from issue ranking.
- Includes evidence, tactic direction, and optional tactic delta.

### `experiment_runs`
- Stores user-selected action run metadata.
- Lifecycle status: `running` or `completed`.

### `experiment_eval`
- Stores before/after metric windows and deltas.

## Match type policy

- Official and friendly are never aggregated together in one snapshot.

