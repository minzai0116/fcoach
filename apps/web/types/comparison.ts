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
