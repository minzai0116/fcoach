import type { ShotPoint } from "../types/analysis";
import { shotPosition } from "./footballDisplay";

export const PITCH_LANE_LINES = [86, 154] as const;
export const PITCH_BOX = { left: 59, right: 181, bottom: 68 } as const;
export const PITCH_BOX_DEPTH_LINE = (18 + PITCH_BOX.bottom) / 2;
export const PITCH_BOX_LANE_LINES = [1, 2].map(third =>
  PITCH_BOX.left + (PITCH_BOX.right - PITCH_BOX.left) * third / 3);

const LANES = ["좌측", "중앙", "우측"] as const;
const LANE_EDGES = [18, ...PITCH_LANE_LINES, 222];
const BOX_LANE_EDGES = [PITCH_BOX.left, ...PITCH_BOX_LANE_LINES, PITCH_BOX.right];
const BOX_ROWS = [
  { label: "골문 쪽", top: 18, bottom: PITCH_BOX_DEPTH_LINE },
  { label: "입구 쪽", top: PITCH_BOX_DEPTH_LINE, bottom: PITCH_BOX.bottom },
];
const backHalf = "하프라인 뒤";
const boxLabel = (row: number, lane: number) => `박스 안 · ${BOX_ROWS[row].label} · ${LANES[lane]}`;
const outsideLabel = (lane: number) => `박스 밖 · ${LANES[lane]}`;

export const SHOT_MAP_ZONES = [
  ...BOX_ROWS.flatMap(({ top, bottom }, row) => LANES.map((_, lane) => {
    const left = BOX_LANE_EDGES[lane], right = BOX_LANE_EDGES[lane + 1];
    return {
      label: boxLabel(row, lane), x: (left + right) / 2, y: (top + bottom) / 2,
      shape: `M${left} ${top} H${right} V${bottom} H${left} Z`,
    };
  })),
  ...LANES.map((_, lane) => {
    const left = LANE_EDGES[lane], right = LANE_EDGES[lane + 1];
    const boxLeft = Math.max(left, PITCH_BOX.left), boxRight = Math.min(right, PITCH_BOX.right);
    const bottom = PITCH_BOX.bottom;
    const outside = `M${left} ${bottom} H${right} V176 H${left} Z`;
    return {
      label: outsideLabel(lane), x: (left + right) / 2, y: 121,
      shape: lane === 0 ? `M${left} 18 H${boxLeft} V${bottom} H${right} V176 H${left} Z`
        : lane === 2 ? `M${boxRight} 18 H${right} V176 H${left} V${bottom} H${boxRight} Z`
        : outside,
    };
  }),
  { label: backHalf, x: 120, y: 246, shape: "M18 176 H222 V334 H18 Z" },
];

export function shotZoneLabel(point: Pick<ShotPoint, "x" | "y">): string {
  if (point.x < .5) return backHalf;
  const { x, y } = shotPosition(point);
  const inside = y <= PITCH_BOX.bottom && x >= PITCH_BOX.left && x <= PITCH_BOX.right;
  const [left, right] = inside ? PITCH_BOX_LANE_LINES : PITCH_LANE_LINES;
  const lane = x < left ? 0 : x > right ? 2 : 1;
  return inside ? boxLabel(y < PITCH_BOX_DEPTH_LINE ? 0 : 1, lane) : outsideLabel(lane);
}

export function groupShotsByZone(points: ShotPoint[]) {
  const zones = new Map<string, ShotPoint[]>();
  for (const point of points) {
    const label = shotZoneLabel(point);
    const group = zones.get(label);
    if (group) group.push(point);
    else zones.set(label, [point]);
  }
  return zones;
}

export function summarizeAssistOrigins(points: ShotPoint[]) {
  const counts = new Map<string, number>();
  let total = 0;
  for (const point of points) {
    if (!point.assist || (point.result !== 3 && !point.is_goal)) continue;
    const label = shotZoneLabel(point.assist);
    counts.set(label, (counts.get(label) ?? 0) + 1);
    total++;
  }
  return [...counts].sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, ratio: count / total }));
}

export function summarizeShotZones(points: ShotPoint[]) {
  const zones = new Map<string, { label: string; attempts: number; goals: number; offTarget: number }>();
  for (const point of points) {
    const goal = point.result === 3 || point.is_goal === true;
    if (!goal && point.result !== 1 && point.result !== 2) continue;
    const label = shotZoneLabel(point);
    const zone = zones.get(label) ?? { label, attempts: 0, goals: 0, offTarget: 0 };
    zone.attempts++;
    if (goal) zone.goals++;
    else if (point.result === 2) zone.offTarget++;
    zones.set(label, zone);
  }
  return [...zones.values()].sort((a, b) => (b.attempts - b.goals) - (a.attempts - a.goals) || b.attempts - a.attempts);
}
