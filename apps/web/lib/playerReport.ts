import type {
  FormationNode,
  ImpactComponent,
  PlayerReportEntry,
  PlayerSortDirection,
  PlayerSortMetric,
} from "../types/analysis";

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

export const IMPACT_COMPONENT_LABELS: Record<string, string> = {
  goals_per_match: "경기당 골",
  assists_per_match: "경기당 도움",
  effective_shots_per_match: "경기당 유효슛",
  shot_accuracy: "슈팅 정확도",
  pass_success_rate: "패스 성공률",
  tackle_success_rate: "태클 성공률",
  tackles_per_match: "경기당 태클 성공",
  intercepts_per_match: "경기당 인터셉트",
  blocks_per_match: "경기당 블락",
  dribble_success_rate: "드리블 성공률",
  save_events_per_match: "경기당 선방",
  save_rate_proxy: "선방률",
  avg_rating: "평균 평점",
};

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatFixed(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : (0).toFixed(digits);
}

export function normalizedGrade(grade: number): number {
  const numeric = Math.round(Number.isFinite(grade) ? grade : 0);
  if (numeric <= 0) return 1;
  return Math.min(13, numeric);
}

function inferPositionLane(positionName: string): "DEF" | "MID" | "ATT" {
  const upper = positionName.toUpperCase();
  if (upper.includes("B") || upper.includes("CB") || upper.includes("WB")) return "DEF";
  if (upper.includes("M") || upper === "CDM") return "MID";
  return "ATT";
}

export function enhanceLevelClass(grade: number): string {
  return `level-${normalizedGrade(grade)}`;
}

export function playerFaceCandidates(
  player: Pick<PlayerReportEntry, "face_img" | "action_img" | "fallback_img" | "sp_id">,
): string[] {
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

export function tablePositionGroup(positionName: string): number {
  const upper = positionName.toUpperCase().trim();
  if (upper === "SUB") return 4;
  if (upper === "GK") return 0;
  if (["SW", "CB", "LCB", "RCB", "LB", "RB", "LWB", "RWB"].includes(upper)) return 1;
  if (["CDM", "LDM", "RDM", "CM", "LCM", "RCM", "LM", "RM", "CAM", "LAM", "RAM"].includes(upper)) return 2;
  return 3;
}

export function tablePositionOrder(positionName: string): number {
  const upper = positionName.toUpperCase().trim();
  if (upper === "SUB") return 999;
  return POSITION_TABLE_INDEX.get(upper) ?? 900;
}

export function sortArrow(metric: PlayerSortMetric, currentMetric: PlayerSortMetric, direction: PlayerSortDirection): string {
  if (metric !== currentMetric) return "↕";
  return direction === "desc" ? "↓" : "↑";
}

export function roleGroupLabel(roleGroup: string): string {
  const role = roleGroup.toUpperCase();
  if (role === "ATT") return "공격";
  if (role === "MID") return "미드";
  if (role === "DEF") return "수비";
  if (role === "GK") return "골키퍼";
  if (role === "SUB") return "교체";
  return "미분류";
}

export function formatImpactRaw(metric: string, value: number): string {
  if (
    [
      "shot_accuracy",
      "pass_success_rate",
      "tackle_success_rate",
      "dribble_success_rate",
      "save_rate_proxy",
      "weight",
      "normalized",
      "weighted_score",
    ].includes(metric)
  ) {
    return formatPercent(value);
  }
  return formatFixed(value, 2);
}

function normalizeImpactComponents(value: unknown): ImpactComponent[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      metric: String((item as ImpactComponent).metric ?? ""),
      weight: Number((item as ImpactComponent).weight ?? 0),
      raw: Number((item as ImpactComponent).raw ?? 0),
      normalized: Number((item as ImpactComponent).normalized ?? 0),
      weighted_score: Number((item as ImpactComponent).weighted_score ?? 0),
    }))
    .filter((item) => item.metric.length > 0)
    .slice(0, 5);
}

export function normalizePlayerEntry(item: unknown): PlayerReportEntry {
  return {
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
    role_group: String((item as PlayerReportEntry).role_group ?? "MID"),
    impact_model: String((item as PlayerReportEntry).impact_model ?? ""),
    impact_confidence: Number((item as PlayerReportEntry).impact_confidence ?? 0),
    impact_components: normalizeImpactComponents((item as PlayerReportEntry).impact_components),
  };
}

export function buildFormationNodes(players: PlayerReportEntry[]): FormationNode[] {
  if (!players.length) return [];
  const capped = players.slice(0, 11);
  const laneCursor = { DEF: 0, MID: 0, ATT: 0 };
  const occupiedCount = new Map<string, number>();

  return capped.map((player) => {
    const positionKey = player.position_name.toUpperCase().trim();
    let slot = POSITION_COORDS[positionKey];
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
