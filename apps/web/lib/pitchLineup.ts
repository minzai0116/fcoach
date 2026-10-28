import type { PositionCoaching, PositionPlayer } from "../types/coaching";
import type { AvailableFeedCoaching, FeedComparison, FeedPlayer } from "../types/squadFeed";

export type PitchPlayer = {
  key: string; spId: number; grade: number | null; position: string; name: string;
  record?: PositionPlayer; comparison?: FeedComparison; settings?: FeedPlayer;
  coordinates?: { x: number; y: number };
  portraitImage?: string;
  traitSource?: FeedPlayer;
};

export function feedPortraits(feed?: AvailableFeedCoaching): Map<number, string> {
  const images = new Map<number, string>();
  if (feed?.author_status !== "matched") return images;
  // 사진만 같은 선수의 다른 시즌에 공유하며, 능력치와 설정은 기존의 정확한 카드 연결을 따른다.
  for (const player of feed.snapshot.players) {
    const pid = player.sp_id % 1_000_000;
    if (player.portrait_img && !images.has(player.sp_id)) images.set(player.sp_id, player.portrait_img);
    if (player.portrait_img && (!images.has(pid) || player.lineup_role === "starter")) images.set(pid, player.portrait_img);
  }
  return images;
}
export const lineupKey = (spId: number, grade: number | null, position: string) => `${spId}:${grade}:${position}`;

export function buildPitchLineup(coaching: PositionCoaching, source: "feed" | "match") {
  const records = new Map(coaching.players.map(p => [lineupKey(p.sp_id, p.sp_grade, p.position_name), p]));
  const byPositionId = new Map(coaching.players.map(p => [p.sp_position, p.position_name]));
  const context = coaching.squad_feed?.status === "available" ? coaching.squad_feed : undefined;
  const comparisons = new Map(context?.comparisons.map(p => [lineupKey(p.sp_id, p.sp_grade, p.position_name), p]));
  const entries = source === "feed" ? context?.snapshot.players.filter(p => p.lineup_role === "starter").map(p => ({
    spId: p.sp_id, grade: p.grade, position: p.position ?? "미제공", name: p.name, settings: p, coordinates: p.pitch_position?.status === "present" ? p.pitch_position.value ?? undefined : undefined,
  })) ?? [] : coaching.latest_lineup?.players.map(p => ({
    spId: p.sp_id, grade: p.sp_grade, position: byPositionId.get(p.sp_position) ?? String(p.sp_position),
  })) ?? [];
  const seen = new Set<string>();
  return entries.flatMap(entry => {
    const key = lineupKey(entry.spId, entry.grade, entry.position);
    if (seen.has(key)) return [];
    seen.add(key);
    const record = records.get(key), comparison = comparisons.get(key);
    return [{ ...entry, key, name: "name" in entry ? entry.name : record?.player_name ?? "이름 확인 중",
      record, comparison, settings: "settings" in entry ? entry.settings : comparison?.linked ? comparison.settings ?? undefined : undefined } as PitchPlayer];
  });
}

export function pitchPositionOptions(records: Iterable<PitchPlayer>, lineup: PitchPlayer[]) {
  const positions = new Map(lineup.map(player => [player.position, [] as PitchPlayer[]]));
  for (const player of records) if (player.record) positions.get(player.position)?.push(player);
  return [...positions].filter(([, players]) => players.length > 1);
}

export function selectedPitchLineup(lineup: PitchPlayer[], records: Map<string, PitchPlayer>, selected: Record<string, string>) {
  return lineup.map(player => {
    const alternative = records.get(selected[player.position]);
    return alternative?.position === player.position ? alternative : player;
  });
}

const POSITION_POINTS: Record<string, [number, number]> = {
  GK: [50, 93], SW: [50, 85], LB: [12, 73], LWB: [9, 65], LCB: [36, 82], CB: [50, 82], RCB: [64, 82], RB: [88, 73], RWB: [91, 65],
  LDM: [35, 61], CDM: [50, 63], RDM: [65, 61], LM: [13, 44], LCM: [35, 47], CM: [50, 48], RCM: [65, 47], RM: [87, 44],
  LAM: [24, 31], CAM: [50, 33], RAM: [76, 31], LW: [14, 17], LWF: [14, 17], LF: [32, 22], LS: [39, 12], CF: [50, 24], ST: [50, 12], RS: [61, 12], RF: [68, 22], RWF: [86, 17], RW: [86, 17],
};

export function layoutPitchPlayers(players: PitchPlayer[]) {
  return players.flatMap(player => {
    const fallback = POSITION_POINTS[player.position];
    if (!player.coordinates && !fallback) return [];
    const [left, top] = player.coordinates ? [6 + player.coordinates.x * .88, 6 + (100 - player.coordinates.y) * .88] : fallback;
    return [{ ...player, left, top, width: undefined, exact: !!player.coordinates }];
  });
}
