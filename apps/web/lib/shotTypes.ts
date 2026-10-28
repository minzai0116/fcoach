const LABELS: Record<number, string> = {
  1: "일반 슈팅", 2: "감아차기", 3: "헤딩 슈팅", 4: "로빙슛", 5: "플레어슛", 6: "낮은 슛",
  7: "발리슛", 8: "프리킥", 9: "페널티킥", 10: "무회전슛", 11: "바이시클킥", 12: "파워샷",
};
export const shotTypeLabel = (type: number | null | undefined) => type == null ? "종류 미확인 슈팅" : LABELS[type] ?? `종류 미확인 슈팅 · 코드 ${type}`;

export function filterShotsByType<T extends { type?: number | null }>(points: T[], type: string): T[] {
  return type === "all" ? points : points.filter(point => (point.type == null ? "unknown" : String(point.type)) === type);
}

export const shotPlayerKey = (point: { sp_id?: number | null; player_name?: string | null }) => point.sp_id ? `id:${point.sp_id % 1_000_000}` : `name:${point.player_name ?? "unknown"}`;
export function filterShotsByPlayer<T extends { sp_id?: number | null; player_name?: string | null }>(points: T[], player: string): T[] {
  return player === "all" ? points : points.filter(point => shotPlayerKey(point) === player);
}
