"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FCoachLogo } from "./FCoachLogo";
import {
  actionGuide,
  oneLinePrescription,
  tacticAdjustmentLines,
  type CurrentTactic,
} from "../lib/actionPlan";
import { requestApi, trackEvent } from "../lib/apiClient";
import { analyticsError, trackFeedConnection } from "../lib/analytics";
import {
  BENCHMARK_SOURCE_LABEL,
  ISSUE_LABELS,
  MATCH_LABELS,
  METRIC_LABEL_KO,
  ANALYSIS_SCREENS,
  isAnalysisScreen,
  primaryScreen,
  SCREEN_PATHS,
  normalizePathname,
  screenFromPath,
  SCREEN_FLOW,
  SCREEN_LABELS,
  TACTIC_DIRECTION_KO,
} from "../lib/uiConstants";
import type {
  ActionCard,
  AnalysisPayload,
  CoachExplanation,
  MatchType,
  MatchSampleOptions,
  PlayerChemistryPair,
  PlayerReportEntry,
  PlayerSortDirection,
  PlayerSortMetric,
  RawActionCard,
  RecentMatchSummary,
  ScreenKey,
  SimilarMetricComparison,
  SimilarRanker,
  ShotPoint,
  TimingBucket,
  UserSearchResponse,
  WindowSize,
} from "../types/analysis";
import { PlayerPortrait } from "./player/PlayerPortrait";
import { feedPortraits } from "../lib/pitchLineup";
import { GuideScreen } from "./guide/GuideScreen";
import { OpponentComparisonPanel } from "./coaching/OpponentComparisonPanel";
import { SquadFeedSelector } from "./coaching/SquadFeedSelector";
import { FeedConnectionSummary } from "./coaching/FeedCoachingPanel";
import type { SquadFeedSnapshot } from "../types/squadFeed";
import { InteractiveShotMap } from "./coaching/InteractiveShotMap";
import { DomainScorePanel } from "./coaching/DomainScorePanel";
import { PrescriptionPanel } from "./coaching/PrescriptionPanel";
import { MatchReviewPanel } from "./coaching/MatchReviewPanel";
import { PositionCoachingPanel } from "./coaching/PositionCoachingPanel";
import { MatchTrendPanel } from "./coaching/MatchTrendPanel";
import { RankerComparisonPanel } from "./coaching/RankerComparisonPanel";
import {
  enhanceLevelClass,
  formatImpactRaw,
  IMPACT_COMPONENT_LABELS,
  normalizedGrade,
  normalizePlayerEntry,
  roleGroupLabel,
  sortArrow,
  tablePositionGroup,
  tablePositionOrder,
} from "../lib/playerReport";

type HabitLabWireframeProps = {
  initialScreen?: ScreenKey;
};

type PlayerSpotlight = {
  title: string;
  player: PlayerReportEntry;
  primaryMetric: string;
  stats: Array<{ label: string; value: string }>;
  detail: string;
};

function toActionCards(raw: RawActionCard[] | undefined): ActionCard[] {
  if (!raw || raw.length === 0) return [];
  return raw
    .map((item, index) => ({
      rank: item.rank ?? item.action_rank ?? index + 1,
      actionCode: item.action_code,
      title: item.title,
      description: item.description,
      evidence: item.evidence,
      tacticDirection: item.tactic_direction,
      tacticDelta: item.tactic_delta ?? {},
      confidence: item.confidence ?? 0,
      createdAt: item.created_at,
    }))
    .sort((left, right) => left.rank - right.rank);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatFixed(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "0.00";
}

function formatDate(value: string | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR", { hour12: false });
}

function perAppearance(value: number | undefined, appearances: number): number {
  return appearances > 0 ? Number(value ?? 0) / appearances : 0;
}

function playerStableKey(player: Pick<PlayerReportEntry, "sp_id" | "sp_grade">): string {
  return `${player.sp_id}:${player.sp_grade}`;
}

function playerDefenseActions(player: PlayerReportEntry | null | undefined): number {
  return Number(player?.tackles ?? 0) + Number(player?.intercepts ?? 0) + Number(player?.blocks ?? 0);
}

function playerGoalShare(player: PlayerReportEntry | null | undefined, totalGoalInvolvements: number): number {
  return totalGoalInvolvements > 0 ? Number(player?.goal_involvements ?? 0) / totalGoalInvolvements : 0;
}

function pickMaxPlayer(players: PlayerReportEntry[], score: (player: PlayerReportEntry) => number): PlayerReportEntry | null {
  let best: PlayerReportEntry | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const player of players) {
    const value = score(player);
    if (!Number.isFinite(value)) continue;
    if (best === null || value > bestScore) {
      best = player;
      bestScore = value;
    }
  }
  return best;
}

function buildPlayerSpotlights(players: PlayerReportEntry[]): PlayerSpotlight[] {
  if (players.length === 0) return [];
  const eligible = players.filter((player) => player.appearances > 0);
  const totalGoalInvolvements = eligible.reduce((sum, player) => sum + Number(player.goal_involvements ?? 0), 0);
  const used = new Set<string>();
  const spotlights: PlayerSpotlight[] = [];
  const unused = (candidates = eligible) => candidates.filter((player) => !used.has(playerStableKey(player)));
  const pickUnused = (candidates: PlayerReportEntry[], score: (player: PlayerReportEntry) => number) => pickMaxPlayer(unused(candidates), score);
  const add = (
    title: string,
    player: PlayerReportEntry | null,
    primaryMetric: string,
    stats: Array<{ label: string; value: string }>,
    detail: string,
  ) => {
    if (!player) return;
    const key = playerStableKey(player);
    if (used.has(key)) return;
    used.add(key);
    spotlights.push({ title, player, primaryMetric, stats: stats.slice(0, 4), detail });
  };

  const mvp = pickMaxPlayer(eligible, (player) => player.impact_score);
  add(
    "우리 팀 MVP",
    mvp,
    `종합 ${formatFixed(mvp?.impact_score ?? 0, 1)}`,
    [
      { label: "출전", value: `${mvp?.appearances ?? 0}경기` },
      { label: "평점", value: formatFixed(mvp?.avg_rating ?? 0, 2) },
      Number(mvp?.goal_involvements ?? 0) > 0
        ? { label: "골관여", value: `${formatFixed(Number(mvp?.goal_involvements ?? 0), 0)}회` }
        : { label: "수비액션", value: `${formatFixed(perAppearance(playerDefenseActions(mvp), mvp?.appearances ?? 0), 2)}/경기` },
      Number(mvp?.goal_involvements ?? 0) > 0
        ? { label: "팀 관여", value: formatPercent(playerGoalShare(mvp, totalGoalInvolvements)) }
        : { label: "신뢰도", value: formatPercent(mvp?.impact_confidence ?? 0) },
    ],
    "출전 빈도, 평점, 포지션별 핵심 기록을 함께 본 종합 1순위입니다.",
  );

  const finisher = pickUnused(
    eligible.filter((player) => player.shots > 0 && player.goals > 0),
    (player) => perAppearance(player.goals, player.appearances) * 2 + player.goals / Math.max(1, player.shots),
  );
  add(
    "해결사",
    finisher,
    `${formatFixed(finisher?.goals ?? 0, 0)}골`,
    [
      { label: "경기당", value: `${formatFixed(perAppearance(finisher?.goals, finisher?.appearances ?? 0), 2)}골` },
      { label: "득점 전환", value: formatPercent((finisher?.goals ?? 0) / Math.max(1, finisher?.shots ?? 0)) },
      { label: "유효슛", value: `${formatFixed(finisher?.effective_shots ?? 0, 0)}회` },
      { label: "골관여", value: `${formatFixed(finisher?.goal_involvements ?? 0, 0)}회` },
    ],
    "슈팅을 실제 득점으로 바꾸는 힘이 가장 좋은 선수입니다.",
  );

  const creator = pickUnused(
    eligible.filter((player) => player.assists > 0),
    (player) => perAppearance(player.assists, player.appearances) * 2 + player.pass_success_rate,
  );
  add(
    "찬스메이커",
    creator,
    `${formatFixed(creator?.assists ?? 0, 0)}도움`,
    [
      { label: "경기당", value: `${formatFixed(perAppearance(creator?.assists, creator?.appearances ?? 0), 2)}도움` },
      { label: "패스", value: formatPercent(creator?.pass_success_rate ?? 0) },
      { label: "골관여", value: `${formatFixed(creator?.goal_involvements ?? 0, 0)}회` },
      { label: "평점", value: formatFixed(creator?.avg_rating ?? 0, 2) },
    ],
    "마무리 전 찬스를 가장 꾸준히 만들어주는 선수입니다.",
  );

  const defender = pickUnused(
    eligible.filter((player) => ["DEF", "MID", "GK"].includes(String(player.role_group ?? ""))),
    (player) =>
      perAppearance(Number(player.tackles ?? 0) + Number(player.intercepts ?? 0) + Number(player.blocks ?? 0), player.appearances)
      + player.tackle_success_rate,
  );
  add(
    "수비 핵심",
    defender,
    `${formatFixed(perAppearance(playerDefenseActions(defender), defender?.appearances ?? 0), 2)}/경기`,
    [
      { label: "태클", value: formatPercent(defender?.tackle_success_rate ?? 0) },
      { label: "인터셉트", value: `${formatFixed(defender?.intercepts ?? 0, 0)}회` },
      { label: "블록", value: `${formatFixed(defender?.blocks ?? 0, 0)}회` },
      { label: "평점", value: formatFixed(defender?.avg_rating ?? 0, 2) },
    ],
    "태클, 차단, 블록을 합쳐 수비 관여가 가장 뚜렷한 선수입니다.",
  );

  const ironman = pickUnused(eligible, (player) => player.appearances);
  add(
    "붙박이 주전",
    ironman,
    `${ironman?.appearances ?? 0}경기`,
    [
      { label: "평점", value: formatFixed(ironman?.avg_rating ?? 0, 2) },
      { label: "골관여", value: `${formatFixed(ironman?.goal_involvements ?? 0, 0)}회` },
      { label: "종합", value: formatFixed(ironman?.impact_score ?? 0, 1) },
      { label: "포지션", value: ironman?.position_name ?? "-" },
    ],
    "최근 경기에서 가장 자주 기용된 핵심 로테이션입니다.",
  );

  const fallbackTitles = ["숨은 기여자", "컨디션 좋은 카드"];
  while (spotlights.length < Math.min(4, eligible.length)) {
    const player = pickUnused(eligible, (candidate) => candidate.impact_score);
    const title = fallbackTitles[spotlights.length - 3] ?? "핵심 선수";
    add(
      title,
      player,
      `종합 ${formatFixed(player?.impact_score ?? 0, 1)}`,
      [
        { label: "출전", value: `${player?.appearances ?? 0}경기` },
        { label: "평점", value: formatFixed(player?.avg_rating ?? 0, 2) },
        { label: "골관여", value: `${formatFixed(player?.goal_involvements ?? 0, 0)}회` },
        { label: "수비액션", value: `${formatFixed(perAppearance(playerDefenseActions(player), player?.appearances ?? 0), 2)}/경기` },
      ],
      "주요 역할 카드에 들지는 않았지만 최근 경기에서 기여도가 높은 선수입니다.",
    );
  }

  return spotlights.slice(0, 4);
}

function normalizeChemistryPair(item: unknown): PlayerChemistryPair | null {
  if (!item || typeof item !== "object") return null;
  const value = item as PlayerChemistryPair;
  if (!Array.isArray(value.players) || value.players.length < 2) return null;
  const players = value.players.slice(0, 2).map((player) => ({
    sp_id: Number(player.sp_id ?? 0),
    player_name: String(player.player_name ?? ""),
    season_name: String(player.season_name ?? ""),
    season_img: String(player.season_img ?? ""),
    face_img: String(player.face_img ?? ""),
    action_img: String(player.action_img ?? ""),
    fallback_img: String(player.fallback_img ?? ""),
    position_name: String(player.position_name ?? "-"),
    sp_grade: Number(player.sp_grade ?? 0),
  }));
  if (players.some((player) => player.sp_id <= 0 || !player.player_name)) return null;
  return {
    players,
    appearances: Number(value.appearances ?? 0),
    connection_count: Number(value.connection_count ?? value.assists ?? 0),
    goal_connection_count: Number(value.goal_connection_count ?? value.goals ?? 0),
    connection_per_match: Number(value.connection_per_match ?? value.goal_involvements_per_match ?? 0),
    goals: Number(value.goals ?? 0),
    assists: Number(value.assists ?? 0),
    goal_involvements: Number(value.goal_involvements ?? 0),
    goal_involvements_per_match: Number(value.goal_involvements_per_match ?? 0),
    avg_rating: Number(value.avg_rating ?? 0),
    chemistry_score: Number(value.chemistry_score ?? 0),
    evidence_type: String(value.evidence_type ?? ""),
    direction: String(value.direction ?? ""),
    summary: String(value.summary ?? ""),
  };
}

function getBenchmarkCompare(evidence: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!evidence) return null;
  const raw = evidence["benchmark_compare"];
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

function getCoachExplanation(evidence: Record<string, unknown> | undefined): CoachExplanation | null {
  if (!evidence) return null;
  const raw = evidence["coach_explanation"];
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  return {
    coach_message: String(value.coach_message ?? ""),
    root_cause: String(value.root_cause ?? ""),
    problem_detail: String(value.problem_detail ?? ""),
    improvement_goal: String(value.improvement_goal ?? ""),
    progress_check: String(value.progress_check ?? ""),
    execution_checklist: Array.isArray(value.execution_checklist) ? value.execution_checklist.map(String) : [],
    in_game_signals: Array.isArray(value.in_game_signals) ? value.in_game_signals.map(String) : [],
    failure_patterns: Array.isArray(value.failure_patterns) ? value.failure_patterns.map(String) : [],
    expected_effect: String(value.expected_effect ?? ""),
    source: String(value.source ?? ""),
  };
}

function getMetricGapTable(evidence: Record<string, unknown> | undefined): Record<string, unknown>[] {
  if (!evidence) return [];
  const raw = evidence["metric_gap_table"];
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
}

function getSimilarRankers(evidence: Record<string, unknown> | undefined): SimilarRanker[] {
  if (!evidence) return [];
  const raw = evidence["similar_rankers"];
  if (!Array.isArray(raw)) return [];
  const parsed = raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const value = item as Record<string, unknown>;
      const comparisons = Array.isArray(value.metric_comparisons)
        ? value.metric_comparisons
            .map((entry) => {
              if (!entry || typeof entry !== "object") return null;
              const comparison = entry as Record<string, unknown>;
              return {
                metric_name: String(comparison.metric_name ?? ""),
                metric_label: String(comparison.metric_label ?? comparison.metric_name ?? ""),
                higher_is_better: Boolean(comparison.higher_is_better),
                user_value: Number(comparison.user_value ?? 0),
                candidate_value: Number(comparison.candidate_value ?? 0),
                gap_value: Number(comparison.gap_value ?? 0),
              };
            })
            .filter((entry): entry is SimilarMetricComparison => Boolean(entry && entry.metric_name))
        : [];
      return {
        ranker_proxy_rank: Number(value.ranker_proxy_rank ?? 0),
        ouid: String(value.ouid ?? ""),
        nickname: String(value.nickname ?? ""),
        similarity: Number(value.similarity ?? 0),
        match_count: Number(value.match_count ?? 0),
        win_rate: Number(value.win_rate ?? 0),
        reliability: Number(value.reliability ?? 0),
        source: String(value.source ?? ""),
        formation: String(value.formation ?? ""),
        team_color: String(value.team_color ?? ""),
        gaps: (value.gaps ?? {}) as Record<string, number>,
        metric_comparisons: comparisons,
      };
    })
    .filter((item): item is SimilarRanker => Boolean(item && item.ouid));
  return parsed;
}

function toProgressPercent(value: number, maxValue: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, value / maxValue));
  return Math.round(ratio * 100);
}

function normalizeMatchType(value: unknown, fallback: MatchType): MatchType {
  const numeric = Number(value);
  if (numeric === 0 || numeric === 50 || numeric === 52 || numeric === 60) return numeric;
  return fallback;
}

function normalizeWindowSize(value: unknown, fallback: WindowSize): WindowSize {
  const numeric = Number(value);
  if (numeric === 5 || numeric === 10 || numeric === 30) return numeric;
  return fallback;
}

type MetricGapEntry = {
  metric_name: string;
  metric_label: string;
  user_value: number;
  benchmark_value: number;
  gap_value: number;
  higher_is_better: boolean;
};

type CoachKpiTarget = {
  metricName: string;
  metricLabel: string;
  higherIsBetter: boolean;
  currentText: string;
  targetText: string;
  benchmarkText: string;
  similarText?: string;
  reasonText: string;
  formulaText: string;
};

const ACTION_TARGET_METRICS: Record<string, string[]> = {
  CHANCE_CREATION_LOW: ["xg_for_per_match", "shots_per_match"],
  LOW_FINISHING: ["goals_per_sot", "in_box_shot_ratio"],
  OFFSIDE_RISK: ["offside_avg", "through_pass_success_rate"],
  HIGH_LATE_CONCEDE: ["late_concede_ratio", "goals_against_per_match"],
  POOR_SHOT_SELECTION: ["in_box_shot_ratio", "shot_on_target_rate"],
  BUILDUP_INEFFICIENCY: ["pass_success_rate", "through_pass_success_rate"],
  DEFENSE_DUEL_WEAKNESS: ["tackle_success_rate", "goals_against_per_match"],
  POSSESSION_CONTROL_RISK: ["possession_avg", "pass_success_rate"],
};

const RATE_METRICS = new Set([
  "win_rate",
  "shot_on_target_rate",
  "goals_per_sot",
  "goals_per_shot",
  "pass_success_rate",
  "through_pass_success_rate",
  "tackle_success_rate",
  "late_concede_ratio",
  "in_box_shot_ratio",
]);

const LOWER_IS_BETTER_METRICS = new Set(["offside_avg", "late_concede_ratio", "goals_against_per_match"]);

function toMetricGapEntries(rows: Record<string, unknown>[]): MetricGapEntry[] {
  return rows
    .map((row) => ({
      metric_name: String(row.metric_name ?? ""),
      metric_label: String(row.metric_label ?? row.metric_name ?? ""),
      user_value: Number(row.user_value ?? 0),
      benchmark_value: Number(row.benchmark_value ?? 0),
      gap_value: Number(row.gap_value ?? 0),
      higher_is_better: Boolean(row.higher_is_better),
    }))
    .filter((row) => row.metric_name.length > 0);
}

function formatMetricValue(metricName: string, value: number): string {
  if (metricName === "possession_avg") return `${formatFixed(value, 1)}%`;
  if (RATE_METRICS.has(metricName)) return formatPercent(value);
  if (metricName === "offside_avg") return formatFixed(value, 2);
  if (metricName === "shots_per_match") return formatFixed(value, 1);
  return formatFixed(value, 2);
}

function metricDirectionText(metricName: string): string {
  return LOWER_IS_BETTER_METRICS.has(metricName) ? "낮을수록 좋음" : "높을수록 좋음";
}

function confidenceBand(value: number): { label: string; className: string } {
  if (value >= 0.78) return { label: "높음", className: "issue-low" };
  if (value >= 0.52) return { label: "보통", className: "issue-mid" };
  if (value >= 0.35) return { label: "초기", className: "issue-mid" };
  return { label: "낮음", className: "issue-high" };
}

function syncNoticeText(payload: AnalysisPayload, fallback: string): string {
  const warning = String(payload.sync_warning ?? "").trim();
  const details = [
    payload.latest_match_date ? `최근 경기 ${formatDate(payload.latest_match_date)}` : "",
  ].filter(Boolean);
  const summary = details.length > 0 ? `${fallback} · ${details.join(" · ")}` : fallback;
  if (!warning) return summary;
  return details.length > 0 ? `${warning} (${details.join(" · ")})` : warning;
}

function buildCoachTargets(
  actionCode: string,
  metricGapTable: Record<string, unknown>[],
  benchmarkCompare: Record<string, unknown> | null,
  similarRankers: SimilarRanker[],
): CoachKpiTarget[] {
  const entries = toMetricGapEntries(metricGapTable);
  const primaryMetric = String(benchmarkCompare?.metric_name ?? "");
  const preferredMetrics = [primaryMetric, ...(ACTION_TARGET_METRICS[actionCode] ?? [])].filter(
    (metricName, index, rows) => metricName && rows.indexOf(metricName) === index,
  );
  const selected: MetricGapEntry[] = preferredMetrics
    .map((metricName) => entries.find((entry) => entry.metric_name === metricName) ?? null)
    .filter(
      (entry): entry is MetricGapEntry =>
        entry !== null && (entry.higher_is_better ? entry.gap_value < 0 : entry.gap_value > 0),
    )
    .slice(0, 2);

  if (selected.length === 0 && benchmarkCompare) {
    selected.push({
      metric_name: String(benchmarkCompare.metric_name ?? "overall"),
      metric_label: String(benchmarkCompare.metric_name ?? "overall"),
      user_value: Number(benchmarkCompare.user_value ?? 0),
      benchmark_value: Number(benchmarkCompare.benchmark_value ?? 0),
      gap_value: Number(benchmarkCompare.gap_value ?? 0),
      higher_is_better: Boolean(
        benchmarkCompare.higher_is_better ??
          !["late_concede_ratio", "offside_avg", "goals_against_per_match"].includes(String(benchmarkCompare.metric_name ?? "")),
      ),
    });
  }

  return selected.slice(0, 2).map((entry) => {
    const metricLabel = METRIC_LABEL_KO[entry.metric_name] ?? entry.metric_label;
    return {
      metricName: entry.metric_name, metricLabel, higherIsBetter: entry.higher_is_better,
      currentText: formatMetricValue(entry.metric_name, entry.user_value),
      targetText: formatMetricValue(entry.metric_name, entry.benchmark_value),
      benchmarkText: formatMetricValue(entry.metric_name, entry.benchmark_value),
      reasonText: "이전 정상 종료 경기의 실측값입니다. 정상 기준이나 달성 목표가 아닙니다.",
      formulaText: "이전 구간 성공 합계 ÷ 시도 합계",
    };
  });
}

function normalizeErrorMessage(error: unknown, fallbackMessage: string): string {
  if (!(error instanceof Error)) return fallbackMessage;
  const message = error.message.trim();
  const lowerMessage = message.toLowerCase();
  if (!message) return fallbackMessage;
  if (message.includes("잠시 제한") || message.includes("다시 시도")) {
    return message;
  }
  if (message === "Load failed" || message === "Failed to fetch") {
    return "서비스 응답을 받지 못했습니다. 잠시 후 다시 시도해주세요. 계속 반복되면 새로고침 후 다시 실행해주세요.";
  }
  if (lowerMessage.includes("timeout") || lowerMessage.includes("abort") || message.includes("시간 초과")) {
    return "응답 시간이 길어 요청을 중단했습니다. 잠시 후 다시 시도해주세요.";
  }
  if (message.includes("429") || lowerMessage.includes("too many requests") || lowerMessage.includes("rate limit")) {
    return "현재 요청이 몰려 잠시 대기 중입니다. 잠시 후 다시 시도해주세요.";
  }
  if (message.includes("CORS")) {
    return "서비스 연결 설정 문제로 요청이 차단되었습니다. 잠시 후 다시 시도해주세요.";
  }
  return message;
}

export function HabitLabWireframe({ initialScreen = "guide" }: HabitLabWireframeProps) {
  const [screen, setScreen] = useState<ScreenKey>(initialScreen === "habits" ? "players" : initialScreen);
  const goToScreen = useCallback((nextScreen: ScreenKey) => {
    if (nextScreen === "habits") nextScreen = "players";
    const nextPath = SCREEN_PATHS[nextScreen];

    if (typeof window !== "undefined" && normalizePathname(window.location.pathname) !== nextPath) {
      window.history.pushState({ screen: nextScreen }, "", nextPath);
    }

    setScreen(nextScreen);
  }, []);

  useEffect(() => {
    const nextScreen = typeof window === "undefined" ? null : screenFromPath(window.location.pathname);
    if (typeof window !== "undefined" && normalizePathname(window.location.pathname) === "/habits") {
      window.history.replaceState({ screen: "players" }, "", "/players");
    }
    if (nextScreen && nextScreen !== initialScreen) {
      setScreen(nextScreen);
    }

    const handlePopState = () => {
      const screenFromHistory = screenFromPath(window.location.pathname);
      if (screenFromHistory) {
        setScreen(screenFromHistory);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [initialScreen]);
  useEffect(() => { window.scrollTo(0, 0); }, [screen]);
  const matchType: MatchType = 0;
  const windowSize: WindowSize = 30;
  const [nicknameInput, setNicknameInput] = useState("");
  const sampleOptions: MatchSampleOptions = { include_forfeit_wins: true, include_forfeit_losses: true, start_match_id: null, end_match_id: null };
  const [selectedFeed, setSelectedFeed] = useState<SquadFeedSnapshot | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);
  const [resolvedUser, setResolvedUser] = useState<UserSearchResponse | null>(null);
  const [ouidInput, setOuidInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [analysisLoadingMode, setAnalysisLoadingMode] = useState<"quick" | null>(null);
  const [notice, setNotice] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [analysis, setAnalysis] = useState<AnalysisPayload | null>(null);
  const [actions, setActions] = useState<ActionCard[]>([]);

  const appliedTactic: CurrentTactic | null = null;
  const [playerSortMetric, setPlayerSortMetric] = useState<PlayerSortMetric>("impact_score");
  const [playerSortDirection, setPlayerSortDirection] = useState<PlayerSortDirection>("desc");
  const togglePlayerSort = (metric: PlayerSortMetric) => {
    if (playerSortMetric === metric) {
      setPlayerSortDirection((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }
    setPlayerSortMetric(metric);
    setPlayerSortDirection("desc");
  };

  const analysisMatchType = useMemo(() => normalizeMatchType(analysis?.match_type, matchType), [analysis?.match_type, matchType]);
  const analysisWindowSize = useMemo(
    () => normalizeWindowSize(analysis?.window_size, windowSize),
    [analysis?.window_size, windowSize],
  );

  const analysisSampleCount = Number(analysis?.sample_count ?? analysisWindowSize);
  const feedContext = analysis?.coaching?.squad_feed;
  const savedPortraits = useMemo(() => feedPortraits(feedContext?.status === "available" ? feedContext : undefined), [feedContext]);
  const preferredPortrait = (spId: number) => savedPortraits.get(spId) || savedPortraits.get(spId % 1_000_000);
  const hasContextualFeed = feedContext?.status === "available" && !!feedContext.rule_version && feedContext.summary.linked > 0;
  const tacticInputKnown = (analysis?.tactic_input_mode ?? (appliedTactic ? "provided" : "missing")) === "provided";




  const shotMap = useMemo(() => {
    const raw = analysis?.visuals?.shot_map;
    if (!Array.isArray(raw)) return [] as ShotPoint[];
    return raw
      .map((item) => ({
        ...(item as ShotPoint),
        x: Number((item as ShotPoint).x ?? 0),
        y: Number((item as ShotPoint).y ?? 0),
        is_goal: Boolean((item as ShotPoint).is_goal),
      }))
      .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y));
  }, [analysis?.visuals]);
  const goalTimingFor = useMemo(() => (Array.isArray(analysis?.visuals?.goal_timing_for) ? analysis?.visuals?.goal_timing_for : []), [analysis?.visuals]);
  const goalTimingAgainst = useMemo(
    () => (Array.isArray(analysis?.visuals?.goal_timing_against) ? analysis?.visuals?.goal_timing_against : []),
    [analysis?.visuals],
  );
  const goalTypeFor = useMemo(
    () => (Array.isArray(analysis?.visuals?.goal_type_for) ? analysis?.visuals?.goal_type_for : []),
    [analysis?.visuals],
  );
  const recentMatches = useMemo(() => {
    const raw = Array.isArray(analysis?.recent_matches) ? analysis.recent_matches : ([] as RecentMatchSummary[]);
    const seen = new Set<string>();
    const deduped: RecentMatchSummary[] = [];
    for (const match of raw) {
      if (!match) continue;
      const key = [
        String(match.match_date ?? "").trim(),
        String(match.opponent_nickname ?? "").trim(),
        String(match.result ?? "").trim(),
        String(match.score_for ?? ""),
        String(match.score_against ?? ""),
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(match);
    }
    return deduped;
  }, [analysis?.recent_matches]);
  const playerReport = analysis?.visuals?.player_report;
  const playerRows = useMemo(() => {
    const raw = playerReport?.players;
    if (!Array.isArray(raw)) return [] as PlayerReportEntry[];
    return raw
      .map(normalizePlayerEntry)
      .filter((item) => item.sp_id > 0 && item.appearances > 0);
  }, [playerReport?.players]);
  const impactExplainPlayers = useMemo(
    () =>
      [...playerRows]
        .sort((left, right) => right.impact_score - left.impact_score)
        .slice(0, Math.min(4, playerRows.length)),
    [playerRows],
  );
  const playerSpotlights = useMemo(() => buildPlayerSpotlights(playerRows), [playerRows]);
  const chemistryPairs = useMemo(() => {
    const raw = playerReport?.chemistry_pairs;
    if (!Array.isArray(raw)) return [] as PlayerChemistryPair[];
    return raw
      .map(normalizeChemistryPair)
      .filter((item): item is PlayerChemistryPair => item !== null && item.appearances > 0)
      .slice(0, 4);
  }, [playerReport?.chemistry_pairs]);
  const playerRowsForTable = useMemo(
    () =>
      [...playerRows].sort((left, right) => {
        if (playerSortMetric === "position_name") {
          const leftGroup = tablePositionGroup(left.position_name);
          const rightGroup = tablePositionGroup(right.position_name);
          if (leftGroup !== rightGroup) {
            const groupGap = leftGroup - rightGroup;
            return playerSortDirection === "desc" ? -groupGap : groupGap;
          }
          const leftOrder = tablePositionOrder(left.position_name);
          const rightOrder = tablePositionOrder(right.position_name);
          if (leftOrder !== rightOrder) {
            const orderGap = leftOrder - rightOrder;
            return playerSortDirection === "desc" ? -orderGap : orderGap;
          }
        } else {
          const metricGap = Number(left[playerSortMetric]) - Number(right[playerSortMetric]);
          if (metricGap !== 0) {
            return playerSortDirection === "desc" ? -metricGap : metricGap;
          }
        }

        if (left.appearances !== right.appearances) return right.appearances - left.appearances;
        if (left.impact_score !== right.impact_score) return right.impact_score - left.impact_score;
        return left.player_name.localeCompare(right.player_name, "ko");
      }),
    [playerRows, playerSortDirection, playerSortMetric],
  );
  const shotZone = analysis?.visuals?.shot_zone ?? {};

  const currentContextLabel = useMemo(
    () => `${MATCH_LABELS[analysisMatchType]} · ${analysis ? `${analysisSampleCount}경기` : "최근 30경기"}${analysis?.sample_selection?.start_match_date ? ` · ${formatDate(analysis.sample_selection.start_match_date)} ~ ${formatDate(analysis.sample_selection.end_match_date || analysis.latest_match_date || undefined)}` : ""}${analysis?.sample_selection ? ` · 정상 ${analysis.sample_selection.normal_count} / 몰수승 ${analysis.sample_selection.forfeit_win_count} / 몰수패 ${analysis.sample_selection.forfeit_loss_count}` : ""}`,
    [analysisMatchType, analysisSampleCount, analysis],
  );

  const completedScreenSet = useMemo(() => {
    const completed = new Set<ScreenKey>();
    if (ouidInput.trim().length >= 8) completed.add("search");
    if (analysis) {
      completed.add("diagnosis");
      if (playerRows.length > 0) completed.add("players");
      completed.add("habits");
    }
    if (actions.length > 0) completed.add("actions");
    return completed;
  }, [actions.length, analysis, ouidInput, playerRows.length]);




  async function resolveOuidFromNickname(mode: "quick" | "advanced"): Promise<string> {
    const targetNickname = nicknameInput.trim();
    if (targetNickname.length < 2) {
      throw new Error("닉네임을 2글자 이상 입력해주세요.");
    }
    if (/^[a-f0-9]{32}$/i.test(targetNickname)) {
      setResolvedUser({ ouid: targetNickname, nickname: targetNickname, source: "direct_ouid_input" });
      setOuidInput(targetNickname);
      return targetNickname;
    }
    if (resolvedUser && resolvedUser.nickname === targetNickname && resolvedUser.ouid.trim().length >= 8) {
      return resolvedUser.ouid;
    }
    let found: UserSearchResponse;
    try {
      found = await requestApi<UserSearchResponse>(`/users/search?nickname=${encodeURIComponent(targetNickname)}`);
    } catch (searchError) {
      trackEvent("search_user_failed", {
        screen: "search",
        matchType,
        windowSize: 30,
        properties: {
          mode,
          stage: "user_search",
          nickname_length: targetNickname.length,
          ...analyticsError(searchError),
        },
      });
      throw searchError;
    }
    setResolvedUser(found);
    setOuidInput(found.ouid);
    trackEvent("search_user", {
      screen: "search",
      matchType,
      windowSize: 30,
      properties: { mode, source: found.source },
    });
    return found.ouid;
  }

  async function onQuickRun(nextScreen: ScreenKey = "diagnosis") {
    const targetNickname = nicknameInput.trim();
    if (targetNickname.length < 2) {
      setError("닉네임을 2글자 이상 입력해주세요.");
      return;
    }
    setAnalysisLoadingMode("quick");
    setLoading(true);
    setError("");
    setNotice("");
    if (nextScreen !== "tracking") {
      setAnalysis(null);
      setActions([]);
    }
    let targetOuid = "";
    try {
      targetOuid = await resolveOuidFromNickname("quick");
      const payload = await requestApi<AnalysisPayload>("/analysis/run", {
        method: "POST",
        body: JSON.stringify({
          ouid: targetOuid,
          match_type: matchType,
          window: 30,
          current_tactic: null,
          squad_feed_id: selectedFeed?.feed_id ?? null,
          ...sampleOptions,
        }),
      }, { timeoutMs: 120_000 });
      setAnalysis(payload);
      setActions(payload.actions ? toActionCards(payload.actions) : []);
      setNotice(syncNoticeText(payload, "완료: 경기 분석"));
      goToScreen(nextScreen);
      trackEvent("run_analysis", {
        screen: "search",
        matchType,
        windowSize: 30,
        properties: {
          mode: "quick",
          has_tactic_input: false,
          action_count: payload.actions?.length ?? 0,
          analyzed_matches: payload.sample_count ?? null,
          with_feed: Boolean(selectedFeed),
        },
      });
      if (selectedFeed) trackFeedConnection(payload.coaching?.squad_feed, matchType);
    } catch (quickRunError) {
      const errorMessage = normalizeErrorMessage(quickRunError, "빠른 실행 실패");
      setError(nextScreen === "tracking" && analysis ? `${errorMessage} 이전 분석 결과를 표시합니다.` : errorMessage);
      if (targetOuid) {
        trackEvent("run_analysis_failed", {
          screen: "search",
          matchType,
          windowSize: 30,
          properties: {
            mode: "quick",
            stage: "analysis_run",
            ...analyticsError(quickRunError),
          },
        });
      }
      if (selectedFeed) trackEvent("squad_feed_connection_failed", {
        screen: "search", matchType,
        properties: { stage: targetOuid ? "analysis_run" : "user_search", ...analyticsError(quickRunError) },
      });
    } finally {
      setLoading(false);
      setAnalysisLoadingMode(null);
    }
  }

  const primaryActions = useMemo(() => {
    const topAction = actions.reduce<ActionCard | null>(
      (best, action) => (best === null || action.rank < best.rank ? action : best),
      null,
    );
    return topAction ? [topAction] : [];
  }, [actions]);
  const topRecommendedAction = primaryActions[0] ?? null;
  const topRecommendedAdjustmentLines = useMemo(
    () => (topRecommendedAction ? tacticAdjustmentLines(topRecommendedAction.tacticDelta, appliedTactic) : []),
    [appliedTactic, topRecommendedAction],
  );
  const topRecommendedPrescription = topRecommendedAction
    ? oneLinePrescription(
        ISSUE_LABELS[topRecommendedAction.actionCode] ?? topRecommendedAction.actionCode,
        topRecommendedAdjustmentLines,
        tacticInputKnown,
      )
    : "";


  return (
    <div className={`container grid${screen === "players" && analysis?.coaching ? " analysis-focus" : ""}`}>
      <header className="app-header">
        <FCoachLogo />
        <button type="button" className="link-like help-link" onClick={() => goToScreen("guide")} aria-current={screen === "guide" ? "page" : undefined}>이용 방법</button>
        {screen === "guide" && <p className="subtitle">
          FC온라인 닉네임으로 최근 경기의 선수·플레이를 분석하고, 전술 코칭과 최근 경기 추이를 제공합니다.
        </p>}
      </header>

      <section className="panel grid app-navigation">
        <nav className="flow-rail" aria-label="주 메뉴">
          {SCREEN_FLOW.map((item) => (
            <button
              key={item.key}
              className={`flow-step ${primaryScreen(screen) === item.key ? "active" : ""} ${completedScreenSet.has(item.key) ? "done" : ""}`}
              aria-label={item.label}
              aria-current={primaryScreen(screen) === item.key ? "page" : undefined}
              title={item.label}
              onClick={() => {
                goToScreen(item.key);
                trackEvent("tab_click", {
                  screen: item.key,
                  matchType,
                  properties: { from_screen: screen },
                });
              }}
            >
              <span className="flow-icon">{item.icon}</span>
              <span className="flow-title">{item.label}</span>
            </button>
          ))}
        </nav>
        {isAnalysisScreen(screen) && <div className="analysis-navigation">
          <h2 className="section-title">경기 분석</h2>
          <nav className="analysis-tabs" aria-label="경기 분석 메뉴">{ANALYSIS_SCREENS.map(key => <button key={key} type="button" aria-current={screen === key ? "page" : undefined} onClick={() => { goToScreen(key); trackEvent("tab_click", { screen: key, matchType, properties: { from_screen: screen } }); }}>{SCREEN_LABELS[key]}</button>)}</nav>
        </div>}
        {!["search", "tracking", "guide", "rankers"].includes(screen) && <div className="context-banner">현재 분석 기준: {currentContextLabel}</div>}
        {!!notice && !notice.startsWith("완료:") && !notice.startsWith("선택한 조건에 맞는 경기") && <div className="notice ok">{notice}</div>}
        {!!error && <div className="notice error">{error}</div>}

      </section>

      {screen === "search" && (
        <section className="panel grid">
          <h2 className="section-title">경기 검색</h2>
          <p>공식경기·공식 친선 최근 30경기를 분석합니다. 몰수승·몰수패도 포함합니다.</p>
          <div className="form-row single">
            <input
              placeholder="닉네임"
              aria-label="분석할 닉네임"
              disabled={loading}
              value={nicknameInput}
              onChange={(event) => {
                const nextValue = event.target.value;
                setNicknameInput(nextValue);
                setError("");
                setNotice("");
                setSelectedFeed(null);
                if (resolvedUser && resolvedUser.nickname !== nextValue.trim()) {
                  setResolvedUser(null);
                }
              }}
            />
          </div>
          <SquadFeedSelector key={nicknameInput.trim()} nickname={nicknameInput} selected={selectedFeed} disabled={loading} onChange={setSelectedFeed} onLoadingChange={setFeedLoading} />
          <div className="button-row">
            <button className="btn" onClick={() => void onQuickRun()} disabled={loading || feedLoading || nicknameInput.trim().length < 2}>
              {loading && analysisLoadingMode === "quick" ? (
                <span className="btn-loading">
                  <span className="spinner" />
                  분석 중...
                </span>
              ) : (
                selectedFeed ? "피드를 연결해 경기 분석 시작" : "경기 분석 시작"
              )}
            </button>
          </div>

        </section>
      )}

      {screen === "diagnosis" && !analysis && <section className="panel"><p>아직 분석한 경기 내역이 없습니다. 경기 검색에서 닉네임으로 경기를 불러와 분석해주세요.</p><button className="btn" onClick={() => goToScreen("search")}>경기 검색으로 이동</button></section>}
      {screen === "diagnosis" && analysis && (
        <PositionCoachingPanel key="team" section="team" rankerCoaching={analysis.ranker_coaching} comparisonGroups={analysis.comparison_metrics?.all} benchmark={analysis.ranker_benchmark} coaching={analysis.coaching} renderOverview={() => <section className="grid grid-3">
          <DomainScorePanel data={analysis.domain_scores} />
          <OpponentComparisonPanel comparison={analysis.opponent_comparison} modeCounts={analysis.normal_mode_counts ?? analysis.mode_counts} />
          <FeedConnectionSummary context={analysis?.coaching?.squad_feed} onOpen={() => goToScreen("actions")} />
          {topRecommendedAction && !hasContextualFeed && (
            <article className="panel span-3 diagnosis-action-cta">
              <div>
                <p className="action-title">이번 분석의 1순위 처방</p>
                <h3>{topRecommendedAction.title}</h3>
                <p className="focus-line">{topRecommendedPrescription}</p>
                <p className="muted compact">
                  추천 내용을 적용한 뒤 최근 경기 추이에서 기록의 변화를 확인하세요.
                </p>
              </div>
              <div className="button-row">
                <button className="btn secondary" type="button" onClick={() => goToScreen("actions")}>
                  맞춤 코칭 보기
                </button>
                <button className="btn" type="button" onClick={() => goToScreen("tracking")} disabled={loading}>
                  최근 경기 추이 보기
                </button>
              </div>
            </article>
          )}






          <article className="panel span-3">
            <h3 className="section-title">최근 경기 요약</h3>
            {recentMatches.length === 0 ? (
              <p className="muted">최근 경기 요약을 불러오지 못했습니다.</p>
            ) : (
              <div className="recent-match-list">
                {recentMatches.map((match, index) => (
                  <div key={`${match.match_date}-${match.opponent_nickname}-${index}`} className="recent-match-card">
                    <div className="recent-match-head">
                      <strong className={match.match_end_type === 1 || match.result === "승" ? "result-win" : match.match_end_type === 2 || match.result === "패" ? "result-loss" : "result-draw"}>{match.match_end_type === 1 ? "몰수승" : match.match_end_type === 2 ? "몰수패" : match.result || "-"}</strong>
                      <span>{formatDate(match.match_date)}</span>
                    </div>
                    <div className="recent-match-score">
                      {formatFixed(Number(match.score_for_display ?? match.score_for ?? 0), 0)} : {formatFixed(Number(match.score_against_display ?? match.score_against ?? 0), 0)}
                    </div>
                    <div className="muted compact">상대: {match.opponent_nickname || "알 수 없음"}</div>
                    <div className="muted compact">입력: {String(match.controller ?? "unknown").toLowerCase()}</div>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="panel span-3">
            <h3 className="section-title">경기장 분석</h3>
            <div className="pitch-layout">
              <div className="pitch-panel">
                <InteractiveShotMap points={shotMap} />
              </div>
              <div className="pitch-insights">
                <div className="zone-card">
                  <p className="action-title">슈팅 구역 비중</p>
                  <ul className="list compact">
                    <li>좌측: {formatPercent(Number(shotZone.left_ratio ?? 0))}</li>
                    <li>중앙: {formatPercent(Number(shotZone.center_ratio ?? 0))}</li>
                    <li>우측: {formatPercent(Number(shotZone.right_ratio ?? 0))}</li>
                    <li>박스 안: {formatPercent(Number(shotZone.in_box_ratio ?? 0))}</li>
                  </ul>
                </div>
                <div className="zone-card">
                  <p className="action-title">시간대별 득점/실점</p>
                  <div className="timing-grid">
                    {(goalTimingFor as TimingBucket[]).map((bucket, index) => {
                      const against = Number((goalTimingAgainst as TimingBucket[])[index]?.count ?? 0);
                      const forCount = Number(bucket.count ?? 0);
                      const maxCount = Math.max(1, ...((goalTimingFor as TimingBucket[]).map((b) => Number(b.count ?? 0))), ...((goalTimingAgainst as TimingBucket[]).map((b) => Number(b.count ?? 0))));
                      return (
                        <div key={bucket.label} className="timing-row">
                          <span className="timing-label">{bucket.label}</span>
                          <div className="timing-bars">
                            <div className="timing-bar for" style={{ width: `${toProgressPercent(forCount, maxCount)}%` }} />
                            <div className="timing-bar against" style={{ width: `${toProgressPercent(against, maxCount)}%` }} />
                          </div>
                          <span className="timing-value">{forCount}/{against}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="zone-card">
                  <p className="action-title">득점 슈팅 타입 분포</p>
                  {goalTypeFor.length === 0 && <p className="muted compact">확인된 득점 슈팅 종류가 없습니다.</p>}
                  {goalTypeFor.length > 0 && (
                    <ul className="list compact">
                      {goalTypeFor.map((item) => (
                        <li key={`${item.type_code}-${item.label}`}>
                          {item.label}: {item.count}골 ({formatPercent(Number(item.ratio ?? 0))})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </article>
        </section>} />
      )}

      {screen === "matches" && <section className="panel"><h3 className="section-title">경기별 분석</h3>{analysis ? <MatchReviewPanel key={`${analysis.ouid}:${analysis.created_at}`} analysis={analysis} /> : <><p>아직 분석한 경기 내역이 없습니다. 경기 검색에서 먼저 경기를 분석해주세요.</p><button className="btn" onClick={() => goToScreen("search")}>경기 검색으로 이동</button></>}</section>}

      {screen === "players" && (
        <section className="grid player-analysis-section">
          <PositionCoachingPanel key="players" section="players" coaching={analysis?.coaching} reportPlayers={playerRows} renderReport={() => <>
          {playerRows.length === 0 && (
            <article className="panel">
              <p className="muted">선수 리포트 데이터가 없습니다. 경기 검색에서 먼저 경기 분석을 시작해주세요.</p>
            </article>
          )}

          {playerRows.length > 0 && (
            <>
              <section className="player-leaders" aria-label="득점·도움 선두">{[
                { title: "최다 득점", player: playerReport?.top_scorer, value: playerReport?.top_scorer?.goals, unit: "골" },
                { title: "최다 도움", player: playerReport?.top_assister, value: playerReport?.top_assister?.assists, unit: "도움" },
              ].filter(item => item.player).map(item => <article key={item.title}><span>{item.title}</span><strong>{item.player?.player_name}</strong><b>{formatFixed(Number(item.value ?? 0), 0)}{item.unit}</b><small>{item.player?.position_name}</small></article>)}</section>

              {playerSpotlights.length > 0 && (
                <section className="grid grid-4 player-spotlight-grid">
                  {playerSpotlights.map((item) => (
                    <article key={`${item.title}-${playerStableKey(item.player)}`} className="panel player-spotlight-card">
                      <div className="player-spotlight-head">
                        <PlayerPortrait player={item.player} preferredImage={preferredPortrait(item.player.sp_id)} actionFirst alt={`${item.player.player_name} 미니페이스온`} className="player-face spotlight" />
                        <div>
                          <p className="action-title">{item.title}</p>
                          <h4>{item.player.player_name}</h4>
                          <p className="muted compact">
                            {item.player.position_name} · +{normalizedGrade(item.player.sp_grade)} · {item.player.season_name}
                          </p>
                        </div>
                      </div>
                      <div className="spotlight-metric">{item.primaryMetric}</div>
                      <div className="spotlight-stat-grid">
                        {item.stats.map((stat) => (
                          <div key={`${item.title}-${stat.label}`} className="spotlight-stat">
                            <span>{stat.label}</span>
                            <strong>{stat.value}</strong>
                          </div>
                        ))}
                      </div>
                      <p className="muted compact">{item.detail}</p>
                    </article>
                  ))}
                </section>
              )}

              {chemistryPairs.length > 0 && (
                <article className="panel">
                  <h4 className="section-title">골 찬스 콤비</h4>
                  <div className="chemistry-grid">
                    {chemistryPairs.map((pair) => {
                      const [left, right] = pair.players;
                      const connectionCount = Number(pair.connection_count ?? pair.assists ?? 0);
                      const goalConnectionCount = Number(pair.goal_connection_count ?? pair.goals ?? 0);
                      const connectionPerMatch = Number(pair.connection_per_match ?? pair.goal_involvements_per_match ?? 0);
                      return (
                        <article key={`${left.sp_id}-${left.sp_grade}-${right.sp_id}-${right.sp_grade}`} className="chemistry-card">
                          <div className="chemistry-player-row">
                            {[left, right].map((player, index) => (
                              <div key={`${player.sp_id}-${player.sp_grade}`} className="chemistry-player-step">
                              {index === 1 && <span className="chemistry-direction" role="img" aria-label="찬스 제공에서 슈팅으로">→</span>}
                              <div className="chemistry-player"><small>{index === 0 ? "찬스 제공" : "슈팅"}</small>
                                <PlayerPortrait player={player} preferredImage={preferredPortrait(player.sp_id)} actionFirst alt={`${player.player_name} 미니페이스온`} className="player-face chemistry" />
                                <strong>{player.player_name}</strong>
                                <span>
                                  {player.position_name} · +{normalizedGrade(player.sp_grade)}
                                </span>
                              </div></div>
                            ))}
                          </div>
                          <div className="chemistry-score-row">
                            <span>호흡 점수 {formatFixed(pair.chemistry_score, 1)}</span>
                            <span>찬스 {formatFixed(connectionCount, 0)}회</span>
                          </div>
                          <div className="chemistry-meter">
                            <div className="chemistry-meter-fill" style={{ width: `${Math.max(0, Math.min(100, pair.chemistry_score))}%` }} />
                          </div>
                          <p className="muted compact">
                            골로 연결 {formatFixed(goalConnectionCount, 0)}회 · 나온 경기 {pair.appearances}경기 · 경기당 {formatFixed(connectionPerMatch, 2)}회 ·
                            평균평점 {formatFixed(pair.avg_rating, 2)}
                          </p>
                          <p className="muted compact">{pair.summary}</p>
                        </article>
                      );
                    })}
                  </div>
                </article>
              )}

              <article className="panel">
                <h4 className="section-title">선수 상세 성과표</h4>
                <div className="impact-explain-grid">
                  {impactExplainPlayers.map((player) => {
                    const topComponents = (player.impact_components ?? []).slice(0, 3);
                    return (
                      <article key={`${player.sp_id}-${player.sp_grade}-impact`} className="impact-card">
                        <div className="impact-card-head">
                          <div className="impact-card-title">
                            <strong>{player.player_name}</strong>
                            <span>{player.position_name}</span>
                          </div>
                          <div className="impact-card-meta">
                            <span className="impact-chip">{roleGroupLabel(String(player.role_group ?? "MID"))}</span>
                            <span className="impact-chip score">영향 {formatFixed(player.impact_score, 2)}</span>
                          </div>
                        </div>
                        {topComponents.length > 0 && (
                          <div className="impact-component-list">
                            {topComponents.map((component) => {
                              const metricLabel = IMPACT_COMPONENT_LABELS[component.metric] ?? component.metric;
                              const normalizedPercent = Math.round(Math.max(0, Math.min(1, component.normalized)) * 100);
                              return (
                                <div key={`${player.sp_id}-${component.metric}`} className="impact-component-row">
                                  <div className="impact-component-top">
                                    <strong>{metricLabel}</strong>
                                    <span>{formatImpactRaw(component.metric, component.raw)}</span>
                                  </div>
                                  <div className="impact-component-sub">
                                    정규화 {formatPercent(component.normalized)} · 가중치 {formatPercent(component.weight)}
                                  </div>
                                  <div className="impact-component-bar">
                                    <div className="impact-component-fill" style={{ width: `${normalizedPercent}%` }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
                <div className="player-mobile-list">
                  {playerRowsForTable.map((player) => (
                    <article key={`${player.sp_id}-${player.sp_position}`} className="player-mobile-card">
                      <div className="player-mobile-head">
                        <div className="season-cell">
                          <PlayerPortrait player={player} preferredImage={preferredPortrait(player.sp_id)} actionFirst alt={`${player.player_name} 미니페이스온`} className="player-face table" />
                          <strong>{player.player_name}</strong>
                        </div>
                        <span className={`enhance-badge ${enhanceLevelClass(player.sp_grade)}`}>+{normalizedGrade(player.sp_grade)}</span>
                      </div>
                      <div className="player-mobile-meta">
                        {player.season_img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="season-badge tiny" src={player.season_img} alt={`${player.season_name} 배지`} />
                        ) : (
                          <span className="season-badge tiny fallback">SE</span>
                        )}
                        <span>{player.season_name}</span>
                        <span className="pill">{player.position_name}</span>
                      </div>
                      <div className="player-mobile-stats">
                        <span>출전 {player.appearances}</span>
                        <span>골 {formatFixed(player.goals, 0)}</span>
                        <span>도움 {formatFixed(player.assists, 0)}</span>
                        <span>유효슛 {formatFixed(player.effective_shots, 0)}</span>
                        <span>패스 {formatPercent(player.pass_success_rate)}</span>
                        <span>태클 {formatPercent(player.tackle_success_rate)}</span>
                        <span>평점 {formatFixed(player.avg_rating, 2)}</span>
                        <span>영향 {formatFixed(player.impact_score, 2)}</span>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="player-table-wrap player-table-desktop">
                  <table className="player-table">
                    <thead>
                      <tr>
                        <th>선수</th>
                        <th>시즌</th>
                        <th>강화</th>
                        <th>
                          <button type="button" className="table-sort-button" onClick={() => togglePlayerSort("position_name")}>
                            포지션 {sortArrow("position_name", playerSortMetric, playerSortDirection)}
                          </button>
                        </th>
                        <th>출전</th>
                        <th>
                          <button type="button" className="table-sort-button" onClick={() => togglePlayerSort("goals")}>
                            골 {sortArrow("goals", playerSortMetric, playerSortDirection)}
                          </button>
                        </th>
                        <th>
                          <button type="button" className="table-sort-button" onClick={() => togglePlayerSort("assists")}>
                            도움 {sortArrow("assists", playerSortMetric, playerSortDirection)}
                          </button>
                        </th>
                        <th>
                          <button type="button" className="table-sort-button" onClick={() => togglePlayerSort("effective_shots")}>
                            유효슛 {sortArrow("effective_shots", playerSortMetric, playerSortDirection)}
                          </button>
                        </th>
                        <th>
                          <button type="button" className="table-sort-button" onClick={() => togglePlayerSort("pass_success_rate")}>
                            패스성공률 {sortArrow("pass_success_rate", playerSortMetric, playerSortDirection)}
                          </button>
                        </th>
                        <th>
                          <button type="button" className="table-sort-button" onClick={() => togglePlayerSort("tackle_success_rate")}>
                            태클성공률 {sortArrow("tackle_success_rate", playerSortMetric, playerSortDirection)}
                          </button>
                        </th>
                        <th>
                          <button type="button" className="table-sort-button" onClick={() => togglePlayerSort("avg_rating")}>
                            평균평점 {sortArrow("avg_rating", playerSortMetric, playerSortDirection)}
                          </button>
                        </th>
                        <th>
                          <button type="button" className="table-sort-button" onClick={() => togglePlayerSort("impact_score")}>
                            영향점수 {sortArrow("impact_score", playerSortMetric, playerSortDirection)}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {playerRowsForTable.map((player) => (
                        <tr key={`${player.sp_id}-${player.sp_position}`}>
                          <td>
                            <div className="season-cell">
                              <PlayerPortrait player={player} preferredImage={preferredPortrait(player.sp_id)} actionFirst alt={`${player.player_name} 미니페이스온`} className="player-face table" />
                              <span>{player.player_name}</span>
                            </div>
                          </td>
                          <td>
                            <div className="season-cell">
                              {player.season_img ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img className="season-badge tiny" src={player.season_img} alt={`${player.season_name} 배지`} />
                              ) : (
                                <span className="season-badge tiny fallback">SE</span>
                              )}
                              <span>{player.season_name}</span>
                            </div>
                          </td>
                          <td>
                            <span className={`enhance-badge ${enhanceLevelClass(player.sp_grade)}`}>+{normalizedGrade(player.sp_grade)}</span>
                          </td>
                          <td>{player.position_name}</td>
                          <td>{player.appearances}</td>
                          <td>{formatFixed(player.goals, 0)}</td>
                          <td>{formatFixed(player.assists, 0)}</td>
                          <td>{formatFixed(player.effective_shots, 0)}</td>
                          <td>{formatPercent(player.pass_success_rate)}</td>
                          <td>{formatPercent(player.tackle_success_rate)}</td>
                          <td>{formatFixed(player.avg_rating, 2)}</td>
                          <td>{formatFixed(player.impact_score, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            </>
          )}
          </>} />
        </section>
      )}

      {screen === "actions" && (
        <section className="grid">
          <PrescriptionPanel rankerCoaching={analysis?.ranker_coaching} coaching={analysis?.coaching} onOpenAnalysis={() => goToScreen("players")} />
          {!!primaryActions.length && <h3 className="section-title">팀 지표에서 확인된 개선 제안</h3>}
          {primaryActions.map((action) => {
            const benchmarkCompare = getBenchmarkCompare(action.evidence);
            const metricGapTable = getMetricGapTable(action.evidence);
            const similarRankers = getSimilarRankers(action.evidence);
            const confidenceInfo = confidenceBand(action.confidence);
            const gapValue = Number(benchmarkCompare?.gap_value ?? 0);
            const guide = actionGuide(action.actionCode, gapValue, action.tacticDelta, tacticInputKnown);
            const coachExplanation = getCoachExplanation(action.evidence);
            const safeAdjustments = tacticAdjustmentLines(action.tacticDelta, appliedTactic);
            const focusPrescription = coachExplanation?.execution_checklist?.[0] || oneLinePrescription(
              ISSUE_LABELS[action.actionCode] ?? action.actionCode,
              safeAdjustments,
              tacticInputKnown,
            );
            const kpiTargets = buildCoachTargets(action.actionCode, metricGapTable, benchmarkCompare, similarRankers);
            return (
              <article key={`${action.rank}-${action.actionCode}`} className="panel">
                <div className="coaching-handoff">
                  <div className="coaching-handoff-copy">
                    <span>먼저 점검할 플레이</span>
                    <strong>{ISSUE_LABELS[action.actionCode] ?? action.actionCode}</strong>
                    {kpiTargets[0] && (
                      <small>
                        {kpiTargets[0].metricLabel} {kpiTargets[0].currentText} → {kpiTargets[0].targetText}
                      </small>
                    )}
                  </div>
                  <button className="btn secondary" onClick={() => goToScreen("players")}>
                    선수 분석 보기
                  </button>
                </div>
                <h3 className="section-title">
                  이번 교정안{" "}
                  <span className="pill">
                    {action.evidence?.benchmark_meta && String((action.evidence.benchmark_meta as Record<string, unknown>).source) === "own_history_v1" ? "내 이전 경기 비교" : <>신뢰도 {formatFixed(action.confidence, 2)} · <span className={confidenceInfo.className}>{confidenceInfo.label}</span></>}
                  </span>
                </h3>
                <div className="coach-focus-grid single">
                  <div className="focus-card primary">
                    <p className="action-title">이번에 바꿀 핵심</p>
                    <p className="focus-line">{focusPrescription}</p>
                    <p className="muted compact">{guide.doNow}</p>
                  </div>
                  <div className="focus-card">
                    <p className="action-title">전술 설정</p>
                    <ul className="list compact">
                      {safeAdjustments.slice(0, 4).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    <p className="muted compact">방향: {TACTIC_DIRECTION_KO[action.actionCode] ?? action.tacticDirection}</p>
                  </div>
                  <div className="focus-card">
                    <p className="action-title">경기 중 체크</p>
                    {(coachExplanation?.execution_checklist ?? []).length === 0 && <p className="muted compact">{guide.doNow}</p>}
                    {(coachExplanation?.execution_checklist ?? []).length > 0 && (
                      <ul className="list compact">
                        {(coachExplanation?.execution_checklist ?? []).slice(0, 3).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                <div className="coaching-verify-strip">
                  <div className="guide-title">바뀌었는지 확인할 지표</div>
                  {kpiTargets.length === 0 && <p className="muted compact">목표 지표를 계산할 데이터가 부족합니다.</p>}
                  {kpiTargets.length > 0 && (
                    <div className="coaching-verify-list">
                      {kpiTargets.slice(0, 2).map((target) => (
                        <div key={target.metricName}>
                          <span>{target.metricLabel}</span>
                          <strong>{target.currentText} → {target.targetText}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="muted compact">{coachExplanation?.expected_effect || guide.verify}</p>
                </div>
                <details className="detail-block">
                  <summary>이전 경기 비교 근거 보기</summary>
                  <div className="detail-content">
                    <p className="muted compact">비교값: 내 이전 정상 종료 경기의 실측 기록</p>
                    <ul className="list compact">
                      {kpiTargets.slice(0, 2).map((target) => (
                        <li key={target.metricName}>
                          {target.metricLabel}: 내 값 {target.currentText} / 기준 {target.benchmarkText}
                          {target.similarText ? ` / 유사 랭커 ${target.similarText}` : ""}
                        </li>
                      ))}
                    </ul>
                    {(coachExplanation?.failure_patterns ?? []).length > 0 && (
                      <p className="muted compact">주의: {(coachExplanation?.failure_patterns ?? []).slice(0, 2).join(" / ")}</p>
                    )}
                  </div>
                </details>
                <div className="button-row">
                  <button className="btn" onClick={() => goToScreen("tracking")} disabled={loading}>
                    최근 경기 추이 보기
                  </button>
                </div>
                <p className="muted compact">
                  플레이를 바꾼 뒤 최근 경기 추이에서 최근 30경기 기록의 변화를 확인하세요.{" "}
                </p>
              </article>
            );
          })}
        </section>
      )}

      {screen === "rankers" && <RankerComparisonPanel analysis={analysis} loading={loading} onRefresh={() => void onQuickRun("rankers")} onSearch={() => goToScreen("search")} />}

      {screen === "tracking" && <MatchTrendPanel analysis={analysis} loading={loading} onRefresh={() => void onQuickRun("tracking")} onSearch={() => goToScreen("search")} />}

      {screen === "guide" && (
        <GuideScreen
          hasAnalysis={Boolean(analysis)}
          onOpenActions={() => goToScreen(analysis ? "actions" : "search")}
          onOpenPlayers={() => goToScreen(analysis ? "players" : "search")}
          onOpenTracking={() => goToScreen("tracking")}
          onStartSearch={() => goToScreen("search")}
        />
      )}

      <footer className="app-footer">
        <div className="footer-top">
          <strong>© 2026 FCOACH</strong>
          <div className="footer-links">
            <button className="link-like" onClick={() => goToScreen("guide")}>
              이용 방법
            </button>
            <a href="/privacy" target="_blank" rel="noreferrer">
              개인정보처리방침
            </a>
            <a href="/terms" target="_blank" rel="noreferrer">
              이용약관
            </a>
            <a href="/license" target="_blank" rel="noreferrer">
              라이선스 고지
            </a>
          </div>
        </div>
        <p className="muted compact">FC Online 데이터는 Nexon Open API 기반으로 수집·가공됩니다.</p>
      </footer>
    </div>
  );
}
