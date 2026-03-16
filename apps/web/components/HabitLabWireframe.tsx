"use client";

import { useEffect, useMemo, useState } from "react";
import { FCoachLogo } from "./FCoachLogo";

type ScreenKey = "search" | "diagnosis" | "players" | "habits" | "actions" | "rankers" | "tracking" | "guide";
type MatchType = 50 | 60 | 52;
type WindowSize = 5 | 10 | 30;

const SCREEN_LABELS: Record<ScreenKey, string> = {
  search: "검색/설정",
  diagnosis: "진단 대시보드",
  players: "선수 리포트",
  habits: "습관 분석",
  actions: "액션 플랜",
  rankers: "랭커 분석",
  tracking: "개선 추적",
  guide: "이용 가이드",
};

const SCREEN_FLOW: { key: ScreenKey; icon: string; hint: string }[] = [
  { key: "search", icon: "🔎", hint: "대상/옵션 선택" },
  { key: "diagnosis", icon: "📊", hint: "핵심 지표 진단" },
  { key: "players", icon: "🧾", hint: "선수별 성과 분석" },
  { key: "habits", icon: "🧩", hint: "문제 습관 분해" },
  { key: "actions", icon: "🎯", hint: "핵심 액션 실행" },
  { key: "rankers", icon: "🏅", hint: "랭커 비교 분석" },
  { key: "tracking", icon: "📈", hint: "적용 효과 검증" },
  { key: "guide", icon: "📘", hint: "서비스 활용법" },
];

const MATCH_LABELS: Record<MatchType, string> = {
  50: "공식경기",
  60: "공식 친선",
  52: "감독모드",
};

const MATCH_TYPE_OPTIONS: MatchType[] = [50, 60];
const WINDOW_OPTIONS: WindowSize[] = [5, 10, 30];

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

type IssueCode =
  | "HIGH_LATE_CONCEDE"
  | "LOW_FINISHING"
  | "POOR_SHOT_SELECTION"
  | "OFFSIDE_RISK"
  | "BUILDUP_INEFFICIENCY"
  | "DEFENSE_DUEL_WEAKNESS"
  | "CHANCE_CREATION_LOW"
  | "POSSESSION_CONTROL_RISK"
  | "INSUFFICIENT_DATA";

type MetricMap = Record<string, number>;
type IssueMap = Record<string, number>;

type UserSearchResponse = {
  ouid: string;
  nickname: string;
  source: string;
};

type AnalysisPayload = {
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

type VisualSummary = {
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

type ShotPoint = { x: number; y: number; is_goal: boolean };
type TimingBucket = { label: string; count: number };
type GoalTypeBucket = { type_code: number; label: string; count: number; ratio: number };
type PlayerReportEntry = {
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
};

type FormationNode = PlayerReportEntry & {
  slot_left: number;
  slot_top: number;
};
type PlayerReportSummary = {
  sample_matches: number;
  controller_breakdown?: Record<string, number>;
  player_count: number;
  top_players?: PlayerReportEntry[];
  players?: PlayerReportEntry[];
  top_scorer?: PlayerReportEntry | null;
  top_assister?: PlayerReportEntry | null;
  most_used?: PlayerReportEntry | null;
};
type PlayerReport = PlayerReportSummary;

type RawActionCard = {
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

type ActionCard = {
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

type EvaluationPayload = {
  experiment_id: string;
  window_size: number;
  started_at: string;
  pre: MetricMap;
  post: MetricMap;
  delta: MetricMap;
  evaluated_at: string;
};

type SimilarRanker = {
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

type SimilarMetricComparison = {
  metric_name: string;
  metric_label: string;
  higher_is_better: boolean;
  user_value: number;
  candidate_value: number;
  gap_value: number;
};

type CoachExplanation = {
  coach_message: string;
  root_cause?: string;
  execution_checklist?: string[];
  in_game_signals?: string[];
  failure_patterns?: string[];
  expected_effect?: string;
  source?: string;
};

type OfficialRanker = {
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

type RankersLatestPayload = {
  mode: string;
  count: number;
  mapped_ouid_count: number;
  rankers: OfficialRanker[];
};

const ISSUE_LABELS: Record<string, string> = {
  HIGH_LATE_CONCEDE: "후반 실점 리스크",
  LOW_FINISHING: "마무리 효율 저하",
  POOR_SHOT_SELECTION: "슈팅 선택 품질 저하",
  OFFSIDE_RISK: "오프사이드 빈도 리스크",
  BUILDUP_INEFFICIENCY: "빌드업 효율 저하",
  DEFENSE_DUEL_WEAKNESS: "수비 경합 약세",
  CHANCE_CREATION_LOW: "찬스 생성량 저하",
  POSSESSION_CONTROL_RISK: "점유 안정성 리스크",
  INSUFFICIENT_DATA: "표본 부족",
  MAINTAIN_PERFORMANCE: "유지 권장",
};

const ISSUE_DETAIL: Record<string, string> = {
  HIGH_LATE_CONCEDE: "후반 집중력/수비 라인 안정화가 필요합니다.",
  LOW_FINISHING: "기대득점 대비 실제 득점이 낮아 마무리 개선이 필요합니다.",
  POOR_SHOT_SELECTION: "낮은 기대값 슈팅 비중이 높습니다.",
  OFFSIDE_RISK: "오프사이드 발생 빈도가 높습니다. 침투/패스 시도 빈도 조정이 필요합니다.",
  BUILDUP_INEFFICIENCY: "패스/스루패스 연결 효율이 낮아 전개 안정화가 필요합니다.",
  DEFENSE_DUEL_WEAKNESS: "1차 수비 경합에서 밀리고 있어 수비 구조 보완이 필요합니다.",
  CHANCE_CREATION_LOW: "경기당 슈팅·xG 생성량이 낮아 공격 전개 볼륨 보강이 필요합니다.",
  POSSESSION_CONTROL_RISK: "점유 안정성이 낮아 공격 전환 전에 볼 순환 품질 개선이 필요합니다.",
  INSUFFICIENT_DATA: "최소 5경기 이상 데이터가 필요합니다.",
  MAINTAIN_PERFORMANCE: "현재 전술을 유지하면서 동일 조건에서 추가 표본을 수집하세요.",
};

const TACTIC_DIRECTION_KO: Record<string, string> = {
  HIGH_LATE_CONCEDE: "후반 수비 라인 안정화",
  LOW_FINISHING: "페널티박스 내 고품질 슈팅 유도",
  POOR_SHOT_SELECTION: "빌드업 인내도 상승으로 저효율 슈팅 감소",
  OFFSIDE_RISK: "침투 타이밍 지연 및 무리한 스루패스 축소",
  BUILDUP_INEFFICIENCY: "전개 연결 안정화",
  DEFENSE_DUEL_WEAKNESS: "수비 블록 압축 및 경합 강화",
  CHANCE_CREATION_LOW: "공격 전개 볼륨 확대",
  POSSESSION_CONTROL_RISK: "점유 안정화 우선",
  INSUFFICIENT_DATA: "추가 표본 수집 우선",
  MAINTAIN_PERFORMANCE: "전술 유지 및 추적 관찰",
};

const METRIC_LABEL_KO: Record<string, string> = {
  late_concede_ratio: "후반 실점 비율(낮을수록 좋음)",
  goals_per_sot: "유효슈팅 대비 득점률(높을수록 좋음)",
  in_box_shot_ratio: "박스 안 슈팅 비중(높을수록 좋음)",
  shot_on_target_rate: "유효슈팅 비율(높을수록 좋음)",
  pass_success_rate: "패스 성공률(높을수록 좋음)",
  through_pass_success_rate: "스루패스 성공률(높을수록 좋음)",
  tackle_success_rate: "태클 성공률(높을수록 좋음)",
  shots_per_match: "경기당 슈팅수(높을수록 좋음)",
  goals_against_per_match: "경기당 실점(낮을수록 좋음)",
  possession_avg: "평균 점유율(높을수록 좋음)",
  offside_avg: "오프사이드 평균(낮을수록 좋음)",
  overall: "전체 퍼포먼스",
  xg_for_per_match: "경기당 xG",
};

const BENCHMARK_SOURCE_LABEL: Record<string, string> = {
  official_rank_1vs1: "공식 랭킹(1vs1)",
  ranker_proxy_v1: "기본 기준(공식 랭커 매핑 전)",
  top_cohort_v1: "수집 데이터 상위권 코호트",
};

const FC_TACTIC_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const SET_PIECE_OPTIONS = [1, 2, 3, 4, 5];
const DEFENSE_STYLE_OPTIONS = ["후퇴", "밸런스", "볼터치 실수시 압박", "공 뺏긴 직후 압박", "지속적인 압박"];
const BUILDUP_STYLE_OPTIONS = ["느린 빌드업", "밸런스", "긴 패스", "빠른 빌드업"];
const DISTINCT_ID_KEY = "fcoach_distinct_id";
const SESSION_ID_KEY = "fcoach_session_id";

type RequestApiOptions = {
  timeoutMs?: number;
};

function ensureStorageId(storage: Storage, key: string): string {
  const existing = storage.getItem(key);
  if (existing) return existing;
  const generated = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  storage.setItem(key, generated);
  return generated;
}

function maskOuid(ouid: string): string {
  const value = ouid.trim();
  if (value.length < 10) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function trackEvent(
  eventName: string,
  payload: {
    screen?: string;
    matchType?: number;
    windowSize?: number;
    ouid?: string;
    properties?: Record<string, unknown>;
  },
): void {
  if (typeof window === "undefined") return;
  try {
    const distinctId = ensureStorageId(window.localStorage, DISTINCT_ID_KEY);
    const sessionId = ensureStorageId(window.sessionStorage, SESSION_ID_KEY);
    const body = {
      event_name: eventName,
      distinct_id: distinctId,
      session_id: sessionId,
      path: window.location.pathname,
      screen: payload.screen ?? null,
      referrer: document.referrer || null,
      properties: {
        match_type: payload.matchType ?? null,
        window_size: payload.windowSize ?? null,
        ouid_masked: payload.ouid ? maskOuid(payload.ouid) : null,
        ...(payload.properties ?? {}),
      },
    };
    void fetch(`${API_BASE_URL}/events/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    return;
  }
}

async function requestApi<T>(path: string, init?: RequestInit, options?: RequestApiOptions): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: init?.signal ?? controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = typeof body.detail === "string" ? body.detail : `HTTP ${res.status}`;
      throw new Error(detail);
    }
    return (await res.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

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

function toModelScale(fcValue: number): number {
  return Math.max(1, Math.min(10, Math.round(fcValue)));
}

function toFcScale(modelValue: number): number {
  return Math.max(1, Math.min(10, Math.round(modelValue)));
}

function tacticBandLabel(value: number, field: "defenseWidth" | "defenseDepth" | "attackWidth" | "boxPlayers"): string {
  if (field === "defenseWidth") {
    if (value <= 3) return "중앙 압축형";
    if (value <= 7) return "균형";
    return "측면 커버형";
  }
  if (field === "defenseDepth") {
    if (value <= 3) return "깊은 라인";
    if (value <= 7) return "균형";
    return "높은 라인";
  }
  if (field === "attackWidth") {
    if (value <= 3) return "중앙 연계형";
    if (value <= 7) return "균형";
    return "측면 확장형";
  }
  if (value <= 3) return "역습 대비형";
  if (value <= 7) return "균형";
  return "박스 침투형";
}

function setPieceLabel(value: number): string {
  if (value <= 2) return "수비적";
  if (value === 3) return "균형";
  return "공격적";
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

function normalizedGrade(grade: number): number {
  const numeric = Math.round(Number.isFinite(grade) ? grade : 0);
  if (numeric <= 0) return 1;
  return Math.min(13, numeric);
}

function enhanceLevelClass(grade: number): string {
  const normalized = normalizedGrade(grade);
  return `level-${normalized}`;
}

function normalizeMatchType(value: unknown, fallback: MatchType): MatchType {
  const numeric = Number(value);
  if (numeric === 50 || numeric === 52 || numeric === 60) return numeric;
  return fallback;
}

function playerFaceCandidates(player: Pick<PlayerReportEntry, "face_img" | "action_img" | "fallback_img" | "sp_id">): string[] {
  const pid = Math.max(1, Number(player.sp_id) % 1_000_000);
  const defaults = [
    player.face_img,
    player.action_img,
    `https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/players/p${pid}.png`,
    `https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/playersAction/p${player.sp_id}.png`,
    player.fallback_img,
    "https://ssl.nexon.com/s2/game/fc/mobile/squadMaker/default/d_player.png",
  ];
  return Array.from(new Set(defaults.filter((item): item is string => typeof item === "string" && item.trim().length > 0)));
}

function PlayerPortrait({
  player,
  alt,
  className,
}: {
  player: Pick<PlayerReportEntry, "face_img" | "action_img" | "fallback_img" | "sp_id">;
  alt: string;
  className: string;
}) {
  const candidates = useMemo(() => playerFaceCandidates(player), [player]);
  const [imageIndex, setImageIndex] = useState(0);

  useEffect(() => {
    setImageIndex(0);
  }, [candidates]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={candidates[imageIndex] ?? "https://ssl.nexon.com/s2/game/fc/mobile/squadMaker/default/d_player.png"}
      alt={alt}
      onError={() => setImageIndex((prev) => (prev + 1 < candidates.length ? prev + 1 : prev))}
    />
  );
}

function normalizeWindowSize(value: unknown, fallback: WindowSize): WindowSize {
  const numeric = Number(value);
  if (numeric === 5 || numeric === 10 || numeric === 30) return numeric;
  return fallback;
}

const POSITION_COORDS: Record<string, { left: number; top: number }> = {
  GK: { left: 50, top: 92 },
  SW: { left: 50, top: 84 },
  CB: { left: 50, top: 80 },
  LCB: { left: 41, top: 80 },
  RCB: { left: 59, top: 80 },
  LB: { left: 25, top: 77 },
  RB: { left: 75, top: 77 },
  LWB: { left: 17, top: 73 },
  RWB: { left: 83, top: 73 },
  CDM: { left: 50, top: 68 },
  LDM: { left: 40, top: 68 },
  RDM: { left: 60, top: 68 },
  CM: { left: 50, top: 59 },
  LCM: { left: 38, top: 59 },
  RCM: { left: 62, top: 59 },
  LM: { left: 24, top: 56 },
  RM: { left: 76, top: 56 },
  LW: { left: 24, top: 31 },
  RW: { left: 76, top: 31 },
  CAM: { left: 50, top: 46 },
  LAM: { left: 34, top: 44 },
  RAM: { left: 66, top: 44 },
  CF: { left: 50, top: 35 },
  LF: { left: 38, top: 32 },
  RF: { left: 62, top: 32 },
  LWF: { left: 24, top: 29 },
  RWF: { left: 76, top: 29 },
  LWS: { left: 30, top: 26 },
  RWS: { left: 70, top: 26 },
  LS: { left: 44, top: 24 },
  RS: { left: 56, top: 24 },
  ST: { left: 50, top: 20 },
};

const POSITION_TABLE_ORDER = [
  "GK",
  "RB",
  "RWB",
  "RCB",
  "CB",
  "SW",
  "LCB",
  "LB",
  "LWB",
  "RDM",
  "CDM",
  "LDM",
  "RM",
  "RCM",
  "CM",
  "LCM",
  "LM",
  "RAM",
  "CAM",
  "LAM",
  "RW",
  "RWF",
  "RF",
  "RS",
  "CF",
  "ST",
  "LS",
  "LF",
  "LWF",
  "LW",
] as const;

const POSITION_TABLE_INDEX = new Map<string, number>(POSITION_TABLE_ORDER.map((key, index) => [key, index]));

const FALLBACK_SLOTS: Record<"DEF" | "MID" | "ATT", Array<{ left: number; top: number }>> = {
  DEF: [
    { left: 20, top: 78 },
    { left: 35, top: 80 },
    { left: 50, top: 81 },
    { left: 65, top: 80 },
    { left: 80, top: 78 },
  ],
  MID: [
    { left: 24, top: 57 },
    { left: 38, top: 60 },
    { left: 50, top: 61 },
    { left: 62, top: 60 },
    { left: 76, top: 57 },
  ],
  ATT: [
    { left: 28, top: 34 },
    { left: 42, top: 27 },
    { left: 50, top: 23 },
    { left: 58, top: 27 },
    { left: 72, top: 34 },
  ],
};

function inferPositionLane(positionName: string): "DEF" | "MID" | "ATT" {
  const upper = positionName.toUpperCase();
  if (upper.includes("B") || upper.includes("CB") || upper.includes("WB")) return "DEF";
  if (upper.includes("M") || upper === "CDM") return "MID";
  return "ATT";
}

function tablePositionGroup(positionName: string): number {
  const upper = positionName.toUpperCase().trim();
  if (upper === "SUB") return 4;
  if (upper === "GK") return 0;
  if (["SW", "CB", "LCB", "RCB", "LB", "RB", "LWB", "RWB"].includes(upper)) return 1;
  if (["CDM", "LDM", "RDM", "CM", "LCM", "RCM", "LM", "RM", "CAM", "LAM", "RAM"].includes(upper)) return 2;
  return 3;
}

function tablePositionOrder(positionName: string): number {
  const upper = positionName.toUpperCase().trim();
  if (upper === "SUB") return 999;
  return POSITION_TABLE_INDEX.get(upper) ?? 900;
}

function buildFormationNodes(players: PlayerReportEntry[]): FormationNode[] {
  if (!players.length) return [];
  const capped = players.slice(0, 11);
  const laneCursor = { DEF: 0, MID: 0, ATT: 0 };
  const occupiedCount = new Map<string, number>();

  return capped.map((player) => {
    const positionKey = player.position_name.toUpperCase().trim();
    const fixed = POSITION_COORDS[positionKey];
    let slot = fixed;
    if (!slot) {
      const lane = inferPositionLane(positionKey);
      const laneSlots = FALLBACK_SLOTS[lane];
      slot = laneSlots[Math.min(laneCursor[lane], laneSlots.length - 1)];
      laneCursor[lane] += 1;
    }
    const key = `${slot.left}-${slot.top}`;
    const duplicateIndex = occupiedCount.get(key) ?? 0;
    occupiedCount.set(key, duplicateIndex + 1);
    const jitter = duplicateIndex === 0 ? 0 : (duplicateIndex % 2 === 0 ? 1 : -1) * Math.ceil(duplicateIndex / 2) * 3;
    return {
      ...player,
      slot_left: Math.max(8, Math.min(92, slot.left + jitter)),
      slot_top: slot.top,
    };
  });
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

type ActionGuide = {
  why: string;
  doNow: string;
  verify: string;
};

type MetricGapEntry = {
  metric_name: string;
  metric_label: string;
  user_value: number;
  benchmark_value: number;
  gap_value: number;
  higher_is_better: boolean;
};

type ConfidenceDetail = {
  sample_score: number;
  severity_score: number;
  tactic_input_known: number;
  final_confidence: number;
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

type CurrentTactic = {
  defenseWidth: number;
  defenseDepth: number;
  attackWidth: number;
  boxPlayers: number;
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

function getConfidenceDetail(evidence: Record<string, unknown> | undefined): ConfidenceDetail | null {
  if (!evidence) return null;
  const raw = evidence["confidence_detail"];
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  return {
    sample_score: Number(value.sample_score ?? 0),
    severity_score: Number(value.severity_score ?? 0),
    tactic_input_known: Number(value.tactic_input_known ?? 1),
    final_confidence: Number(value.final_confidence ?? 0),
  };
}

function confidenceBand(value: number): { label: string; className: string } {
  if (value >= 0.75) return { label: "높음", className: "issue-low" };
  if (value >= 0.55) return { label: "보통", className: "issue-mid" };
  return { label: "낮음", className: "issue-high" };
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

function oneLinePrescription(actionCode: string, adjustments: string[], tacticInputKnown: boolean): string {
  const mainAdjustment = adjustments.find((line) => line !== "권장 전술 변경 없음") ?? "현재 전술 유지";
  const issueLabel = ISSUE_LABELS[actionCode] ?? actionCode;
  if (!tacticInputKnown) {
    return `${mainAdjustment} 방향을 5경기 테스트해 ${issueLabel} 개선 추세를 먼저 확인하세요.`;
  }
  return `${mainAdjustment}를 5경기 고정 적용해 ${issueLabel}를 우선 교정하세요.`;
}

function fallbackPlanB(actionCode: string, tacticInputKnown: boolean): string[] {
  if (actionCode === "CHANCE_CREATION_LOW") {
    return [
      "2경기 연속 xG 개선이 없으면 공격 폭을 추가 +1 조정",
      tacticInputKnown
        ? "여전히 정체면 다음 3경기는 빌드업 스타일을 밸런스로 고정"
        : "여전히 정체면 다음 3경기는 빌드업 스타일 후보(밸런스/느린 빌드업) 중 1개를 테스트",
    ];
  }
  if (actionCode === "LOW_FINISHING") {
    return [
      "2경기 연속 득점률 정체 시 박스 안 쪽 선수 값을 1단계 더 상향",
      "중거리 비중 과다 시 다음 경기부터 공격 폭을 1단계 하향",
    ];
  }
  if (actionCode === "OFFSIDE_RISK") {
    return [
      "2경기 평균 오프사이드 0.7 이상이면 공격 폭을 추가 -1 조정",
      "찬스 급감 시 스루패스 비중만 복원하고 전술 수치는 유지",
    ];
  }
  if (actionCode === "HIGH_LATE_CONCEDE") {
    return [
      "2경기 연속 후반 실점 발생 시 수비 깊이 추가 -1 조정",
      "역습 실점 반복이면 풀백 오버랩 빈도를 다음 경기에서 제한",
    ];
  }
  return [
    "2경기 연속 목표 미달이면 동일 이슈 액션을 1단계 강화",
    "연패가 이어지면 다음 경기 시작 전 액션 #2로 전환",
  ];
}

function actionGuide(
  actionCode: string,
  gapValue: number,
  tacticDelta: Record<string, unknown>,
  tacticInputKnown: boolean,
): ActionGuide {
  if (actionCode === "HIGH_LATE_CONCEDE") {
    const target = typeof tacticDelta.defense_depth_target === "number" ? toFcScale(Number(tacticDelta.defense_depth_target)) : null;
    return {
      why: `후반 실점 비율이 기준 대비 ${gapValue >= 0 ? "+" : ""}${formatFixed(gapValue, 3)} 차이입니다.`,
      doNow: tacticInputKnown
        ? `수비 스타일을 보수적으로 두고(후퇴/밸런스), 수비 깊이를 1단계 낮춰 목표 ${target ?? "권장값"}로 5경기 고정하세요.`
        : `수비 스타일을 보수적으로 두고(후퇴/밸런스), 수비 깊이 -1 방향을 5경기 테스트하세요.`,
      verify: "다음 5경기 후 후반 실점 비율이 최소 0.10 이상 내려가면 유지, 아니면 수비 폭을 1단계 추가 하향하세요.",
    };
  }
  if (actionCode === "LOW_FINISHING") {
    return {
      why: `유효슈팅 대비 득점률이 기준보다 ${gapValue >= 0 ? "+" : ""}${formatFixed(gapValue, 3)} 차이입니다.`,
      doNow: "박스 안 쪽 선수 수치를 1단계 올리고, 공격 폭은 1단계 줄여 마무리 위치를 더 안쪽으로 유도하세요.",
      verify: "5경기 뒤 유효슈팅 대비 득점률이 기준치에 근접하면 유지합니다.",
    };
  }
  if (actionCode === "POOR_SHOT_SELECTION") {
    return {
      why: `박스 안 슈팅 비중이 기준 대비 ${gapValue >= 0 ? "+" : ""}${formatFixed(gapValue, 3)}입니다.`,
      doNow: "빌드업 스타일을 느린 빌드업/밸런스로 변경하고, 박스 안 쪽 선수·공격 폭을 각 1단계 낮춰 무리한 슛을 줄이세요.",
      verify: "5경기 뒤 박스 안 슈팅 비중과 유효슈팅 비율이 함께 상승하면 유지합니다.",
    };
  }
  if (actionCode === "OFFSIDE_RISK") {
    return {
      why: `오프사이드 평균이 기준 대비 ${gapValue >= 0 ? "+" : ""}${formatFixed(gapValue, 3)}입니다.`,
      doNow: "공격 폭을 1단계 줄이고, 빠른 공격 전술(박스 안 침투/스트라이커 추가)은 필요 시점에만 사용하세요.",
      verify: "5경기 뒤 오프사이드 평균이 0.3 이상 감소하면 성공입니다.",
    };
  }
  if (actionCode === "BUILDUP_INEFFICIENCY") {
    return {
      why: `빌드업 핵심 지표가 기준 대비 ${gapValue >= 0 ? "+" : ""}${formatFixed(gapValue, 3)}입니다.`,
      doNow: "빌드업 스타일을 밸런스로 두고 공격 폭/박스 침투 수치를 1단계 낮춰 연결 안정성을 먼저 확보하세요.",
      verify: "5경기 뒤 패스·스루패스 성공률이 동시에 상승하면 유지합니다.",
    };
  }
  if (actionCode === "DEFENSE_DUEL_WEAKNESS") {
    return {
      why: `수비 경합 지표가 기준 대비 ${gapValue >= 0 ? "+" : ""}${formatFixed(gapValue, 3)}입니다.`,
      doNow: "수비 폭과 수비 깊이를 1단계 낮춰 라인 간격을 줄이고, 1차 저지 안정화를 우선 적용하세요.",
      verify: "5경기 뒤 경기당 실점과 태클 성공률이 동시에 개선되면 유지합니다.",
    };
  }
  if (actionCode === "CHANCE_CREATION_LOW") {
    return {
      why: `찬스 생성 지표가 기준 대비 ${gapValue >= 0 ? "+" : ""}${formatFixed(gapValue, 3)}입니다.`,
      doNow: "공격 폭과 박스 안 쪽 선수 수치를 각각 1단계 올려 슈팅 볼륨을 확보하세요.",
      verify: "5경기 뒤 경기당 xG 또는 슈팅수가 유의미하게 증가하면 유지합니다.",
    };
  }
  if (actionCode === "POSSESSION_CONTROL_RISK") {
    return {
      why: `점유 안정 지표가 기준 대비 ${gapValue >= 0 ? "+" : ""}${formatFixed(gapValue, 3)}입니다.`,
      doNow: "빌드업을 느린 빌드업/밸런스로 설정하고 공격 폭을 1단계 줄여 볼 순환 안정성을 확보하세요.",
      verify: "5경기 뒤 점유율과 패스 성공률이 동시에 개선되면 유지합니다.",
    };
  }
  return {
    why: "고우선순위 이슈가 없어 현재 전술을 유지해도 됩니다.",
    doNow: "현재 세팅을 유지하고, 데이터가 쌓이면 다시 분석하세요.",
    verify: "5경기 뒤 승률/실점이 악화되면 그때 액션 플랜을 다시 적용합니다.",
  };
}

function tacticAdjustmentLines(tacticDelta: Record<string, unknown>, current: CurrentTactic | null): string[] {
  const base = current ?? { defenseWidth: 0, defenseDepth: 0, attackWidth: 0, boxPlayers: 0 };
  const lines: string[] = [];
  if (typeof tacticDelta.defense_style_target === "string") {
    lines.push(`수비 스타일: ${String(tacticDelta.defense_style_target)}`);
  }
  if (typeof tacticDelta.buildup_style_target === "string") {
    lines.push(`빌드업 스타일: ${String(tacticDelta.buildup_style_target)}`);
  }
  if (typeof tacticDelta.defense_width_delta === "number") {
    if (typeof tacticDelta.defense_width_target === "number") {
      const target = toFcScale(Number(tacticDelta.defense_width_target));
      lines.push(current ? `수비 폭 ${base.defenseWidth} → ${target}` : `수비 폭 목표: ${target}`);
    } else if (current) {
      lines.push(`수비 폭 ${base.defenseWidth} → ${toFcScale(base.defenseWidth + Number(tacticDelta.defense_width_delta))}`);
    } else {
      lines.push(`수비 폭 변화: ${Number(tacticDelta.defense_width_delta) > 0 ? "+" : ""}${Number(tacticDelta.defense_width_delta)}`);
    }
  }
  if (typeof tacticDelta.defense_depth_delta === "number") {
    if (typeof tacticDelta.defense_depth_target === "number") {
      const target = toFcScale(Number(tacticDelta.defense_depth_target));
      lines.push(current ? `수비 깊이 ${base.defenseDepth} → ${target}` : `수비 깊이 목표: ${target}`);
    } else if (current) {
      lines.push(`수비 깊이 ${base.defenseDepth} → ${toFcScale(base.defenseDepth + Number(tacticDelta.defense_depth_delta))}`);
    } else {
      lines.push(`수비 깊이 변화: ${Number(tacticDelta.defense_depth_delta) > 0 ? "+" : ""}${Number(tacticDelta.defense_depth_delta)}`);
    }
  }
  if (typeof tacticDelta.attack_width_delta === "number") {
    if (typeof tacticDelta.attack_width_target === "number") {
      const target = toFcScale(Number(tacticDelta.attack_width_target));
      lines.push(current ? `공격 폭 ${base.attackWidth} → ${target}` : `공격 폭 목표: ${target}`);
    } else if (current) {
      lines.push(`공격 폭 ${base.attackWidth} → ${toFcScale(base.attackWidth + Number(tacticDelta.attack_width_delta))}`);
    } else {
      lines.push(`공격 폭 변화: ${Number(tacticDelta.attack_width_delta) > 0 ? "+" : ""}${Number(tacticDelta.attack_width_delta)}`);
    }
  }
  if (typeof tacticDelta.box_players_delta === "number") {
    if (typeof tacticDelta.box_players_target === "number") {
      const target = toFcScale(Number(tacticDelta.box_players_target));
      lines.push(current ? `박스 안 쪽 선수 ${base.boxPlayers} → ${target}` : `박스 안 쪽 선수 목표: ${target}`);
    } else if (current) {
      lines.push(`박스 안 쪽 선수 ${base.boxPlayers} → ${toFcScale(base.boxPlayers + Number(tacticDelta.box_players_delta))}`);
    } else {
      lines.push(`박스 안 쪽 선수 변화: ${Number(tacticDelta.box_players_delta) > 0 ? "+" : ""}${Number(tacticDelta.box_players_delta)}`);
    }
  }
  if (Array.isArray(tacticDelta.quick_attack_off) && tacticDelta.quick_attack_off.length > 0) {
    lines.push(`빠른 공격 전술 해제 권장: ${tacticDelta.quick_attack_off.join(", ")}`);
  }
  if (typeof tacticDelta.cdm_stay_back === "boolean") {
    lines.push(`CDM 후방대기 ${tacticDelta.cdm_stay_back ? "켜기" : "끄기"}`);
  }
  if (lines.length === 0) {
    lines.push("권장 전술 변경 없음");
  }
  return lines;
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
  const [screen, setScreen] = useState<ScreenKey>("search");
  const [matchType, setMatchType] = useState<MatchType>(60);
  const [windowSize, setWindowSize] = useState<WindowSize>(30);
  const [nicknameInput, setNicknameInput] = useState("맹장축구");
  const [resolvedUser, setResolvedUser] = useState<UserSearchResponse | null>(null);
  const [ouidInput, setOuidInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [analysis, setAnalysis] = useState<AnalysisPayload | null>(null);
  const [actions, setActions] = useState<ActionCard[]>([]);
  const [evaluation, setEvaluation] = useState<EvaluationPayload | null>(null);
  const [officialRankers, setOfficialRankers] = useState<OfficialRanker[]>([]);
  const [rankerMeta, setRankerMeta] = useState<{ mode: string; count: number; mapped: number } | null>(null);

  const [defenseStyle, setDefenseStyle] = useState("밸런스");
  const [buildupStyle, setBuildupStyle] = useState("밸런스");
  const [defenseWidth, setDefenseWidth] = useState(5);
  const [defenseDepth, setDefenseDepth] = useState(6);
  const [attackWidth, setAttackWidth] = useState(5);
  const [boxPlayers, setBoxPlayers] = useState(6);
  const [cornerKick, setCornerKick] = useState(3);
  const [freeKick, setFreeKick] = useState(3);
  const [appliedTactic, setAppliedTactic] = useState<CurrentTactic | null>(null);
  const [showAdvancedTactic, setShowAdvancedTactic] = useState(false);
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
      return getSimilarRankers({ similar_rankers: analysis.similar_rankers });
    }
    if (actions.length > 0) {
      return getSimilarRankers(actions[0].evidence);
    }
    return [];
  }, [analysis, actions]);

  const sortedIssues = useMemo(
    () => Object.entries(issues).sort((left, right) => right[1] - left[1]),
    [issues],
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
  const goalTypeNote = String(analysis?.visuals?.goal_type_note ?? "");
  const playerReport = analysis?.visuals?.player_report;
  const playerRows = useMemo(() => {
    const raw = playerReport?.players;
    if (!Array.isArray(raw)) return [] as PlayerReportEntry[];
    return raw
      .map((item) => ({
        sp_id: Number((item as PlayerReportEntry).sp_id ?? 0),
        player_name: String((item as PlayerReportEntry).player_name ?? ""),
        season_id: Number((item as PlayerReportEntry).season_id ?? 0),
        season_name: String((item as PlayerReportEntry).season_name ?? "-"),
        season_img: String((item as PlayerReportEntry).season_img ?? ""),
        face_img: String((item as PlayerReportEntry).face_img ?? ""),
        action_img: String((item as PlayerReportEntry).action_img ?? ""),
        fallback_img: String((item as PlayerReportEntry).fallback_img ?? ""),
        sp_position: Number((item as PlayerReportEntry).sp_position ?? -1),
        position_name: String((item as PlayerReportEntry).position_name ?? "-"),
        sp_grade: Number((item as PlayerReportEntry).sp_grade ?? 0),
        appearances: Number((item as PlayerReportEntry).appearances ?? 0),
        goals: Number((item as PlayerReportEntry).goals ?? 0),
        assists: Number((item as PlayerReportEntry).assists ?? 0),
        goal_involvements: Number((item as PlayerReportEntry).goal_involvements ?? 0),
        shots: Number((item as PlayerReportEntry).shots ?? 0),
        effective_shots: Number((item as PlayerReportEntry).effective_shots ?? 0),
        pass_success_rate: Number((item as PlayerReportEntry).pass_success_rate ?? 0),
        tackle_success_rate: Number((item as PlayerReportEntry).tackle_success_rate ?? 0),
        avg_rating: Number((item as PlayerReportEntry).avg_rating ?? 0),
        impact_score: Number((item as PlayerReportEntry).impact_score ?? 0),
      }))
      .filter((item) => item.sp_id > 0 && item.appearances > 0);
  }, [playerReport?.players]);
  const topPlayerRows = useMemo(() => {
    const raw = playerReport?.top_players;
    if (!Array.isArray(raw) || raw.length === 0) {
      return playerRows.slice(0, 11);
    }
    return raw
      .map((item) => ({
        sp_id: Number((item as PlayerReportEntry).sp_id ?? 0),
        player_name: String((item as PlayerReportEntry).player_name ?? ""),
        season_id: Number((item as PlayerReportEntry).season_id ?? 0),
        season_name: String((item as PlayerReportEntry).season_name ?? "-"),
        season_img: String((item as PlayerReportEntry).season_img ?? ""),
        face_img: String((item as PlayerReportEntry).face_img ?? ""),
        action_img: String((item as PlayerReportEntry).action_img ?? ""),
        fallback_img: String((item as PlayerReportEntry).fallback_img ?? ""),
        sp_position: Number((item as PlayerReportEntry).sp_position ?? -1),
        position_name: String((item as PlayerReportEntry).position_name ?? "-"),
        sp_grade: Number((item as PlayerReportEntry).sp_grade ?? 0),
        appearances: Number((item as PlayerReportEntry).appearances ?? 0),
        goals: Number((item as PlayerReportEntry).goals ?? 0),
        assists: Number((item as PlayerReportEntry).assists ?? 0),
        goal_involvements: Number((item as PlayerReportEntry).goal_involvements ?? 0),
        shots: Number((item as PlayerReportEntry).shots ?? 0),
        effective_shots: Number((item as PlayerReportEntry).effective_shots ?? 0),
        pass_success_rate: Number((item as PlayerReportEntry).pass_success_rate ?? 0),
        tackle_success_rate: Number((item as PlayerReportEntry).tackle_success_rate ?? 0),
        avg_rating: Number((item as PlayerReportEntry).avg_rating ?? 0),
        impact_score: Number((item as PlayerReportEntry).impact_score ?? 0),
      }))
      .filter((item) => item.sp_id > 0 && item.appearances > 0)
      .slice(0, 11);
  }, [playerReport?.top_players, playerRows]);
  const playerRowsForTable = useMemo(
    () =>
      [...playerRows].sort((left, right) => {
        const leftGroup = tablePositionGroup(left.position_name);
        const rightGroup = tablePositionGroup(right.position_name);
        if (leftGroup !== rightGroup) return leftGroup - rightGroup;

        const leftOrder = tablePositionOrder(left.position_name);
        const rightOrder = tablePositionOrder(right.position_name);
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;

        if (left.appearances !== right.appearances) return right.appearances - left.appearances;
        if (left.impact_score !== right.impact_score) return right.impact_score - left.impact_score;
        return left.player_name.localeCompare(right.player_name, "ko");
      }),
    [playerRows],
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
    if (evaluation) completed.add("tracking");
    return completed;
  }, [actions.length, analysis, evaluation, officialRankers.length, ouidInput, playerRows.length, similarRankersForView.length]);

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

  useEffect(() => {
    if (screen === "rankers" && officialRankers.length === 0) {
      void loadOfficialRankers(30, true);
    }
  }, [officialRankers.length, screen]);

  async function resolveOuidFromNickname(): Promise<string> {
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
    const found = await requestApi<UserSearchResponse>(`/users/search?nickname=${encodeURIComponent(targetNickname)}`);
    setResolvedUser(found);
    setOuidInput(found.ouid);
    trackEvent("search_user", {
      screen: "search",
      matchType,
      windowSize,
      ouid: found.ouid,
      properties: { source: found.source },
    });
    return found.ouid;
  }

  async function onRunAnalysis() {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const targetOuid = await resolveOuidFromNickname();
      const currentTacticPayload = {
        defense_style: defenseStyle,
        buildup_style: buildupStyle,
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
      });
      void loadOfficialRankers(30, true);
      const syncNotice = payload.sync_warning
        ? `${payload.sync_warning} (최근 경기 시각: ${payload.latest_match_date ?? "확인 불가"})`
        : "분석이 완료되었습니다.";
      setNotice(syncNotice);
      setScreen("diagnosis");
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
      setError(normalizeErrorMessage(analysisError, "분석 실행 실패"));
      trackEvent("run_analysis_failed", {
        screen: "search",
        matchType,
        windowSize,
        ouid: ouidInput,
      });
    } finally {
      setLoading(false);
    }
  }

  async function onQuickRun() {
    const targetNickname = nicknameInput.trim();
    if (targetNickname.length < 2) {
      setError("닉네임을 2글자 이상 입력해주세요.");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");
    setAnalysis(null);
    setActions([]);
    setAppliedTactic(null);
    setEvaluation(null);
    try {
      const targetOuid = await resolveOuidFromNickname();
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
      const syncNotice = payload.sync_warning
        ? `${payload.sync_warning} (최근 경기 시각: ${payload.latest_match_date ?? "확인 불가"})`
        : "완료: 진단 실행";
      setNotice(syncNotice);
      setScreen("diagnosis");
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
      setError(normalizeErrorMessage(quickRunError, "빠른 실행 실패"));
      trackEvent("run_analysis_failed", {
        screen: "search",
        matchType,
        windowSize,
        ouid: ouidInput,
      });
    } finally {
      setLoading(false);
    }
  }

  async function onAdoptAction(action: ActionCard) {
    const targetOuid = ouidInput.trim();
    if (targetOuid.length < 8) {
      setError("먼저 검색/설정에서 닉네임으로 진단을 실행해주세요.");
      return;
    }

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
          window_size: windowSize,
          notes: "웹 대시보드에서 채택",
        }),
      });
      setNotice(`실험 생성 완료: ${payload.experiment_id}`);
      setScreen("tracking");
      trackEvent("adopt_action", {
        screen: "actions",
        matchType,
        windowSize,
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
      const payload = await requestApi<EvaluationPayload>(`/experiments/evaluation?ouid=${targetOuid}&match_type=${matchType}`);
      setEvaluation(payload);
      setNotice("실험 평가를 갱신했습니다.");
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

  return (
    <div className="container grid">
      <header>
        <FCoachLogo />
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
              {loading ? "처리 중..." : "빠른 시작 (닉네임→진단)"}
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
                공식 노트 기준 핵심 팀전술 입력입니다. 수비/공격 폭·깊이·박스 안 쪽 선수는 1~10, 코너/프리킥은 1~5를 사용합니다.
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
                  <label>빌드업 스타일</label>
                  <select value={buildupStyle} onChange={(event) => setBuildupStyle(event.target.value)}>
                    {BUILDUP_STYLE_OPTIONS.map((option) => (
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
                  <label>코너킥 참여 인원 (1~5)</label>
                  <select value={String(cornerKick)} onChange={(event) => setCornerKick(Number(event.target.value))}>
                    {SET_PIECE_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value} · {setPieceLabel(value)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-card">
                  <label>프리킥 참여 인원 (1~5)</label>
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
                  {loading ? "처리 중..." : "고급 전술 기준으로 재분석"}
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
              {actions.length === 0 && <div className="guide-card">액션 플랜을 생성하려면 먼저 진단을 실행해주세요.</div>}
              {actions.length > 0 && (
                <>
                  <div className="guide-card">
                    <div className="guide-title">이번 주 핵심 교정 1개</div>
                    <p>{oneLinePrescription(actions[0].actionCode, tacticAdjustmentLines(actions[0].tacticDelta, appliedTactic), tacticInputKnown)}</p>
                  </div>
                  <div className="guide-card">
                    <div className="guide-title">바로 다음 단계</div>
                    <p>
                      {tacticInputKnown
                        ? "액션 플랜 탭에서 액션 #1을 채택하고 5경기 고정 적용하세요."
                        : "액션 플랜 탭에서 액션 #1을 채택하고 5경기 테스트 후 고급 전술 입력으로 정밀 조정하세요."}
                    </p>
                  </div>
                </>
              )}
              <div className="guide-card">
                <div className="guide-title">해석 팁</div>
                <p>습관 분석은 문제 우선순위만 보여줍니다. 실제 전술값은 액션 플랜 탭에서 확정하세요.</p>
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
                <div className="player-table-wrap">
                  <table className="player-table">
                    <thead>
                      <tr>
                        <th>선수</th>
                        <th>시즌</th>
                        <th>강화</th>
                        <th>포지션</th>
                        <th>출전</th>
                        <th>골</th>
                        <th>도움</th>
                        <th>유효슛</th>
                        <th>패스성공률</th>
                        <th>태클성공률</th>
                        <th>평균평점</th>
                        <th>영향점수</th>
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
          <article className="panel">
            <h3 className="section-title">액션 플랜 사용 순서</h3>
            <div className="usage-flow">
              <div className="usage-step">
                <span className="usage-index">1</span>
                <p>{tacticInputKnown ? "액션 #1을 우선 5경기 고정 적용" : "액션 #1을 우선 5경기 테스트 적용"}</p>
              </div>
              <div className="usage-step">
                <span className="usage-index">2</span>
                <p>{tacticInputKnown ? "경기 중 전술은 바꾸지 않고 결과만 기록" : "경기 중 전술 변경은 최소화하고 결과만 기록"}</p>
              </div>
              <div className="usage-step">
                <span className="usage-index">3</span>
                <p>5경기 후 개선 추적에서 전/후 비교</p>
              </div>
            </div>
          </article>
          {actions.length === 0 && <article className="panel muted">액션 카드가 없습니다. 먼저 진단을 실행하세요.</article>}
          {actions.map((action) => {
            const benchmarkCompare = getBenchmarkCompare(action.evidence);
            const metricGapTable = getMetricGapTable(action.evidence);
            const similarRankers = getSimilarRankers(action.evidence);
            const confidenceDetail = getConfidenceDetail(action.evidence);
            const confidenceInfo = confidenceBand(action.confidence);
            const gapValue = Number(benchmarkCompare?.gap_value ?? 0);
            const guide = actionGuide(action.actionCode, gapValue, action.tacticDelta, tacticInputKnown);
            const coachExplanation = getCoachExplanation(action.evidence);
            const safeAdjustments = tacticAdjustmentLines(action.tacticDelta, appliedTactic);
            const focusPrescription = oneLinePrescription(action.actionCode, safeAdjustments, tacticInputKnown);
            const kpiTargets = buildCoachTargets(action.actionCode, metricGapTable, benchmarkCompare, similarRankers);
            const planBItems = fallbackPlanB(action.actionCode, tacticInputKnown);
            const isPrimaryAction = action.rank === 1;
            return (
              <article key={`${action.rank}-${action.actionCode}`} className="panel">
                <h3 className="section-title">
                  액션 #{action.rank}{" "}
                  <span className="pill">
                    신뢰도 {formatFixed(action.confidence, 2)} · <span className={confidenceInfo.className}>{confidenceInfo.label}</span>
                  </span>
                </h3>
                <p className="muted">이슈: {ISSUE_LABELS[action.actionCode] ?? action.actionCode}</p>
                <div className={`coach-focus-grid ${isPrimaryAction ? "" : "compact"}`.trim()}>
                  <div className={`focus-card ${isPrimaryAction ? "primary" : ""}`.trim()}>
                    <p className="action-title">{isPrimaryAction ? "오늘의 1개 처방" : "보조 액션"}</p>
                    <p className="focus-line">{focusPrescription}</p>
                    <p className="muted compact">{coachExplanation?.coach_message || guide.why}</p>
                    {confidenceDetail && (
                      <p className="muted compact">
                        신뢰도 근거: 기본 0.25 + 표본({formatFixed(confidenceDetail.sample_score)}×0.50) + 이슈강도(
                        {formatFixed(confidenceDetail.severity_score)}×0.25)
                        {confidenceDetail.tactic_input_known < 0.5 ? " + 전술 미입력 보정 적용" : ""}
                      </p>
                    )}
                    <p className="muted compact">
                      목표 기준: 랭커 기준치{similarRankers.length > 0 ? ` + 유사 랭커 ${similarRankers.length}명` : ""}.
                    </p>
                  </div>
                  <div className="focus-card">
                    <p className="action-title">5경기 체크리스트(숫자 목표 2개)</p>
                    {kpiTargets.length === 0 && <p className="muted compact">목표 지표를 계산할 데이터가 부족합니다.</p>}
                    {kpiTargets.length > 0 && (
                      <ul className="list compact">
                        {kpiTargets.map((target) => (
                          <li key={target.metricName}>
                            <strong>
                              {target.metricLabel}: {target.currentText} → {target.targetText}
                            </strong>
                            <div className="muted compact">
                              기준 {target.benchmarkText}
                              {target.similarText ? ` · 유사 랭커 ${target.similarText}` : ""}
                            </div>
                            <div className="muted compact">{target.reasonText}</div>
                            <div className="muted compact">{target.formulaText}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="focus-card">
                    <p className="action-title">개선 없을 때 플랜B</p>
                    <ul className="list compact">
                      {planBItems.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                {isPrimaryAction && (
                <details className="detail-block">
                  <summary>상세 코칭 노트</summary>
                  <div className="detail-content">
                    <div className="action-grid">
                      <div className="action-block">
                        <p className="action-title">왜 바꾸나</p>
                        <p>{coachExplanation?.coach_message || guide.why}</p>
                        {!!coachExplanation?.root_cause && <p className="muted compact">근거: {coachExplanation.root_cause}</p>}
                      </div>
                      <div className="action-block">
                        <p className="action-title">전술 변경 추천</p>
                        <ul className="list compact">
                          {safeAdjustments.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                          {(coachExplanation?.execution_checklist ?? []).slice(0, 3).map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                        <p className="muted">방향: {TACTIC_DIRECTION_KO[action.actionCode] ?? action.tacticDirection}</p>
                      </div>
                      <div className="action-block">
                        <p className="action-title">검증 기준</p>
                        <p>{coachExplanation?.expected_effect || guide.verify}</p>
                        {(coachExplanation?.in_game_signals ?? []).length > 0 && (
                          <>
                            <p className="muted compact">
                              {tacticInputKnown ? "경기 중 관찰 포인트(전술 고정)" : "경기 중 관찰 포인트(전술 변경 최소화)"}
                            </p>
                            <ul className="list compact">
                              {(coachExplanation?.in_game_signals ?? []).slice(0, 2).map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          </>
                        )}
                        {(coachExplanation?.failure_patterns ?? []).length > 0 && (
                          <>
                            <p className="muted compact">주의 패턴</p>
                            <ul className="list compact">
                              {(coachExplanation?.failure_patterns ?? []).slice(0, 2).map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </details>
                )}
                <div className="button-row">
                  <button className="btn" onClick={() => onAdoptAction(action)} disabled={loading}>
                    이 액션으로 실험 시작
                  </button>
                </div>
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
            {similarRankersForView.length === 0 && <p className="muted">먼저 진단을 실행하면 유사 랭커 후보가 표시됩니다.</p>}
            {similarRankersForView.map((ranker) => (
              <div key={ranker.ouid} className="similar-item">
                <p>
                  공식 #{ranker.ranker_proxy_rank} · {ranker.nickname || "닉네임 미확인"} · 유사도 {formatFixed(ranker.similarity, 3)} · 승률{" "}
                  {formatPercent(ranker.win_rate)}
                </p>
                <p className="muted">
                  포메이션 {ranker.formation || "-"} / 팀컬러 {ranker.team_color || "-"} / 신뢰도 {formatFixed(ranker.reliability, 2)}
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
          <article className="panel">
            <h3 className="section-title">평가 실행</h3>
            <p className="muted">최근 채택한 액션 실험의 전/후 지표를 계산합니다.</p>
            <button className="btn" onClick={onEvaluateExperiment} disabled={loading}>
              {loading ? "평가 중..." : "최신 실험 평가 갱신"}
            </button>
            <p className="muted">평가 시각: {formatDate(evaluation?.evaluated_at)}</p>
          </article>
          <article className="panel">
            <h3 className="section-title">적용 전 (PRE)</h3>
            <ul className="list">
              <li>승률: {formatPercent(toKpiValue(evaluation?.pre ?? {}, "win_rate"))}</li>
              <li>xG For: {formatFixed(toKpiValue(evaluation?.pre ?? {}, "xg_for"))}</li>
              <li>xG Against: {formatFixed(toKpiValue(evaluation?.pre ?? {}, "xg_against"))}</li>
              <li>유효슈팅 비율: {formatPercent(toKpiValue(evaluation?.pre ?? {}, "shot_on_target_rate"))}</li>
            </ul>
          </article>
          <article className="panel">
            <h3 className="section-title">적용 후 (POST)</h3>
            <ul className="list">
              <li>승률: {formatPercent(toKpiValue(evaluation?.post ?? {}, "win_rate"))}</li>
              <li>xG For: {formatFixed(toKpiValue(evaluation?.post ?? {}, "xg_for"))}</li>
              <li>xG Against: {formatFixed(toKpiValue(evaluation?.post ?? {}, "xg_against"))}</li>
              <li>유효슈팅 비율: {formatPercent(toKpiValue(evaluation?.post ?? {}, "shot_on_target_rate"))}</li>
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
            <div className="visual-metric-list">
              {[
                { key: "win_rate", label: "승률 Δ", max: 0.5 },
                { key: "xg_for", label: "xG For Δ", max: 2 },
                { key: "xg_against", label: "xG Against Δ(감소 권장)", max: 2, reverse: true },
                { key: "shot_on_target_rate", label: "유효슈팅 Δ", max: 0.5 },
              ].map((item) => {
                const deltaValue = toKpiValue(evaluation?.delta ?? {}, item.key);
                const normalized = item.reverse ? Math.max(0, item.max - Math.max(0, deltaValue)) : Math.max(0, deltaValue + item.max / 2);
                const percent = toProgressPercent(normalized, item.reverse ? item.max : item.max);
                return (
                  <div key={item.key} className="visual-metric-item">
                    <div className="visual-metric-head">
                      <span>{item.label}</span>
                      <strong>{formatFixed(deltaValue, 3)}</strong>
                    </div>
                    <div className={`progress-track ${item.reverse ? "reverse" : ""}`}>
                      <div className={`progress-fill ${item.reverse ? "reverse" : ""}`} style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        </section>
      )}

      {screen === "guide" && (
        <section className="grid">
          <article className="panel guide-hero">
            <h2 className="section-title">FCOACH 이용 가이드</h2>
            <p className="muted">
              닉네임만 입력하면 <strong>진단 → 액션 채택 → 5경기 검증</strong> 루프를 한 번에 수행할 수 있습니다.
            </p>
            <div className="button-row">
              <button className="btn" onClick={() => setScreen("search")}>
                지금 분석 시작하기
              </button>
            </div>
          </article>

          <section className="grid grid-3">
            <article className="panel">
              <h3 className="section-title">1. 검색/설정</h3>
              <ul className="list compact">
                <li>닉네임 입력 후 빠른 시작 실행</li>
                <li>공식/친선 및 5·10·30경기 기준 선택</li>
                <li>필요할 때만 고급 전술 입력 사용</li>
              </ul>
            </article>
            <article className="panel">
              <h3 className="section-title">2. 진단/습관 분석</h3>
              <ul className="list compact">
                <li>핵심 지표와 랭커 기준 차이 확인</li>
                <li>이슈 점수 상위 3개 우선순위 확인</li>
                <li>선수 리포트에서 주전 기여도 점검</li>
              </ul>
            </article>
            <article className="panel">
              <h3 className="section-title">3. 액션/개선 추적</h3>
              <ul className="list compact">
                <li>액션 #1을 5경기 고정 적용</li>
                <li>한 경기 내 전술 변경은 최소화</li>
                <li>개선 추적 탭에서 적용 전/후 비교</li>
              </ul>
            </article>
          </section>

          <article className="panel">
            <h3 className="section-title">AI 코치 리포트 해석 팁</h3>
            <div className="guide-tips">
              <div className="guide-card">
                <div className="guide-title">왜 바꾸나</div>
                <p>랭커 기준 대비 가장 손실이 큰 지표를 먼저 교정합니다.</p>
              </div>
              <div className="guide-card">
                <div className="guide-title">전술 변경 추천</div>
                <p>경기 중 실시간 변경보다, 경기 전 설정을 고정해 실험 정확도를 높입니다.</p>
              </div>
              <div className="guide-card">
                <div className="guide-title">검증 기준</div>
                <p>5경기 기준으로 목표 지표가 개선되면 유지, 미개선 시 플랜B를 적용합니다.</p>
              </div>
            </div>
          </article>
        </section>
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
