# Product Requirements (v1)

## Product statement

FC Habit Lab identifies repeat loss patterns and provides action cards with tactic guidance.

## Scope

- Match types: official(50), friendly(52), fully separated.
- Loop: diagnosis -> action recommendation -> experiment tracking.
- No server DB; SQLite file is source of truth.

## Success criteria

- User can complete one cycle:
  1. run diagnosis for selected match type/window
  2. review top 3 issues/actions
  3. register experiment
  4. view before/after evaluation

## Non-goals (v1)

- Real-time ingestion streaming
- Full tactic optimizer with simulation
- LLM-dependent scoring decisions

