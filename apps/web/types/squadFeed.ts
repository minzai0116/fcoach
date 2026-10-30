export type FeedSetting<T> = { status: "present" | "unset" | "missing" | "invalid"; value: T | null };
export type FeedFeature = { code: number | null; label: string; known: boolean; icon_url?: string | null };
export type FeedPlayer = {
  portrait_img?: string; overall?: number | null; salary?: number | null;
  season_code?: string; season_img?: string;
  pitch_position?: FeedSetting<{ x: number; y: number }>;
  sp_id: number; grade: number | null; position: string | null; name: string;
  lineup_role: "starter" | "substitute" | "unknown";
  intrinsic_traits: FeedSetting<string[]>;
  intrinsic_features?: FeedSetting<FeedFeature[]>;
  acquired_traits: FeedSetting<FeedFeature[]>;
  training_coach: FeedSetting<FeedFeature[]>;
  personal_tactics: FeedSetting<Array<{ code: string; value: number; label: string; known: boolean }>>;
  participation: FeedSetting<number[]>;
};
export type SquadFeedSummary = {
  feed_id: string; title: string; author: string; created_at: string | null; formation: string; mode: number | null;
};
export type SquadFeedSnapshot = SquadFeedSummary & {
  team_colors?: Array<{ category: "affiliation" | "feature" | "enhance"; name: string; level: number; players: number; effects: Array<{type: string; value: number}> }>;
  fetched_at: string; last_modified_at: null; source: string; source_url: string; label_version: string;
  team_tactics: Array<FeedSetting<number | string> & { key: string; label: string }>;
  players: FeedPlayer[];
};
export type SquadFeedList = { nickname: string; items: SquadFeedSummary[]; page: number; has_more: boolean; fetched_at: string };
export type FeedCheck = {
  metric: string; label: string; value: number; success: number; trials: number;
  setting: string; setting_available: boolean; action: string; verification: string;
};
export type FeedComparison = {
  guidance?: import("./coaching").PlayerGuidance;
  sp_id: number; sp_grade: number; sp_position: number; position_name: string; player_name: string; appearances: number;
  status: "matched" | "card_mismatch" | "grade_mismatch" | "position_mismatch" | "identity_missing" | "not_in_feed" | "ambiguous";
  label: string; linked: boolean;
  candidates: Array<Pick<FeedPlayer, "sp_id" | "grade" | "position" | "name">>;
  settings: FeedPlayer | null; checks: FeedCheck[];
  plans?: FeedPlan[];
};
export type FeedPlan = {
  id: string; title: string; status: "priority" | "review" | "maintain" | "insufficient" | "observation";
  reason: string; limitation: string; verification: string;
  evidence: Array<{ label: string; success: number; trials: number; value: number; scope: string; observed_matches: number }>;
  settings: Array<{ label: string; value: string; reason: string; features: FeedFeature[] }>;
  actions: Array<{ kind: string; label: string; reason: string; current: string | null; proposed: string | null }>;
};
export type AvailableFeedCoaching = {
  status: "available"; snapshot: SquadFeedSnapshot;
  author_status: "matched" | "mismatch" | "unverified";
  mode_status: "matched" | "mismatch" | "unverified";
  historical_use_verified: false; roster_fully_matched: boolean;
  summary: { record_count: number; linked: number; different: number; not_in_feed: number; withheld: number };
  comparisons: FeedComparison[]; feed_only_players: FeedComparison["candidates"];
  team_checks: Array<{ label: string; setting_label: string; current: number; trial: number; action: string }>;
  rule_version?: string;
  priorities?: Array<{ player_name: string; position_name: string; sp_id: number; sp_grade: number; plan: FeedPlan }>;
  team_plans?: FeedPlan[];
  matched_roster_sample_count?: number;
  rule_note?: string;
  note: string;
};
export type SquadFeedCoaching = AvailableFeedCoaching | { status: "unavailable"; requested_feed_id: string; message: string };

export function feedNicknameKey(value: string): string {
  return value.normalize("NFKC").replace(/[\u200b\ufeff]/g, "").trim().toLowerCase();
}
