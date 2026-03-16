# API Spec (v1)

## `GET /users/search`
- Query: `nickname`
- Response:
  - `ouid`
  - `nickname`
  - `source`

## `POST /analysis/run`
- Body:
  - `ouid: string`
  - `match_type: 50|52`
  - `window: 5|10|30`
  - `current_tactic?: object`
- Response:
  - `metrics`
  - `issues`
  - `actions`

## `GET /analysis/latest`
- Query: `ouid`, `match_type`, `window`
- Response: latest metrics snapshot

## `GET /actions/latest`
- Query: `ouid`, `match_type`, `window`
- Response: latest action cards

## `POST /experiments`
- Body:
  - `ouid`
  - `match_type`
  - `action_code`
  - `action_title`
  - `window_size`
  - `started_at?`
  - `ended_at?`
  - `notes?`

## `GET /experiments/evaluation`
- Query: `ouid`, `match_type`
- Response:
  - `pre`
  - `post`
  - `delta`

