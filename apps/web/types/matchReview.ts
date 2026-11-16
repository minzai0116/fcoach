import type { Controller, ShotPoint } from "./analysis";
import type { UserDivisions } from "../lib/userDivisions";

export type CompetitiveProfile = UserDivisions & { current_nickname?: string };
export type MatchReviewSide = { ouid: string; nickname: string; score: number | null; record_goals: number | null; controller?: Controller | null; shots: ShotPoint[]; profile: CompetitiveProfile };
export type MatchReview = {
  match_id: string; match_date: string; match_type: number; result: string; match_end_type: number; normal: boolean;
  mine: MatchReviewSide; opponent: MatchReviewSide; comparison_note: string;
  metrics: Array<{ key: string; label: string; group: string; unit: "%" | "회"; gap: number | null; mine: MatchMetricValue; opponent: MatchMetricValue }>;
  positives: MatchReviewFinding[]; checks: MatchReviewFinding[];
};
export type MatchMetricValue = { value: number | null; success?: number | null; trials?: number | null };
export type MatchReviewFinding = { metric: string; title: string; evidence: string; action: string };
