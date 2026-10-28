export type PlayerGuidance = {
  strengths: Array<{ title: string; evidence: string }>;
  improvements: Array<{ title: string; evidence: string }>;
  observations: string[];
  recommendations: Array<{ kind: string; title: string; description: string; basis: string }>;
  comparison_note: string;
};
import type { ShotPoint } from "./analysis";

export type RateSample = { success: number | null; trials: number | null; matches: number; value: number | null; interval: [number, number] | null; from: string | null; to: string | null };
export type HistoricalComparison = { source: "own_history"; status: "unavailable" | "lower" | "higher" | "no_clear_change"; current: RateSample; previous: RateSample; gap_pp: number | null; method: string; minimum_matches: number; minimum_trials: number };

export type PositionFinding = {
  comparison?: HistoricalComparison;
  metric: string;
  label: string;
  current: number;
  reference: number;
  target: number;
  gap_pp: number;
  evidence: string;
  hypothesis: string;
  adjustment: string;
  verification: string;
};

export type PositionPlayer = {
  guidance?: PlayerGuidance;
  sp_id: number;
  sp_grade: number;
  sp_position: number;
  player_name: string;
  position_name: string;
  season_name: string;
  appearances: number;
  measurements: Array<{
    metric: string;
    label: string;
    success: number;
    trials: number;
    value: number | null;
    observed_matches: number;
    minimum_trials: number;
    comparison?: HistoricalComparison;
    reference: number | null;
    status: "sufficient" | "insufficient";
  }>;
  findings: PositionFinding[];
  goalkeeper_metrics?: Array<{ metric: string; label: string; unit: string; current: { value: number | null; total: number | null; matches: number }; previous: { value: number | null; total: number | null; matches: number } }> | null;
  observations?: Array<{ metric: string; total: number; per_match: number; observed_matches: number }>;
  shot_types?: Array<{ metric: string; label: string; trials: number; goals: number; on_target: number; conversion: number | null }>;
};

export type PositionCoaching = {
  includes_forfeits?: boolean;
  mode: "play" | "observation";
  reference_source: string;
  reference_note: string;
  comparison_scope?: { current: { matches: number; from: string | null; to: string | null }; previous: { matches: number; from: string | null; to: string | null } };
  sample_count: number;
  players: PositionPlayer[];
  latest_lineup?: { match_id: string; match_date: string; players: Array<{ sp_id: number; sp_grade: number; sp_position: number }> } | null;
  passing?: PassingCoaching;
  domains?: CoachingDomain[];
  squad_feed?: import("./squadFeed").SquadFeedCoaching;
};

export type CoachingMetric = {
  metric: string;
  label: string;
  unit: "rate" | "percent" | "average" | "yards" | "rating" | "goals";
  value: number | null;
  success?: number;
  trials?: number;
  failures?: number;
  total?: number;
  on_target_rate?: number | null;
  usage_share?: number | null;
  failure_share?: number | null;
  observed_matches: number;
  minimum_trials: number;
  status: "sufficient" | "insufficient";
  guide: string;
  history: Array<{ date: string; value: number | null }>;
};

export type CoachingDomain = {
  id: string;
  label: string;
  description: string;
  focus_metric: string;
  metrics: CoachingMetric[];
  note: string;
  shot_map?: Array<ShotPoint & { type: number | null; result: number; in_penalty: boolean | null; date: string }>;
  periods?: Array<{ label: string; goals_for: number; goals_against: number }>;
};

export type PassingCoaching = {
  scope: "team";
  sample_count: number;
  observed_matches: number;
  excluded_matches: number;
  type_observed_matches?: number;
  overall: { trials: number; success: number; failures: number; success_rate: number | null };
  remainder: { trials: number; success: number; failures: number };
  note: string;
  types: Array<{
    metric: string;
    label: string;
    trials: number;
    success: number;
    failures: number;
    success_rate: number | null;
    comparison?: HistoricalComparison;
    usage_share: number | null;
    failure_share: number | null;
    loss_per_100_passes: number | null;
    observed_matches: number;
    minimum_trials: number;
    status: "sufficient" | "insufficient";
  }>;
  priorities: Array<{
    metric: string;
    label: string;
    evidence: string;
    interpretation: string;
    adjustment: string;
    verification: string;
  }>;
};

export function positionPlayerKey(player: Pick<PositionPlayer, "sp_id" | "sp_grade" | "sp_position">): string {
  return `${player.sp_id}:${player.sp_grade}:${player.sp_position}`;
}
