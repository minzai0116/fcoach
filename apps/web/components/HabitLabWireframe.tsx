"use client";

import { useEffect, useMemo, useState } from "react";
import { FCoachLogo } from "./FCoachLogo";
import {
  actionGuide,
  oneLinePrescription,
  tacticAdjustmentLines,
  type CurrentTactic,
} from "../lib/actionPlan";
import { buildTrackingCoachInsight } from "../lib/trackingCoach";
import {
  DEFENSE_STYLE_OPTIONS,
  FC_TACTIC_VALUES,
  SET_PIECE_OPTIONS,
  setPieceLabel,
  tacticBandLabel,
  TACTIC_STYLE_OPTIONS,
} from "../lib/tactic";
import { requestApi, trackEvent, trackVisitorLifecycle } from "../lib/apiClient";
import {
  BENCHMARK_SOURCE_LABEL,
  ISSUE_DETAIL,
  ISSUE_LABELS,
  MATCH_LABELS,
  MATCH_TYPE_OPTIONS,
  METRIC_LABEL_KO,
  SCREEN_FLOW,
  SCREEN_LABELS,
  TACTIC_DIRECTION_KO,
  WINDOW_OPTIONS,
} from "../lib/uiConstants";
import type {
  ActionCard,
  AnalysisPayload,
  CoachExplanation,
  EvaluationPayload,
  ExperimentPreview,
  ExperimentPreviewPayload,
  MatchType,
  MetricMap,
  OfficialRanker,
  PlayerReportEntry,
  PlayerSortDirection,
  PlayerSortMetric,
  RankersLatestPayload,
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
import { GuideScreen } from "./guide/GuideScreen";
import {
  buildFormationNodes,
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

function toKpiValue(metrics: MetricMap, key: string): number {
  return Number(metrics[key] ?? 0);
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

function buildFallbackSimilarRankers(officialRankers: OfficialRanker[], metrics: MetricMap, topK = 3): SimilarRanker[] {
  if (officialRankers.length === 0) return [];
  const userWinRate = Number(metrics.win_rate ?? 0);
  const candidates = officialRankers
    .filter((ranker) => Number.isFinite(Number(ranker.win_rate)))
    .map((ranker) => {
      const candidateWinRate = Number(ranker.win_rate ?? 0);
      const gapValue = Number((userWinRate - candidateWinRate).toFixed(4));
      const rankGames = Math.max(1, Number(ranker.win_count ?? 0) + Number(ranker.draw_count ?? 0) + Number(ranker.loss_count ?? 0));
      const distance = Math.abs(userWinRate - candidateWinRate);
      const similarity = 1 / (1 + distance * 4);
      return {
        ranker_proxy_rank: Number(ranker.rank_no ?? 999999),
        ouid: String(ranker.ouid ?? `ranker:${ranker.rank_no}`),
        nickname: String(ranker.nickname ?? ""),
        similarity: Number(similarity.toFixed(4)),
        match_count: rankGames,
        win_rate: Number(candidateWinRate.toFixed(4)),
        reliability: Number(Math.min(0.45, rankGames / 40).toFixed(2)),
        source: "client_winrate_proxy",
        formation: String(ranker.formation ?? ""),
        team_color: String(ranker.team_color ?? ""),
        gaps: { win_rate: gapValue },
        metric_comparisons: [
          {
            metric_name: "win_rate",
            metric_label: "승률",
            higher_is_better: true,
            user_value: Number(userWinRate.toFixed(4)),
            candidate_value: Number(candidateWinRate.toFixed(4)),
            gap_value: gapValue,
          },
        ],
      } as SimilarRanker;
    })
    .sort((left, right) => {
      if (right.similarity !== left.similarity) return right.similarity - left.similarity;
      return left.ranker_proxy_rank - right.ranker_proxy_rank;
    });
  return candidates.slice(0, Math.max(1, topK));
}

function similarRankerSourceLabel(source: string): string {
  if (source.includes("nickname_proxy")) return "닉네임 매핑 기반";
  if (source.includes("meta_only")) return "랭커 메타 기반";
  if (source.includes("client_winrate_proxy")) return "승률 근접 임시 계산";
  if (source.includes("official_rank_1vs1")) return "공식 랭커 프로필 기반";
  return "기준 정보";
}

function toModelScale(fcValue: number): number {
  return Math.max(1, Math.min(10, Math.round(fcValue)));
}

function compareText(gapValue: number, higherIsBetter: boolean): string {
  const absGap = Math.abs(gapValue);
  if (absGap < 0.03) return "비슷함";
  if (higherIsBetter) {
    return gapValue > 0 ? "내 수치가 높음" : "랭커 후보가 높음";
  }
  return gapValue < 0 ? "내 수치가 좋음(낮음)" : "랭커 후보가 좋음(낮음)";
}

function formatDeltaSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${formatFixed(value, 3)}`;
}

function toProgressPercent(value: number, maxValue: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, value / maxValue));
  return Math.round(ratio * 100);
}

function normalizeMatchType(value: unknown, fallback: MatchType): MatchType {
  const numeric = Number(value);
  if (numeric === 50 || numeric === 52 || numeric === 60) return numeric;
  return fallback;
}

function normalizeWindowSize(value: unknown, fallback: WindowSize): WindowSize {
  const numeric = Number(value);
  if (numeric === 5 || numeric === 10 || numeric === 30) return numeric;
  return fallback;
}

type VisualMetricItem = {
  key: string;
  label: string;
  userValue: number;
  benchmarkValue: number;
  userDisplay: string;
  benchmarkDisplay: string;
  reverse: boolean;
  scaleMax: number;
};

function buildVisualMetricItems(metrics: MetricMap, benchmark: MetricMap | undefined): VisualMetricItem[] {
  const winRate = toKpiValue(metrics, "win_rate");
  const shotOnTargetRate = toKpiValue(metrics, "shot_on_target_rate");
  const lateConcedeRatio = toKpiValue(metrics, "late_concede_ratio");
  const offsideAvg = toKpiValue(metrics, "offside_avg");

  const benchmarkWinRate = Number(benchmark?.win_rate ?? 0.5);
  const benchmarkShotOnTargetRate = Number(benchmark?.shot_on_target_rate ?? 0.4);
  const benchmarkLateConcedeRatio = Number(benchmark?.late_concede_ratio ?? 0.33);
  const benchmarkOffsideAvg = Number(benchmark?.offside_avg ?? 1.0);

  return [
    {
      key: "win_rate",
      label: "승률",
      userValue: winRate,
      benchmarkValue: benchmarkWinRate,
      userDisplay: formatPercent(winRate),
      benchmarkDisplay: formatPercent(benchmarkWinRate),
      reverse: false,
      scaleMax: 1,
    },
    {
      key: "shot_on_target_rate",
      label: "유효슈팅 비율",
      userValue: shotOnTargetRate,
      benchmarkValue: benchmarkShotOnTargetRate,
      userDisplay: formatPercent(shotOnTargetRate),
      benchmarkDisplay: formatPercent(benchmarkShotOnTargetRate),
      reverse: false,
      scaleMax: 1,
    },
    {
      key: "late_concede_ratio",
      label: "후반 실점 비율 (낮을수록 좋음)",
      userValue: lateConcedeRatio,
      benchmarkValue: benchmarkLateConcedeRatio,
      userDisplay: formatFixed(lateConcedeRatio, 3),
      benchmarkDisplay: formatFixed(benchmarkLateConcedeRatio, 3),
      reverse: true,
      scaleMax: Math.max(1, benchmarkLateConcedeRatio * 1.8, lateConcedeRatio * 1.3),
    },
    {
      key: "offside_avg",
      label: "오프사이드 평균 (낮을수록 좋음)",
      userValue: offsideAvg,
      benchmarkValue: benchmarkOffsideAvg,
      userDisplay: formatFixed(offsideAvg, 2),
      benchmarkDisplay: formatFixed(benchmarkOffsideAvg, 2),
      reverse: true,
      scaleMax: Math.max(3, benchmarkOffsideAvg * 2.2, offsideAvg * 1.3),
    },
  ];
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

function metricStep(metricName: string): number {
  if (metricName === "offside_avg") return 0.1;
  if (metricName === "shots_per_match") return 0.4;
  if (metricName === "xg_for_per_match") return 0.15;
  if (metricName === "goals_against_per_match") return 0.15;
  if (metricName === "possession_avg") return 1.0;
  return 0.03;
}

function clampMetricValue(metricName: string, value: number): number {
  if (RATE_METRICS.has(metricName)) return Math.max(0, Math.min(1, value));
  if (metricName === "possession_avg") return Math.max(0, Math.min(100, value));
  return Math.max(0, value);
}

function metricTargetValue(entry: MetricGapEntry): number {
  const deficit = entry.higher_is_better ? Math.max(0, -entry.gap_value) : Math.max(0, entry.gap_value);
  const movement = deficit > 0 ? Math.max(metricStep(entry.metric_name), deficit * 0.5) : metricStep(entry.metric_name);
  const direction = entry.higher_is_better ? 1 : -1;
  const rawTarget = entry.user_value + direction * movement;
  return clampMetricValue(entry.metric_name, rawTarget);
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
    payload.created_at ? `분석 시각 ${formatDate(payload.created_at)}` : "",
    payload.latest_match_date ? `최근 경기 ${formatDate(payload.latest_match_date)}` : "",
  ].filter(Boolean);
  const summary = details.length > 0 ? `${fallback} · ${details.join(" · ")}` : fallback;
  if (!warning) return summary;
  return details.length > 0 ? `${warning} (${details.join(" · ")})` : warning;
}

function similarRankerTarget(metricName: string, similarRankers: SimilarRanker[]): { value: number; count: number } | null {
  const weightedValues: { value: number; weight: number }[] = [];
  similarRankers.forEach((ranker) => {
    const match = ranker.metric_comparisons.find((row) => row.metric_name === metricName);
    if (!match) return;
    const weight = Math.max(0.1, ranker.similarity) * Math.max(0.2, ranker.reliability);
    weightedValues.push({ value: Number(match.candidate_value ?? 0), weight });
  });
  if (weightedValues.length === 0) return null;
  const weightedSum = weightedValues.reduce((sum, item) => sum + item.value * item.weight, 0);
  const totalWeight = weightedValues.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return null;
  return { value: clampMetricValue(metricName, weightedSum / totalWeight), count: weightedValues.length };
}

function buildCoachTargets(
  actionCode: string,
  metricGapTable: Record<string, unknown>[],
  benchmarkCompare: Record<string, unknown> | null,
  similarRankers: SimilarRanker[],
): CoachKpiTarget[] {
  const entries = toMetricGapEntries(metricGapTable);
  const preferredMetrics = ACTION_TARGET_METRICS[actionCode] ?? [];
  const selected: MetricGapEntry[] = preferredMetrics
    .map((metricName) => entries.find((entry) => entry.metric_name === metricName) ?? null)
    .filter((entry): entry is MetricGapEntry => Boolean(entry))
    .slice(0, 2);

  if (selected.length === 0 && benchmarkCompare) {
    selected.push({
      metric_name: String(benchmarkCompare.metric_name ?? "overall"),
      metric_label: String(benchmarkCompare.metric_name ?? "overall"),
      user_value: Number(benchmarkCompare.user_value ?? 0),
      benchmark_value: Number(benchmarkCompare.benchmark_value ?? 0),
      gap_value: Number(benchmarkCompare.gap_value ?? 0),
      higher_is_better: !["late_concede_ratio", "offside_avg", "goals_against_per_match"].includes(
        String(benchmarkCompare.metric_name ?? ""),
      ),
    });
  }

  return selected.slice(0, 2).map((entry) => {
    const metricLabel = METRIC_LABEL_KO[entry.metric_name] ?? entry.metric_label;
    const deficit = entry.higher_is_better ? Math.max(0, -entry.gap_value) : Math.max(0, entry.gap_value);
    const baseStep = metricStep(entry.metric_name);
    const movement = deficit > 0 ? Math.max(baseStep, deficit * 0.5) : baseStep;
    const benchmarkTarget = metricTargetValue(entry);
    const similarTarget = similarRankerTarget(entry.metric_name, similarRankers);
    const targetValue =
      similarTarget && Number.isFinite(similarTarget.value)
        ? clampMetricValue(entry.metric_name, benchmarkTarget * 0.5 + similarTarget.value * 0.5)
        : benchmarkTarget;
    const formula = similarTarget
      ? `목표 = 기준보정(${formatMetricValue(entry.metric_name, benchmarkTarget)})·50% + 유사랭커(${formatMetricValue(entry.metric_name, similarTarget.value)})·50%`
      : `목표 = 현재 ${entry.higher_is_better ? "+" : "-"} max(기본 ${formatMetricValue(entry.metric_name, baseStep)}, 결손×0.5 ${formatMetricValue(entry.metric_name, deficit * 0.5)})`;
    const reason = `결손 ${formatMetricValue(entry.metric_name, deficit)}를 1차 보정${
      similarTarget ? ` 후 유사 랭커 ${similarTarget.count}명 평균과 혼합` : ""
    }`;
    return {
      metricName: entry.metric_name,
      metricLabel,
      currentText: formatMetricValue(entry.metric_name, entry.user_value),
      targetText: formatMetricValue(entry.metric_name, targetValue),
      benchmarkText: formatMetricValue(entry.metric_name, entry.benchmark_value),
      similarText: similarTarget ? formatMetricValue(entry.metric_name, similarTarget.value) : undefined,
      reasonText: `${reason} (${metricDirectionText(entry.metric_name)})`,
      formulaText: formula,
    };
  });
}

function normalizeErrorMessage(error: unknown, fallbackMessage: string): string {
  if (!(error instanceof Error)) return fallbackMessage;
  const message = error.message.trim();
  if (message === "Load failed" || message === "Failed to fetch") {
    return "API 서버 연결에 실패했습니다. `make api`를 실행한 뒤 새로고침해주세요.";
  }
  if (message.includes("CORS")) {
    return "브라우저 CORS 오류입니다. API 서버를 재시작(`make api`)해주세요.";
  }
  return message || fallbackMessage;
}

export function HabitLabWireframe() {
  const [screen, setScreen] = useState<ScreenKey>("guide");
  const [matchType, setMatchType] = useState<MatchType>(60);
  const [windowSize, setWindowSize] = useState<WindowSize>(30);
  const [nicknameInput, setNicknameInput] = useState("");
  const [resolvedUser, setResolvedUser] = useState<UserSearchResponse | null>(null);
  const [ouidInput, setOuidInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [analysisLoadingMode, setAnalysisLoadingMode] = useState<"quick" | "advanced" | null>(null);
  const [notice, setNotice] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [analysis, setAnalysis] = useState<AnalysisPayload | null>(null);
  const [actions, setActions] = useState<ActionCard[]>([]);
  const [evaluation, setEvaluation] = useState<EvaluationPayload | null>(null);
  const [experimentPreview, setExperimentPreview] = useState<ExperimentPreview | null>(null);
  const [experimentPreviewLoading, setExperimentPreviewLoading] = useState(false);
  const [officialRankers, setOfficialRankers] = useState<OfficialRanker[]>([]);
  const [rankerMeta, setRankerMeta] = useState<{ mode: string; count: number; mapped: number } | null>(null);

  const [defenseStyle, setDefenseStyle] = useState("밸런스");
  const [buildupPlayStyle, setBuildupPlayStyle] = useState("밸런스");
  const [chanceCreationStyle, setChanceCreationStyle] = useState("밸런스");
  const [defenseWidth, setDefenseWidth] = useState(5);
  const [defenseDepth, setDefenseDepth] = useState(6);
  const [attackWidth, setAttackWidth] = useState(5);
  const [boxPlayers, setBoxPlayers] = useState(6);
  const [cornerKick, setCornerKick] = useState(3);
  const [freeKick, setFreeKick] = useState(3);
  const [appliedTactic, setAppliedTactic] = useState<CurrentTactic | null>(null);
  const [showAdvancedTactic, setShowAdvancedTactic] = useState(false);
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

  const metrics = analysis?.metrics ?? analysis?.kpis ?? {};
  const issues = analysis?.issues ?? analysis?.issue_scores ?? {};
  const tacticInputKnown = (analysis?.tactic_input_mode ?? (appliedTactic ? "provided" : "missing")) === "provided";

  const issueTagClass = useMemo(() => {
    const entries = Object.entries(issues);
    if (entries.length === 0) return "issue-low";
    const topScore = entries.sort((left, right) => right[1] - left[1])[0]?.[1] ?? 0;
    if (topScore >= 70) return "issue-high";
    if (topScore >= 30) return "issue-mid";
    return "issue-low";
  }, [issues]);

  const topIssue = useMemo(() => {
    const entries = Object.entries(issues);
    if (entries.length === 0) return null;
    const [issueCode, score] = entries.sort((left, right) => right[1] - left[1])[0];
    return { issueCode, score };
  }, [issues]);

  const similarRankersForView = useMemo(() => {
    if (analysis && Array.isArray(analysis.similar_rankers)) {
      const parsed = getSimilarRankers({ similar_rankers: analysis.similar_rankers });
      if (parsed.length > 0) return parsed;
    }
    if (actions.length > 0) {
      const parsed = getSimilarRankers(actions[0].evidence);
      if (parsed.length > 0) return parsed;
    }
    if (analysis && officialRankers.length > 0) {
      return buildFallbackSimilarRankers(officialRankers, metrics, 3);
    }
    return [];
  }, [analysis, actions, officialRankers, metrics]);

  const sortedIssues = useMemo(
    () => Object.entries(issues).sort((left, right) => right[1] - left[1]),
    [issues],
  );
  const trackingCoach = useMemo(
    () =>
      buildTrackingCoachInsight({
        evaluation,
        experimentActionCode: experimentPreview?.action_code ?? actions[0]?.actionCode ?? null,
        actions: actions.map((action) => ({
          rank: action.rank,
          actionCode: action.actionCode,
          title: action.title,
        })),
        issueLabelMap: ISSUE_LABELS,
      }),
    [actions, evaluation, experimentPreview?.action_code],
  );
  const visualMetricItems = useMemo(() => buildVisualMetricItems(metrics, analysis?.benchmark), [analysis?.benchmark, metrics]);
  const shotMap = useMemo(() => {
    const raw = analysis?.visuals?.shot_map;
    if (!Array.isArray(raw)) return [] as ShotPoint[];
    return raw
      .map((item) => ({
        x: Number((item as ShotPoint).x ?? 0),
        y: Number((item as ShotPoint).y ?? 0),
        is_goal: Boolean((item as ShotPoint).is_goal),
      }))
      .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y));
  }, [analysis?.visuals]);
  const halfPitchShotMap = useMemo(
    () =>
      shotMap.map((point) => ({
        left: Math.max(0, Math.min(1, point.y)),
        top: Math.max(0, Math.min(1, point.x < 0.5 ? point.x * 0.2 : (point.x - 0.5) * 2)),
        is_goal: point.is_goal,
      })),
    [shotMap],
  );
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
  const goalTypeNote = String(analysis?.visuals?.goal_type_note ?? "");
  const playerReport = analysis?.visuals?.player_report;
  const playerRows = useMemo(() => {
    const raw = playerReport?.players;
    if (!Array.isArray(raw)) return [] as PlayerReportEntry[];
    return raw
      .map(normalizePlayerEntry)
      .filter((item) => item.sp_id > 0 && item.appearances > 0);
  }, [playerReport?.players]);
  const topPlayerRows = useMemo(() => {
    const raw = playerReport?.top_players;
    if (!Array.isArray(raw) || raw.length === 0) {
      return playerRows.slice(0, 11);
    }
    return raw
      .map(normalizePlayerEntry)
      .filter((item) => item.sp_id > 0 && item.appearances > 0)
      .slice(0, 11);
  }, [playerReport?.top_players, playerRows]);
  const impactExplainPlayers = useMemo(
    () =>
      [...playerRows]
        .sort((left, right) => right.impact_score - left.impact_score)
        .slice(0, Math.min(4, playerRows.length)),
    [playerRows],
  );
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
  const formationNodes = useMemo(() => buildFormationNodes(topPlayerRows), [topPlayerRows]);
  const shotZone = analysis?.visuals?.shot_zone ?? {};
  const controllerBreakdown = useMemo(() => {
    const raw = playerReport?.controller_breakdown;
    if (!raw || typeof raw !== "object") return [] as Array<{ controller: string; count: number }>;
    return Object.entries(raw)
      .map(([controller, count]) => ({ controller, count: Number(count ?? 0) }))
      .filter((row) => Number.isFinite(row.count) && row.count > 0)
      .sort((left, right) => right.count - left.count);
  }, [playerReport?.controller_breakdown]);

  const currentContextLabel = useMemo(
    () => `${MATCH_LABELS[analysisMatchType]} · 최근 ${analysisWindowSize}경기`,
    [analysisMatchType, analysisWindowSize],
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
    if (officialRankers.length > 0 || similarRankersForView.length > 0) completed.add("rankers");
    if (evaluation || experimentPreview) completed.add("tracking");
    return completed;
  }, [actions.length, analysis, evaluation, experimentPreview, officialRankers.length, ouidInput, playerRows.length, similarRankersForView.length]);

  useEffect(() => {
    trackVisitorLifecycle(screen);
  }, [screen]);

  useEffect(() => {
    trackEvent("page_view", {
      screen,
      matchType,
      windowSize,
      ouid: ouidInput,
    });
  }, [screen, matchType, windowSize, ouidInput]);

  async function loadOfficialRankers(limit = 30, silent = true) {
    try {
      const payload = await requestApi<RankersLatestPayload>(`/rankers/latest?mode=1vs1&limit=${limit}`, undefined, { timeoutMs: 30_000 });
      setOfficialRankers(Array.isArray(payload.rankers) ? payload.rankers : []);
      setRankerMeta({
        mode: String(payload.mode ?? "1vs1"),
        count: Number(payload.count ?? 0),
        mapped: Number(payload.mapped_ouid_count ?? 0),
      });
      if (!silent) {
        setNotice(`랭커 데이터 ${Number(payload.count ?? 0)}명을 불러왔습니다.`);
      }
    } catch (rankerError) {
      if (!silent) {
        setError(normalizeErrorMessage(rankerError, "랭커 데이터 조회 실패"));
      }
    }
  }

  async function loadLatestExperimentPreview(targetOuid: string, targetMatchType: number): Promise<ExperimentPreview | null> {
    const safeOuid = targetOuid.trim();
    if (safeOuid.length < 8) {
      setExperimentPreview(null);
      return null;
    }
    setExperimentPreviewLoading(true);
    try {
      const payload = await requestApi<ExperimentPreviewPayload>(
        `/experiments/latest?ouid=${encodeURIComponent(safeOuid)}&match_type=${targetMatchType}`,
      );
      if (payload.exists) {
        setExperimentPreview(payload);
        return payload;
      }
      setExperimentPreview(null);
      return null;
    } catch {
      setExperimentPreview(null);
      return null;
    } finally {
      setExperimentPreviewLoading(false);
    }
  }

  useEffect(() => {
    if (screen === "rankers" && officialRankers.length === 0) {
      void loadOfficialRankers(30, true);
    }
  }, [officialRankers.length, screen]);

  useEffect(() => {
    if (screen !== "tracking") return;
    if (ouidInput.trim().length < 8) {
      setExperimentPreview(null);
      return;
    }
    void loadLatestExperimentPreview(ouidInput, matchType);
  }, [screen, ouidInput, matchType]);

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
        windowSize,
        properties: {
          mode,
          stage: "user_search",
          nickname_length: targetNickname.length,
          error_message: normalizeErrorMessage(searchError, "닉네임 조회 실패"),
        },
      });
      throw searchError;
    }
    setResolvedUser(found);
    setOuidInput(found.ouid);
    trackEvent("search_user", {
      screen: "search",
      matchType,
      windowSize,
      ouid: found.ouid,
      properties: { mode, source: found.source },
    });
    return found.ouid;
  }

  async function onRunAnalysis() {
    setAnalysisLoadingMode("advanced");
    setLoading(true);
    setError("");
    setNotice("");
    let targetOuid = "";
    try {
      targetOuid = await resolveOuidFromNickname("advanced");
      const currentTacticPayload = {
        defense_style: defenseStyle,
        buildup_play_style: buildupPlayStyle,
        chance_creation_style: chanceCreationStyle,
        buildup_style: buildupPlayStyle,
        defense_width: toModelScale(Number(defenseWidth)),
        defense_depth: toModelScale(Number(defenseDepth)),
        attack_width: toModelScale(Number(attackWidth)),
        box_players: toModelScale(Number(boxPlayers)),
        corner_kick: cornerKick,
        free_kick: freeKick,
        quick_defense_toggles: [],
        quick_attack_toggles: [],
      };
      const payload = await requestApi<AnalysisPayload>("/analysis/run", {
        method: "POST",
        body: JSON.stringify({
          ouid: targetOuid,
          match_type: matchType,
          window: windowSize,
          current_tactic: currentTacticPayload,
        }),
      }, { timeoutMs: 120_000 });
      setAnalysis(payload);
      const latestActions = payload.actions ? toActionCards(payload.actions) : [];
      setActions(latestActions);
      setAppliedTactic({
        defenseWidth: Number(defenseWidth),
        defenseDepth: Number(defenseDepth),
        attackWidth: Number(attackWidth),
        boxPlayers: Number(boxPlayers),
        buildupPlayStyle,
        chanceCreationStyle,
      });
      void loadOfficialRankers(30, true);
      setNotice(syncNoticeText(payload, "분석이 완료되었습니다."));
      setScreen("diagnosis");
      void loadLatestExperimentPreview(targetOuid, matchType);
      trackEvent("run_analysis", {
        screen: "search",
        matchType,
        windowSize,
        ouid: targetOuid,
        properties: {
          mode: "advanced",
          has_tactic_input: true,
          action_count: latestActions.length,
        },
      });
    } catch (analysisError) {
      const errorMessage = normalizeErrorMessage(analysisError, "분석 실행 실패");
      setError(errorMessage);
      if (targetOuid) {
        trackEvent("run_analysis_failed", {
          screen: "search",
          matchType,
          windowSize,
          ouid: targetOuid,
          properties: {
            mode: "advanced",
            stage: "analysis_run",
            error_message: errorMessage,
          },
        });
      }
    } finally {
      setLoading(false);
      setAnalysisLoadingMode(null);
    }
  }

  async function onQuickRun() {
    const targetNickname = nicknameInput.trim();
    if (targetNickname.length < 2) {
      setError("닉네임을 2글자 이상 입력해주세요.");
      return;
    }

    setAnalysisLoadingMode("quick");
    setLoading(true);
    setError("");
    setNotice("");
    setAnalysis(null);
    setActions([]);
    setAppliedTactic(null);
    setEvaluation(null);
    let targetOuid = "";
    try {
      targetOuid = await resolveOuidFromNickname("quick");
      const payload = await requestApi<AnalysisPayload>("/analysis/run", {
        method: "POST",
        body: JSON.stringify({
          ouid: targetOuid,
          match_type: matchType,
          window: windowSize,
          current_tactic: null,
        }),
      }, { timeoutMs: 120_000 });
      setAnalysis(payload);
      setActions(payload.actions ? toActionCards(payload.actions) : []);
      void loadOfficialRankers(30, true);
      setNotice(syncNoticeText(payload, "완료: 진단 실행"));
      setScreen("diagnosis");
      void loadLatestExperimentPreview(targetOuid, matchType);
      trackEvent("run_analysis", {
        screen: "search",
        matchType,
        windowSize,
        ouid: targetOuid,
        properties: {
          mode: "quick",
          has_tactic_input: false,
          action_count: payload.actions?.length ?? 0,
        },
      });
    } catch (quickRunError) {
      const errorMessage = normalizeErrorMessage(quickRunError, "빠른 실행 실패");
      setError(errorMessage);
      if (targetOuid) {
        trackEvent("run_analysis_failed", {
          screen: "search",
          matchType,
          windowSize,
          ouid: targetOuid,
          properties: {
            mode: "quick",
            stage: "analysis_run",
            error_message: errorMessage,
          },
        });
      }
    } finally {
      setLoading(false);
      setAnalysisLoadingMode(null);
    }
  }

  async function onAdoptAction(action: ActionCard) {
    const targetOuid = ouidInput.trim();
    if (targetOuid.length < 8) {
      setError("먼저 검색/설정에서 닉네임으로 진단을 실행해주세요.");
      return;
    }

    const experimentWindow = analysisWindowSize;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const payload = await requestApi<{ experiment_id: string }>("/experiments", {
        method: "POST",
        body: JSON.stringify({
          ouid: targetOuid,
          match_type: matchType,
          action_code: action.actionCode,
          action_title: action.title,
          window_size: experimentWindow,
          notes: "웹 대시보드에서 채택",
        }),
      });
      setNotice(`실험 생성 완료: ${payload.experiment_id} (기준 ${experimentWindow}경기)`);
      setScreen("tracking");
      void loadLatestExperimentPreview(targetOuid, matchType);
      trackEvent("adopt_action", {
        screen: "actions",
        matchType,
        windowSize: experimentWindow,
        ouid: targetOuid,
        properties: {
          action_code: action.actionCode,
          action_rank: action.rank,
          confidence: action.confidence,
        },
      });
    } catch (experimentError) {
      setError(experimentError instanceof Error ? experimentError.message : "실험 생성 실패");
      trackEvent("adopt_action_failed", {
        screen: "actions",
        matchType,
        windowSize,
        ouid: targetOuid,
      });
    } finally {
      setLoading(false);
    }
  }

  async function onEvaluateExperiment() {
    const targetOuid = ouidInput.trim();
    if (targetOuid.length < 8) {
      setError("먼저 검색/설정에서 닉네임으로 진단을 실행해주세요.");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");
    try {
      const latestExperiment = await loadLatestExperimentPreview(targetOuid, matchType);
      if (!latestExperiment) {
        setEvaluation(null);
        setNotice("아직 시작된 실험이 없습니다. 전술 코칭에서 먼저 실험을 시작해주세요.");
        return;
      }
      const payload = await requestApi<EvaluationPayload>(`/experiments/evaluation?ouid=${targetOuid}&match_type=${matchType}`);
      setEvaluation(payload);
      setNotice("실험 평가를 갱신했습니다.");
      void loadLatestExperimentPreview(targetOuid, matchType);
      trackEvent("view_evaluation", {
        screen: "tracking",
        matchType,
        windowSize,
        ouid: targetOuid,
      });
    } catch (evaluationError) {
      setError(evaluationError instanceof Error ? evaluationError.message : "실험 평가 실패");
      setEvaluation(null);
    } finally {
      setLoading(false);
    }
  }

  const primaryActions = useMemo(() => {
    const topAction = actions.reduce<ActionCard | null>(
      (best, action) => (best === null || action.rank < best.rank ? action : best),
      null,
    );
    return topAction ? [topAction] : [];
  }, [actions]);

  return (
    <div className="container grid">
      <header>
        <FCoachLogo />
        <p className="subtitle">
          FC온라인 닉네임만 입력하면 최근 경기 로그를 분석해 전술 코칭, 선수 리포트, 개선 추적을 제공합니다.
        </p>
      </header>

      <section className="panel grid">
        <div className="flow-rail">
          {SCREEN_FLOW.map((item) => (
            <button
              key={item.key}
              className={`flow-step ${screen === item.key ? "active" : ""} ${completedScreenSet.has(item.key) ? "done" : ""}`}
              onClick={() => {
                setScreen(item.key);
                trackEvent("tab_click", {
                  screen: item.key,
                  matchType,
                  windowSize,
                  ouid: ouidInput,
                  properties: { from_screen: screen },
                });
              }}
            >
              <span className="flow-icon">{item.icon}</span>
              <span className="flow-title">{SCREEN_LABELS[item.key]}</span>
              <span className="flow-hint">{item.hint}</span>
            </button>
          ))}
        </div>
        {screen !== "search" && <div className="context-banner">현재 분석 기준: {currentContextLabel}</div>}
        {!!notice && <div className="notice ok">{notice}</div>}
        {!!error && <div className="notice error">{error}</div>}
      </section>

      {screen === "search" && (
        <section className="panel grid">
          <h2 className="section-title">1) 검색 및 분석 실행</h2>
          <div className="notice ok">
            <strong>빠른 시작</strong>: 닉네임 입력 후 버튼 1번으로 분석까지 끝납니다.
          </div>
          <div className="option-strip">
            <div className="option-block">
              <div className="option-label">경기 모드</div>
              <div className="tabs">
                {MATCH_TYPE_OPTIONS.map((typeValue) => (
                  <button
                    key={typeValue}
                    className={`tab ${matchType === typeValue ? "active" : ""}`}
                    onClick={() => {
                      setMatchType(typeValue);
                      trackEvent("change_match_type", {
                        screen: "search",
                        matchType: typeValue,
                        windowSize,
                        ouid: ouidInput,
                      });
                    }}
                  >
                    {MATCH_LABELS[typeValue]}
                  </button>
                ))}
              </div>
            </div>
            <div className="option-block">
              <div className="option-label">집계 구간</div>
              <div className="tabs">
                {WINDOW_OPTIONS.map((windowValue) => (
                  <button
                    key={windowValue}
                    className={`tab ${windowSize === windowValue ? "active" : ""}`}
                    onClick={() => {
                      setWindowSize(windowValue);
                      trackEvent("change_window_size", {
                        screen: "search",
                        matchType,
                        windowSize: windowValue,
                        ouid: ouidInput,
                      });
                    }}
                  >
                    {windowValue}경기
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="form-row single">
            <input
              placeholder="닉네임"
              value={nicknameInput}
              onChange={(event) => {
                const nextValue = event.target.value;
                setNicknameInput(nextValue);
                if (resolvedUser && resolvedUser.nickname !== nextValue.trim()) {
                  setResolvedUser(null);
                }
              }}
            />
          </div>
          <div className="button-row">
            <button className="btn" onClick={onQuickRun} disabled={loading}>
              {loading && analysisLoadingMode === "quick" ? (
                <span className="btn-loading">
                  <span className="spinner" />
                  분석 중...
                </span>
              ) : (
                "빠른 시작 (닉네임→진단)"
              )}
            </button>
          </div>

          <div className="button-row">
            <button className="btn secondary" onClick={() => setShowAdvancedTactic((prev) => !prev)}>
              {showAdvancedTactic ? "고급 전술 입력 닫기" : "고급 전술 입력 열기"}
            </button>
          </div>
          {showAdvancedTactic && (
            <>
              <div className="notice ok">
                공식 노트 기준 팀전술 입력입니다. 수비/공격 폭·깊이·박스 안 쪽 선수는 1~10, 코너/프리킥은 1~5이며 수치가 높을수록 페널티 박스 공격 가담이 커집니다.
              </div>
              <div className="grid grid-2">
                <div className="field-card">
                  <label>수비 스타일</label>
                  <select value={defenseStyle} onChange={(event) => setDefenseStyle(event.target.value)}>
                    {DEFENSE_STYLE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-card">
                  <label>빌드업 플레이</label>
                  <select value={buildupPlayStyle} onChange={(event) => setBuildupPlayStyle(event.target.value)}>
                    {TACTIC_STYLE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-card">
                  <label>기회 만들기</label>
                  <select value={chanceCreationStyle} onChange={(event) => setChanceCreationStyle(event.target.value)}>
                    {TACTIC_STYLE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-card">
                  <label>수비 폭 (1~10)</label>
                  <select value={String(defenseWidth)} onChange={(event) => setDefenseWidth(Number(event.target.value))}>
                    {FC_TACTIC_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {value} · {tacticBandLabel(value, "defenseWidth")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-card">
                  <label>수비 깊이 (FC 전술값)</label>
                  <select value={String(defenseDepth)} onChange={(event) => setDefenseDepth(Number(event.target.value))}>
                    {FC_TACTIC_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {value} · {tacticBandLabel(value, "defenseDepth")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-card">
                  <label>공격 폭 (1~10)</label>
                  <select value={String(attackWidth)} onChange={(event) => setAttackWidth(Number(event.target.value))}>
                    {FC_TACTIC_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {value} · {tacticBandLabel(value, "attackWidth")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-card">
                  <label>박스 안 쪽 선수 (1~10)</label>
                  <select value={String(boxPlayers)} onChange={(event) => setBoxPlayers(Number(event.target.value))}>
                    {FC_TACTIC_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {value} · {tacticBandLabel(value, "boxPlayers")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-card">
                  <label>코너킥 공격 가담 성향 (1~5)</label>
                  <select value={String(cornerKick)} onChange={(event) => setCornerKick(Number(event.target.value))}>
                    {SET_PIECE_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value} · {setPieceLabel(value)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-card">
                  <label>프리킥 공격 가담 성향 (1~5)</label>
                  <select value={String(freeKick)} onChange={(event) => setFreeKick(Number(event.target.value))}>
                    {SET_PIECE_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value} · {setPieceLabel(value)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="button-row">
                <button className="btn" onClick={onRunAnalysis} disabled={loading}>
                  {loading && analysisLoadingMode === "advanced" ? (
                    <span className="btn-loading">
                      <span className="spinner" />
                      분석 중...
                    </span>
                  ) : (
                    "고급 전술 기준으로 재분석"
                  )}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {screen === "diagnosis" && (
        <section className="grid grid-3">
          <article className="panel">
            <h3 className="section-title">승률</h3>
              <div className="kpi-value">{formatPercent(toKpiValue(metrics, "win_rate"))}</div>
            <div className="muted">모드: {MATCH_LABELS[analysisMatchType]}</div>
          </article>
          <article className="panel">
            <h3 className="section-title">xG 차이</h3>
            <div className="kpi-value">
              {formatFixed(toKpiValue(metrics, "xg_for") - toKpiValue(metrics, "xg_against"))}
            </div>
            <div className="muted">
              xG For {formatFixed(toKpiValue(metrics, "xg_for"))} / xG Against {formatFixed(toKpiValue(metrics, "xg_against"))}
            </div>
          </article>
          <article className="panel">
            <h3 className="section-title">핵심 이슈</h3>
            <div className={`kpi-value ${issueTagClass}`}>{topIssue ? ISSUE_LABELS[topIssue.issueCode] ?? topIssue.issueCode : "-"}</div>
            <div className="muted">이슈 점수: {topIssue ? formatFixed(topIssue.score) : "-"}</div>
          </article>
          <article className="panel">
            <h3 className="section-title">득실</h3>
            <div className="kpi-value">
              {formatFixed(toKpiValue(metrics, "goals_for"))} : {formatFixed(toKpiValue(metrics, "goals_against"))}
            </div>
            <div className="muted">최근 {analysisWindowSize}경기 기준</div>
          </article>
          <article className="panel">
            <h3 className="section-title">유효슈팅 비율</h3>
            <div className="kpi-value">{formatPercent(toKpiValue(metrics, "shot_on_target_rate"))}</div>
            <div className="muted">오프사이드 평균 {formatFixed(toKpiValue(metrics, "offside_avg"))}</div>
          </article>
          <article className="panel">
            <h3 className="section-title">분석 시각</h3>
            <div className="kpi-value mini">{formatDate(analysis?.created_at)}</div>
            <div className="muted">데이터 표본 {formatFixed(toKpiValue(metrics, "match_count"), 0)}경기</div>
            <div className="muted">
              벤치마크: {BENCHMARK_SOURCE_LABEL[String(analysis?.benchmark_meta?.source ?? "unknown")] ?? String(analysis?.benchmark_meta?.source ?? "unknown")}
            </div>
          </article>
          <article className="panel span-3">
            <h3 className="section-title">최근 경기 요약</h3>
            <div className="muted compact">
              분석 생성 {formatDate(analysis?.created_at)} · 최신 경기 반영 시각 {formatDate(analysis?.latest_match_date ?? undefined)}
            </div>
            {recentMatches.length === 0 ? (
              <p className="muted">최근 경기 요약을 불러오지 못했습니다.</p>
            ) : (
              <div className="recent-match-list">
                {recentMatches.map((match, index) => (
                  <div key={`${match.match_date}-${match.opponent_nickname}-${index}`} className="recent-match-card">
                    <div className="recent-match-head">
                      <strong>{match.result || "-"}</strong>
                      <span>{formatDate(match.match_date)}</span>
                    </div>
                    <div className="recent-match-score">
                      {formatFixed(Number(match.score_for ?? 0), 0)} : {formatFixed(Number(match.score_against ?? 0), 0)}
                    </div>
                    <div className="muted compact">상대: {match.opponent_nickname || "알 수 없음"}</div>
                    <div className="muted compact">입력: {String(match.controller ?? "unknown").toLowerCase()}</div>
                  </div>
                ))}
              </div>
            )}
          </article>
          <article className="panel span-3">
            <h3 className="section-title">핵심 지표 한눈에 보기</h3>
            <div className="visual-metric-list">
              {visualMetricItems.map((item) => {
                const userProgress = item.reverse
                  ? toProgressPercent(Math.max(0, item.scaleMax - item.userValue), item.scaleMax)
                  : toProgressPercent(item.userValue, item.scaleMax);
                const benchmarkProgress = item.reverse
                  ? toProgressPercent(Math.max(0, item.scaleMax - item.benchmarkValue), item.scaleMax)
                  : toProgressPercent(item.benchmarkValue, item.scaleMax);
                return (
                  <div key={item.key} className="visual-metric-item">
                    <div className="visual-metric-head">
                      <span>{item.label}</span>
                      <strong>{item.userDisplay}</strong>
                    </div>
                    <div className={`progress-track ${item.reverse ? "reverse" : ""}`}>
                      <div className={`progress-fill ${item.reverse ? "reverse" : ""}`} style={{ width: `${userProgress}%` }} />
                      <div className="benchmark-marker" style={{ left: `${benchmarkProgress}%` }} />
                    </div>
                    <p className="muted compact">
                      랭커 기준 {item.benchmarkDisplay} · {item.reverse ? "낮을수록 유리" : "높을수록 유리"}
                    </p>
                  </div>
                );
              })}
            </div>
          </article>
          <article className="panel span-3">
            <h3 className="section-title">경기장 분석</h3>
            <div className="pitch-layout">
              <div className="pitch-panel">
                <div className="pitch-board half">
                  <div className="pitch-lines half-pitch-lines">
                    <div className="half-midline" />
                    <div className="half-center-circle" />
                    <div className="half-penalty-box" />
                    <div className="half-goal-box" />
                    <div className="half-goal-line" />
                  </div>
                  {halfPitchShotMap.map((point, index) => (
                    <span
                      key={`${point.left}-${point.top}-${index}`}
                      className={`shot-dot ${point.is_goal ? "goal" : "shot"}`}
                      style={{ left: `${point.left * 100}%`, top: `${point.top * 100}%` }}
                    />
                  ))}
                </div>
                <div className="pitch-legend">
                  <span><i className="dot shot" /> 슈팅</span>
                  <span><i className="dot goal" /> 득점</span>
                  <span>총 슈팅 {formatFixed(Number(shotZone.total_shots ?? 0), 0)}개</span>
                </div>
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
                  <p className="muted compact">좌/중/우 기준: 골문 기준 횡축 45% / 10% / 45%</p>
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
                  {goalTypeFor.length === 0 && <p className="muted compact">득점 슈팅 타입 데이터가 아직 부족합니다.</p>}
                  {goalTypeFor.length > 0 && (
                    <ul className="list compact">
                      {goalTypeFor.map((item) => (
                        <li key={`${item.type_code}-${item.label}`}>
                          {item.label}: {item.count}골 ({formatPercent(Number(item.ratio ?? 0))})
                        </li>
                      ))}
                    </ul>
                  )}
                  {!!goalTypeNote && <p className="muted compact">{goalTypeNote}</p>}
                </div>
              </div>
            </div>
          </article>
        </section>
      )}

      {screen === "habits" && (
        <section className="grid grid-2">
          <article className="panel">
            <h3 className="section-title">습관 진단 Top 3</h3>
            {toKpiValue(metrics, "match_count") < 5 && (
              <div className="notice warn">현재 표본이 {formatFixed(toKpiValue(metrics, "match_count"), 0)}경기라 이슈 점수 신뢰도가 낮습니다.</div>
            )}
            {sortedIssues.length === 0 && <p className="muted">분석 결과가 없습니다. 검색/설정에서 진단을 실행해주세요.</p>}
            <div className="issue-stack">
              {sortedIssues.slice(0, 3).map(([issueCode, score], index) => (
                <div key={issueCode} className="issue-row">
                  <div className="issue-row-head">
                    <span>
                      #{index + 1} {ISSUE_LABELS[issueCode] ?? issueCode}
                    </span>
                    <strong>{formatFixed(score)}점</strong>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill issue" style={{ width: `${toProgressPercent(score, 100)}%` }} />
                  </div>
                  <p className="muted compact">{ISSUE_DETAIL[issueCode] ?? issueCode}</p>
                </div>
              ))}
            </div>
          </article>
          <article className="panel">
            <h3 className="section-title">코치 요약</h3>
            <div className="coach-summary-stack">
              {actions.length === 0 && <div className="guide-card">전술 코칭을 생성하려면 먼저 진단을 실행해주세요.</div>}
              {actions.length > 0 && (
                <>
                  <div className="guide-card">
                    <div className="guide-title">이번 주 핵심 교정 1개</div>
                    <p>
                      {oneLinePrescription(
                        ISSUE_LABELS[actions[0].actionCode] ?? actions[0].actionCode,
                        tacticAdjustmentLines(actions[0].tacticDelta, appliedTactic),
                        tacticInputKnown,
                      )}
                    </p>
                  </div>
                  <div className="guide-card">
                    <div className="guide-title">바로 다음 단계</div>
                    <p>
                      {tacticInputKnown
                        ? "전술 코칭 탭에서 추천 #1을 채택하고 같은 전술로 플레이하세요."
                        : "전술 코칭 탭에서 추천 #1을 채택해 테스트한 뒤, 필요하면 고급 전술 입력으로 정밀 조정하세요."}
                    </p>
                  </div>
                </>
              )}
              <div className="guide-card">
                <div className="guide-title">해석 팁</div>
                <p>습관 분석은 문제 우선순위만 보여줍니다. 실제 전술값은 전술 코칭 탭에서 확정하세요.</p>
              </div>
            </div>
          </article>
        </section>
      )}

      {screen === "players" && (
        <section className="grid">
          <article className="panel">
            <h3 className="section-title">내 선수 리포트 ({MATCH_LABELS[analysisMatchType]} · 최근 {analysisWindowSize}경기)</h3>
            <p className="muted">
              공식 API `matchInfo.player.status` 집계 기준입니다. 경기당 누적 데이터를 선수 단위로 통합해 주전 기여도를 보여줍니다.
            </p>
            {!!analysis?.sample_scope && (
              <p className="muted compact">
                표본 필터:{" "}
                {analysis.sample_scope === "playable_only"
                  ? `키보드/패드 플레이 경기만 사용 (${Number(analysis.sample_count ?? 0)}경기)`
                  : `컨트롤러 구분 불가 매치를 포함해 사용 (${Number(analysis.sample_count ?? 0)}경기)`}
              </p>
            )}
            {controllerBreakdown.length > 0 && (
              <p className="muted compact">
                입력 방식 분포:{" "}
                {controllerBreakdown.map((row) => `${row.controller} ${row.count}경기`).join(" · ")}
              </p>
            )}
          </article>

          {playerRows.length === 0 && (
            <article className="panel">
              <p className="muted">선수 리포트 데이터가 없습니다. 검색/설정에서 먼저 진단을 실행해주세요.</p>
            </article>
          )}

          {playerRows.length > 0 && (
            <>
              <section className="grid grid-3">
                <article className="panel">
                  <h4 className="section-title">최다 득점</h4>
                  <div className="kpi-value mini">{playerReport?.top_scorer?.player_name ?? "-"}</div>
                  <p className="muted">
                    {formatFixed(Number(playerReport?.top_scorer?.goals ?? 0), 0)}골 · {String(playerReport?.top_scorer?.position_name ?? "-")}
                  </p>
                </article>
                <article className="panel">
                  <h4 className="section-title">최다 도움</h4>
                  <div className="kpi-value mini">{playerReport?.top_assister?.player_name ?? "-"}</div>
                  <p className="muted">
                    {formatFixed(Number(playerReport?.top_assister?.assists ?? 0), 0)}도움 · {String(playerReport?.top_assister?.position_name ?? "-")}
                  </p>
                </article>
                <article className="panel">
                  <h4 className="section-title">최다 출전</h4>
                  <div className="kpi-value mini">{playerReport?.most_used?.player_name ?? "-"}</div>
                  <p className="muted">
                    {formatFixed(Number(playerReport?.most_used?.appearances ?? 0), 0)}경기 · {String(playerReport?.most_used?.position_name ?? "-")}
                  </p>
                </article>
              </section>

              <article className="panel">
                <h4 className="section-title">주전 후보 Top 11 (포메이션 배치)</h4>
                <p className="muted compact">선수 포지션을 기준으로 자동 배치합니다. 동일 포지션 중복 시 좌우로 분산 표시됩니다.</p>
                <div className="formation-scroll">
                  <div className="formation-board">
                    <div className="formation-lines">
                      <div className="formation-midline" />
                      <div className="formation-center-circle" />
                      <div className="formation-box top" />
                      <div className="formation-box bottom" />
                      <div className="formation-goal top" />
                      <div className="formation-goal bottom" />
                    </div>
                    {formationNodes.map((player) => (
                      <div
                        key={`${player.sp_id}-${player.sp_position}`}
                        className="formation-player"
                        style={{ left: `${player.slot_left}%`, top: `${player.slot_top}%` }}
                      >
                        <div className="formation-player-head">
                          <PlayerPortrait player={player} alt={`${player.player_name} 미니페이스온`} className="player-face formation" />
                          <div className="formation-player-meta">
                            <strong>{player.player_name}</strong>
                            <span>{player.position_name}</span>
                          </div>
                        </div>
                        <div className="formation-player-top">
                          <span className={`enhance-badge ${enhanceLevelClass(player.sp_grade)}`}>+{normalizedGrade(player.sp_grade)}</span>
                          {player.season_img ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className="season-badge tiny" src={player.season_img} alt={`${player.season_name} 배지`} />
                          ) : (
                            <span className="season-badge tiny fallback">SE</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </article>

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
                          <PlayerPortrait player={player} alt={`${player.player_name} 미니페이스온`} className="player-face table" />
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
                              <PlayerPortrait player={player} alt={`${player.player_name} 미니페이스온`} className="player-face table" />
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
        </section>
      )}

      {screen === "actions" && (
        <section className="grid">
          <article className="panel coach-intro">
            <h3 className="section-title">오늘의 전술 코칭</h3>
            <p className="muted">
              가장 우선순위가 높은 추천 1개만 보여줍니다. 경기 전 적용하고 같은 모드에서 원하는 만큼 플레이한 뒤 다시 진단하면 개선 추적에서 전/후를 비교합니다.
            </p>
          </article>
          {actions.length === 0 && <article className="panel muted">전술 추천이 없습니다. 먼저 진단을 실행하세요.</article>}
          {primaryActions.map((action) => {
            const benchmarkCompare = getBenchmarkCompare(action.evidence);
            const metricGapTable = getMetricGapTable(action.evidence);
            const similarRankers = getSimilarRankers(action.evidence);
            const confidenceInfo = confidenceBand(action.confidence);
            const gapValue = Number(benchmarkCompare?.gap_value ?? 0);
            const guide = actionGuide(action.actionCode, gapValue, action.tacticDelta, tacticInputKnown);
            const coachExplanation = getCoachExplanation(action.evidence);
            const safeAdjustments = tacticAdjustmentLines(action.tacticDelta, appliedTactic);
            const focusPrescription = oneLinePrescription(
              ISSUE_LABELS[action.actionCode] ?? action.actionCode,
              safeAdjustments,
              tacticInputKnown,
            );
            const kpiTargets = buildCoachTargets(action.actionCode, metricGapTable, benchmarkCompare, similarRankers);
            return (
              <article key={`${action.rank}-${action.actionCode}`} className="panel">
                <h3 className="section-title">
                  {ISSUE_LABELS[action.actionCode] ?? action.actionCode}{" "}
                  <span className="pill">
                    신뢰도 {formatFixed(action.confidence, 2)} · <span className={confidenceInfo.className}>{confidenceInfo.label}</span>
                  </span>
                </h3>
                <div className="coach-focus-grid single">
                  <div className="focus-card primary">
                    <p className="action-title">1개 처방</p>
                    <p className="focus-line">{focusPrescription}</p>
                    <p className="muted compact">{coachExplanation?.coach_message || guide.why}</p>
                    {!!coachExplanation?.root_cause && <p className="muted compact">근거: {coachExplanation.root_cause}</p>}
                  </div>
                  <div className="focus-card">
                    <p className="action-title">전술 변경 추천</p>
                    <ul className="list compact">
                      {safeAdjustments.slice(0, 4).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                      {(coachExplanation?.execution_checklist ?? []).slice(0, 2).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    <p className="muted compact">방향: {TACTIC_DIRECTION_KO[action.actionCode] ?? action.tacticDirection}</p>
                  </div>
                  <div className="focus-card">
                    <p className="action-title">다음 진단 때 확인할 것</p>
                    {kpiTargets.length === 0 && <p className="muted compact">목표 지표를 계산할 데이터가 부족합니다.</p>}
                    {kpiTargets.length > 0 && (
                      <ul className="list compact">
                        {kpiTargets.slice(0, 2).map((target) => (
                          <li key={target.metricName}>
                            <strong>
                              {target.metricLabel}: {target.currentText} → {target.targetText}
                            </strong>
                            <div className="muted compact">{target.reasonText}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="muted compact">{coachExplanation?.expected_effect || guide.verify}</p>
                  </div>
                </div>
                <details className="detail-block">
                  <summary>랭커 기준과 세부 근거 보기</summary>
                  <div className="detail-content">
                    <p className="muted compact">목표 기준: 랭커 기준치{similarRankers.length > 0 ? ` + 유사 랭커 ${similarRankers.length}명` : ""}</p>
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
                  <button className="btn" onClick={() => onAdoptAction(action)} disabled={loading}>
                    이 추천으로 실험 시작
                  </button>
                </div>
                <p className="muted compact">
                  실험 시작 후 같은 모드로 최소 3경기, 가능하면 5경기 이상 플레이하고 다시 진단 실행 → 개선 추적에서 평가 갱신 순서로 확인하세요.
                </p>
              </article>
            );
          })}
        </section>
      )}

      {screen === "rankers" && (
        <section className="grid grid-2">
          <article className="panel">
            <h3 className="section-title">공식 랭커 데이터</h3>
            <div className="button-row">
              <button className="btn secondary" onClick={() => void loadOfficialRankers(30, false)} disabled={loading}>
                랭커 데이터 다시 불러오기
              </button>
            </div>
            <p className="muted">
              모드 {rankerMeta?.mode ?? "1vs1"} · 저장 {rankerMeta?.count ?? 0}명 · OUID 매핑 {rankerMeta?.mapped ?? 0}명
            </p>
            {officialRankers.length === 0 && <p className="muted">저장된 랭커 데이터가 없습니다. 잠시 후 다시 불러와주세요.</p>}
            {officialRankers.length > 0 && (
              <ul className="list compact">
                {officialRankers.slice(0, 15).map((ranker) => (
                  <li key={`${ranker.ouid}-${ranker.rank_no}`}>
                    #{ranker.rank_no} {ranker.nickname} · 승률 {formatPercent(ranker.win_rate)} · 포메 {ranker.formation || "-"} · 팀컬러 {ranker.team_color || "-"}
                  </li>
                ))}
              </ul>
            )}
          </article>
          <article className="panel">
            <h3 className="section-title">나와 성향이 비슷한 공식 랭커</h3>
            {similarRankersForView.length === 0 && (
              <p className="muted">
                {analysis
                  ? "유사 랭커 계산에 필요한 랭커 경기 프로필이 부족합니다. 랭커 데이터 재로딩 후 다시 진단해주세요."
                  : "먼저 진단을 실행하면 유사 랭커 후보가 표시됩니다."}
              </p>
            )}
            {similarRankersForView.map((ranker) => (
              <div key={ranker.ouid} className="similar-item">
                <p>
                  공식 #{ranker.ranker_proxy_rank} · {ranker.nickname || "닉네임 미확인"} · 유사도 {formatFixed(ranker.similarity, 3)} · 승률{" "}
                  {formatPercent(ranker.win_rate)}
                </p>
                <p className="muted">
                  포메이션 {ranker.formation || "-"} / 팀컬러 {ranker.team_color || "-"} / 신뢰도 {formatFixed(ranker.reliability, 2)} / {similarRankerSourceLabel(ranker.source)}
                </p>
                <ul className="list compact muted">
                  {ranker.metric_comparisons.slice(0, 5).map((comparison) => (
                    <li key={`${ranker.ouid}-${comparison.metric_name}`}>
                      {comparison.metric_label}: 내 값 {formatFixed(comparison.user_value, 3)} / 랭커 {formatFixed(comparison.candidate_value, 3)} / 차이{" "}
                      {formatDeltaSigned(comparison.gap_value)} ({compareText(comparison.gap_value, comparison.higher_is_better)})
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </article>
        </section>
      )}

      {screen === "tracking" && (
        <section className="grid grid-2">
          <article className="panel span-2">
            <h3 className="section-title">평가 실행</h3>
            <p className="muted">최근 채택한 액션 실험의 전/후 지표를 계산합니다.</p>
            <p className="muted compact">
              실험 시작 후 플레이한 경기만 POST로 계산합니다. 새 경기를 마친 뒤에는 먼저 검색/설정에서 다시 진단을 실행하고 평가를 갱신하세요.
            </p>
            <div className="notice ok">
              {experimentPreviewLoading && "실험 상태를 확인 중입니다..."}
              {!experimentPreviewLoading && !experimentPreview && "시작된 실험이 없습니다. 전술 코칭에서 먼저 실험 시작을 눌러주세요."}
              {!experimentPreviewLoading && experimentPreview && (
                <>
                  <strong>진행 중 실험</strong>: {experimentPreview.action_title} (
                  {ISSUE_LABELS[experimentPreview.action_code] ?? experimentPreview.action_code}) · 시작{" "}
                  {formatDate(experimentPreview.started_at)} · 평가 기준 최대 {experimentPreview.window_size}경기 · 상태 {experimentPreview.status}
                  {experimentPreview.latest_evaluated_at ? ` · 최근 평가 ${formatDate(experimentPreview.latest_evaluated_at)}` : " · 아직 평가 기록 없음"}
                </>
              )}
            </div>
            <button className="btn" onClick={onEvaluateExperiment} disabled={loading}>
              {loading ? "평가 중..." : "최신 실험 평가 갱신"}
            </button>
            <p className="muted">평가 시각: {formatDate(evaluation?.evaluated_at)}</p>
            {evaluation && (
              <p className="muted">
                비교 표본: PRE {Number(evaluation.pre_match_count ?? 0)}경기 / POST {Number(evaluation.post_match_count ?? 0)}경기
                {" · "}평가 기준 최대 {Number(evaluation.window_size ?? 0)}경기
                {evaluation.sample_scope === "playable_only" ? " (키보드/패드 기준)" : ""}
              </p>
            )}
            {evaluation?.sync_warning && <div className="notice warn">{evaluation.sync_warning}</div>}
          </article>
          {trackingCoach && (
            <article className="panel span-2">
              <h3 className="section-title">코치 해석 · 다음 방향</h3>
              <div className="coach-focus-grid compact">
                <div className="focus-card primary">
                  <p className="action-title">핵심 해석</p>
                  <p className="focus-line">{trackingCoach.headline}</p>
                  <p className="muted">{trackingCoach.guidance}</p>
                </div>
                <div className="focus-card">
                  <p className="action-title">평가 신뢰도</p>
                  <p className="focus-line">
                    {trackingCoach.reliabilityLabel} · <span className={trackingCoach.reliabilityClassName}>{trackingCoach.outcomeLabel}</span>
                  </p>
                  <p className="muted">{trackingCoach.reliabilityDetail}</p>
                </div>
                <div className="focus-card">
                  <p className="action-title">다음 추천 실험</p>
                  <p className="focus-line">{trackingCoach.recommendationTitle}</p>
                  <p className="muted">{trackingCoach.recommendationDescription}</p>
                  <p className="muted compact">{trackingCoach.recommendationReason}</p>
                </div>
              </div>
              <div className="tracking-insight-list">
                {trackingCoach.metricInsights.map((item) => (
                  <div key={item.key} className={`tracking-insight-item ${item.tone}`}>
                    <p className="action-title">{item.label}</p>
                    <p className="focus-line">{item.deltaText}</p>
                    <p className="muted">{item.comment}</p>
                  </div>
                ))}
              </div>
            </article>
          )}
          <article className="panel">
            <h3 className="section-title">적용 전·후 요약</h3>
            <ul className="list">
              <li>
                승률: {formatPercent(toKpiValue(evaluation?.pre ?? {}, "win_rate"))} →{" "}
                {formatPercent(toKpiValue(evaluation?.post ?? {}, "win_rate"))}
              </li>
              <li>
                xG For: {formatFixed(toKpiValue(evaluation?.pre ?? {}, "xg_for"))} →{" "}
                {formatFixed(toKpiValue(evaluation?.post ?? {}, "xg_for"))}
              </li>
              <li>
                xG Against: {formatFixed(toKpiValue(evaluation?.pre ?? {}, "xg_against"))} →{" "}
                {formatFixed(toKpiValue(evaluation?.post ?? {}, "xg_against"))}
              </li>
              <li>
                유효슈팅 비율: {formatPercent(toKpiValue(evaluation?.pre ?? {}, "shot_on_target_rate"))} →{" "}
                {formatPercent(toKpiValue(evaluation?.post ?? {}, "shot_on_target_rate"))}
              </li>
            </ul>
          </article>
          <article className="panel">
            <h3 className="section-title">변화량 (POST - PRE)</h3>
            <ul className="list">
              <li>승률 Δ: {formatFixed(toKpiValue(evaluation?.delta ?? {}, "win_rate"))}</li>
              <li>xG For Δ: {formatFixed(toKpiValue(evaluation?.delta ?? {}, "xg_for"))}</li>
              <li>xG Against Δ: {formatFixed(toKpiValue(evaluation?.delta ?? {}, "xg_against"))}</li>
              <li>유효슈팅 비율 Δ: {formatFixed(toKpiValue(evaluation?.delta ?? {}, "shot_on_target_rate"))}</li>
            </ul>
          </article>
          <article className="panel span-2">
            <h3 className="section-title">변화 시각화</h3>
            {(() => {
              const preCount = Number(evaluation?.pre_match_count ?? 0);
              const postCount = Number(evaluation?.post_match_count ?? 0);
              const preXgFor = toKpiValue(evaluation?.pre ?? {}, "xg_for");
              const postXgFor = toKpiValue(evaluation?.post ?? {}, "xg_for");
              const preXgAgainst = toKpiValue(evaluation?.pre ?? {}, "xg_against");
              const postXgAgainst = toKpiValue(evaluation?.post ?? {}, "xg_against");

              const xgForPerMatchDelta =
                preCount > 0 && postCount > 0 ? postXgFor / postCount - preXgFor / preCount : toKpiValue(evaluation?.delta ?? {}, "xg_for");
              const xgAgainstPerMatchDelta =
                preCount > 0 && postCount > 0
                  ? postXgAgainst / postCount - preXgAgainst / preCount
                  : toKpiValue(evaluation?.delta ?? {}, "xg_against");

              const visualItems = [
                { key: "win_rate", label: "승률 Δ", delta: toKpiValue(evaluation?.delta ?? {}, "win_rate"), scale: 0.2 },
                { key: "xg_for_per_match", label: "경기당 xG For Δ", delta: xgForPerMatchDelta, scale: 0.6 },
                { key: "xg_against_per_match", label: "경기당 xG Against Δ(감소 권장)", delta: xgAgainstPerMatchDelta, scale: 0.6, reverse: true },
                { key: "shot_on_target_rate", label: "유효슈팅 Δ", delta: toKpiValue(evaluation?.delta ?? {}, "shot_on_target_rate"), scale: 0.15 },
              ];

              return (
            <div className="visual-metric-list">
              {visualItems.map((item) => {
                const directionAdjusted = item.reverse ? -item.delta : item.delta;
                const normalized = Math.tanh(directionAdjusted / item.scale);
                const barWidth = Math.abs(normalized) * 50;
                const left = normalized >= 0 ? 50 : 50 - barWidth;
                const tone = normalized > 0.08 ? "good" : normalized < -0.08 ? "bad" : "neutral";
                const toneLabel = tone === "good" ? "개선" : tone === "bad" ? "악화" : "보합";
                return (
                  <div key={item.key} className="visual-metric-item">
                    <div className="visual-metric-head">
                      <span>{item.label}</span>
                      <strong>{formatFixed(item.delta, 3)}</strong>
                    </div>
                    <div className={`visual-metric-note ${tone}`}>{toneLabel}</div>
                    <div className="delta-track">
                      <div className="delta-centerline" />
                      <div
                        className={`delta-fill ${tone}`}
                        style={{
                          left: `${left}%`,
                          width: `${barWidth}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
              );
            })()}
          </article>
        </section>
      )}

      {screen === "guide" && (
        <GuideScreen
          hasActions={actions.length > 0}
          hasExperiment={Boolean(experimentPreview)}
          onOpenActions={() => setScreen("actions")}
          onOpenTracking={() => setScreen("tracking")}
          onStartSearch={() => setScreen("search")}
        />
      )}

      <footer className="app-footer">
        <div className="footer-top">
          <strong>© 2026 FCOACH</strong>
          <div className="footer-links">
            <button className="link-like" onClick={() => setScreen("guide")}>
              이용 가이드
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
