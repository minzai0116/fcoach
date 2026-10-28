export type ComparisonSample = { value?: number | null; observed_matches?: number; success?: number; trials?: number; total?: number };
export type ComparisonMetric = {
  metric: string; label: string; unit: string; category: string; category_label: string;
  before: ComparisonSample; after: ComparisonSample; delta: number | null;
  status: "improved" | "declined" | "same" | "context" | "unavailable"; higher_is_better: boolean | null; advice: string;
};
export type ComparisonInsight = { metric: string; label: string; before: number; after: number; delta: number; unit: string; action: string };
export type BeforeAfterPayload = {
  ouid: string; match_type: number; fetched_at: string; sync_warning?: string | null;
  before: { matches: number; from: string; to: string; match_ids: string[]; excluded_count: number; normal_count: number; forfeit_count: number };
  after: BeforeAfterPayload["before"];
  metrics: ComparisonMetric[]; strengths: ComparisonInsight[]; improvements: ComparisonInsight[]; note: string;
};

export type MetricUnit = "rate" | "percent" | "average" | "meters" | "rating" | "goals";
export type ComparableMetric = {
  id: string; label: string; unit: MetricUnit; value: number | null;
  direction: "higher" | "lower" | "neutral";
  matches: number; success?: number | null; trials?: number | null; total?: number | null;
  ranker_count?: number; q1?: number; q3?: number; spread?: number;
  usage_share?: number | null;
};
export type MetricGroup = { id: string; label: string; metrics: ComparableMetric[] };
export type RankerBenchmark = {
  status: string; listed_count: number; ranker_count: number; record_count: number; unique_match_count: number;
  ranking_fetched_at: string | null; computed_at: string; match_from: string | null; match_until: string | null;
  groups: MetricGroup[]; members: Array<{ rank: number; nickname: string; matches: number }>; note: string;
};
export type MatchTrends = {
  point_count: number; window_size: number; note: string;
  points: Array<{ date: string; match_type: number; match_end_type?: number; result?: string; window_matches: number }>;
  groups: Array<{ id: string; label: string; metrics: Array<Pick<ComparableMetric, "id" | "label" | "unit" | "direction"> & {
    history: Array<{ value: number | null; observed_matches: number; trials?: number; success?: number }>;
  }> }>;
};

export type RankerFinding = {
  id: string; label: string; group: string; mine: ComparableMetric; reference: ComparableMetric;
  gap: number; status: "strength" | "weakness"; score: number; family: string;
};
export type RankerCoaching = {
  status: string; ranker_count: number; record_count: number; note: string; method: string;
  strengths: RankerFinding[]; weaknesses: RankerFinding[];
  by_group?: Record<string, { strengths: RankerFinding[]; weaknesses: RankerFinding[] }>;
  advice: Array<{ metric_id: string; title: string; comparison: RankerFinding;
    play: string; tactic: string; context?: string | null; check: string;
    setting?: { label: string; value: number | string } | null;
    players: Array<{ label: string; name: string; position: string; success: number; trials: number; note: string }>;
  }>;
};

export type DomainScoreMetric = {
  id: string; label: string; section: string; unit: MetricUnit; direction: ComparableMetric["direction"];
  mine: number; reference: number | null; spread: number | null; target: number | null; score: number | null; reference_score: number | null;
  usage: number | null; reference_usage: number | null; attempts_per_match: number | null; reference_attempts: number | null;
  weight: number; point_impact: number; matches: number; ranker_count: number;
  status: "strength" | "weakness" | "within_range" | "context" | "record";
};
export type DomainScoreAdvice = {title: string; play: string; tactic: string | null; metric_id: string; evidence: string; kind: string};
export type DomainScores = {
  scale: number[]; method: string; note: string;
  areas: Array<{id: string; label: string; mine: number | null; reference: number | null; metric_count: number; ranker_count: number;
    metrics: DomainScoreMetric[]; summaries?: DomainScoreMetric[]; advice: DomainScoreAdvice[];
  }>;
};
