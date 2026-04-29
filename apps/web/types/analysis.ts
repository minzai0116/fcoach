export type ScreenKey = "search" | "diagnosis" | "players" | "habits" | "actions" | "rankers" | "tracking" | "guide";
export type MatchType = 50 | 60 | 52;
export type WindowSize = 5 | 10 | 30;

export type IssueCode =
  | "HIGH_LATE_CONCEDE"
  | "LOW_FINISHING"
  | "POOR_SHOT_SELECTION"
  | "OFFSIDE_RISK"
  | "BUILDUP_INEFFICIENCY"
  | "DEFENSE_DUEL_WEAKNESS"
  | "CHANCE_CREATION_LOW"
  | "POSSESSION_CONTROL_RISK"
  | "INSUFFICIENT_DATA";

export type MetricMap = Record<string, number>;
export type IssueMap = Record<string, number>;

export type UserSearchResponse = {
  ouid: string;
  nickname: string;
  source: string;
};

export type AnalysisPayload = {
  ouid: string;
  match_type: number;
  window_size: number;
  sample_scope?: string;
  sample_count?: number;
  tactic_input_mode?: "provided" | "missing";
  latest_match_date?: string | null;
  sync_attempted?: boolean;
  sync_new_rows?: number;
  sync_warning?: string | null;
  created_at: string;
  recent_matches?: RecentMatchSummary[];
  benchmark?: MetricMap;
  benchmark_meta?: Record<string, unknown>;
  similar_rankers?: unknown[];
  metrics?: MetricMap;
  visuals?: VisualSummary;
  kpis?: MetricMap;
  issues?: IssueMap;
  issue_scores?: IssueMap;
  actions?: RawActionCard[];
};

export type VisualSummary = {
  shot_map?: ShotPoint[];
  shot_zone?: {
    left_ratio?: number;
    center_ratio?: number;
    right_ratio?: number;
    in_box_ratio?: number;
    outside_box_ratio?: number;
    total_shots?: number;
  };
  goal_timing_for?: TimingBucket[];
  goal_timing_against?: TimingBucket[];
  player_report?: PlayerReport;
  goal_type_for?: GoalTypeBucket[];
  goal_type_note?: string;
};

export type ShotPoint = { x: number; y: number; is_goal: boolean };
export type TimingBucket = { label: string; count: number };
export type GoalTypeBucket = { type_code: number; label: string; count: number; ratio: number };

export type ImpactComponent = {
  metric: string;
  weight: number;
  raw: number;
  normalized: number;
  weighted_score: number;
};

export type RecentMatchSummary = {
  match_date: string;
  opponent_nickname: string;
  result: string;
  score_for: number;
  score_against: number;
  controller?: string;
};

export type PlayerReportEntry = {
  sp_id: number;
  player_name: string;
  season_id: number;
  season_name: string;
  season_img?: string;
  face_img?: string;
  action_img?: string;
  fallback_img?: string;
  sp_position: number;
  position_name: string;
  sp_grade: number;
  appearances: number;
  goals: number;
  assists: number;
  goal_involvements: number;
  shots: number;
  effective_shots: number;
  pass_success_rate: number;
  tackle_success_rate: number;
  avg_rating: number;
  impact_score: number;
  role_group?: string;
  impact_model?: string;
  impact_confidence?: number;
  impact_components?: ImpactComponent[];
};

export type FormationNode = PlayerReportEntry & {
  slot_left: number;
  slot_top: number;
};

export type PlayerReportSummary = {
  sample_matches: number;
  controller_breakdown?: Record<string, number>;
  player_count: number;
  top_players?: PlayerReportEntry[];
  players?: PlayerReportEntry[];
  top_scorer?: PlayerReportEntry | null;
  top_assister?: PlayerReportEntry | null;
  most_used?: PlayerReportEntry | null;
};

export type PlayerReport = PlayerReportSummary;

export type PlayerSortMetric =
  | "position_name"
  | "goals"
  | "assists"
  | "effective_shots"
  | "pass_success_rate"
  | "tackle_success_rate"
  | "avg_rating"
  | "impact_score";

export type PlayerSortDirection = "desc" | "asc";

export type RawActionCard = {
  rank?: number;
  action_rank?: number;
  action_code: string;
  title: string;
  description: string;
  evidence?: Record<string, unknown>;
  tactic_direction: string;
  tactic_delta: Record<string, unknown>;
  confidence: number;
  created_at?: string;
};

export type ActionCard = {
  rank: number;
  actionCode: string;
  title: string;
  description: string;
  evidence?: Record<string, unknown>;
  tacticDirection: string;
  tacticDelta: Record<string, unknown>;
  confidence: number;
  createdAt?: string;
};

export type EvaluationPayload = {
  experiment_id: string;
  window_size: number;
  started_at: string;
  sample_scope?: string;
  pre_match_count?: number;
  post_match_count?: number;
  sync_attempted?: boolean;
  sync_new_rows?: number;
  sync_warning?: string | null;
  pre: MetricMap;
  post: MetricMap;
  delta: MetricMap;
  evaluated_at: string;
};

export type ExperimentPreview = {
  experiment_id: string;
  ouid: string;
  match_type: number;
  action_code: string;
  action_title: string;
  window_size: number;
  started_at: string;
  ended_at?: string | null;
  status: string;
  notes?: string | null;
  latest_evaluated_at?: string | null;
  latest_delta?: MetricMap | null;
};

export type ExperimentPreviewPayload = { exists: false } | ({ exists: true } & ExperimentPreview);

export type SimilarRanker = {
  ranker_proxy_rank: number;
  ouid: string;
  nickname: string;
  similarity: number;
  match_count: number;
  win_rate: number;
  reliability: number;
  source: string;
  formation: string;
  team_color: string;
  gaps: Record<string, number>;
  metric_comparisons: SimilarMetricComparison[];
};

export type SimilarMetricComparison = {
  metric_name: string;
  metric_label: string;
  higher_is_better: boolean;
  user_value: number;
  candidate_value: number;
  gap_value: number;
};

export type CoachExplanation = {
  coach_message: string;
  root_cause?: string;
  execution_checklist?: string[];
  in_game_signals?: string[];
  failure_patterns?: string[];
  expected_effect?: string;
  source?: string;
};

export type OfficialRanker = {
  mode: string;
  rank_no: number;
  nickname: string;
  ouid: string;
  elo: number;
  win_rate: number;
  win_count: number;
  draw_count: number;
  loss_count: number;
  formation: string;
  team_color: string;
  fetched_at: string;
  source: string;
};

export type RankersLatestPayload = {
  mode: string;
  count: number;
  mapped_ouid_count: number;
  rankers: OfficialRanker[];
};

export type VisualMetricItem = {
  label: string;
  value: number;
  display: string;
  color: "blue" | "green";
  max: number;
};

export type MetricGapEntry = {
  metricName: string;
  metricLabel: string;
  higherIsBetter: boolean;
  userValue: number;
  benchmarkValue: number;
  gapValue: number;
};

export type ConfidenceDetail = {
  base: number;
  sample_factor: number;
  severity_factor: number;
  tactic_penalty: number;
  confidence: number;
  formula_text: string;
};

export type CoachKpiTarget = {
  metricName: string;
  label: string;
  current: number;
  target: number;
  displayCurrent: string;
  displayTarget: string;
};
