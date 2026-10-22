import type { ShotPoint } from "./analysis";

export type CompetitiveProfile = {
  current_nickname?: string;
  current_rank: { status: "available" | "outside_public_range" | "unavailable"; rank: number | null; elo?: string | null; as_of?: string | null };
  highest_division: { code: number; name: string; achieved_at: string | null } | null;
  fetched_at: string; source_url: string;
};
export type MatchReviewSide = { ouid: string; nickname: string; score: number | null; record_goals: number | null; shots: ShotPoint[]; profile: CompetitiveProfile };
export type MatchReview = {
  match_id: string; match_date: string; match_type: number; result: string; match_end_type: number; normal: boolean;
  mine: MatchReviewSide; opponent: MatchReviewSide; comparison_note: string;
  metrics: Array<{ key: string; label: string; group: string; unit: "%" | "회"; gap: number | null; mine: MatchMetricValue; opponent: MatchMetricValue }>;
  positives: MatchReviewFinding[]; checks: MatchReviewFinding[];
};
export type MatchMetricValue = { value: number | null; success?: number | null; trials?: number | null };
export type MatchReviewFinding = { metric: string; title: string; evidence: string; action: string };
