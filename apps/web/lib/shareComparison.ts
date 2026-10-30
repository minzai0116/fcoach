import type { MatchTrends } from "../types/comparison";
import { compareTrendEndpoints, compareTrendPeriods } from "./trendPeriods";

export function shareComparisonMetrics(data: MatchTrends, baseline: number | null, limit = 6) {
  const periods = baseline === null ? compareTrendEndpoints(data) : compareTrendPeriods(data, baseline);
  const candidates = periods.flatMap(metric => {
    if (baseline === null && metric.direction === "neutral") return [];
    const { before, after } = metric;
    const delta = Math.abs(after.value! - before.value!);
    if (Math.min(before.matches, after.matches) < 5 || delta < (["rate", "percent"].includes(metric.unit) ? .0005 : .05)) return [];
    if (metric.unit === "rate" && metric.id !== "overview:win_rate" && Math.min(before.trials, after.trials) < 20) return [];
    let weight = 0, mean = 0, variance = 0;
    for (const point of metric.history) {
      const record = point.match;
      if (baseline !== null && (!record || record.observed <= 0)) continue;
      if (baseline === null && (point.value == null || point.observed_matches <= 0)) continue;
      const w = baseline === null ? 1 : metric.unit === "rate" ? record!.trials : record!.observed;
      const numerator = baseline === null ? point.value! : metric.unit === "rate" ? record!.success : record!.total;
      if (w <= 0 || !Number.isFinite(numerator)) continue;
      // 한 번의 순회로 가중 분산을 구해 단위가 다른 지표의 변화 크기를 비교한다.
      const value = numerator / w, nextWeight = weight + w, diff = value - mean;
      mean += diff * w / nextWeight;
      variance += w * diff * (value - mean);
      weight = nextWeight;
    }
    const spread = Math.sqrt(variance / weight);
    return spread > 0 && Number.isFinite(spread) ? [{ ...metric, changeSize: delta / spread }] : [];
  }).sort((a, b) => b.changeSize - a.changeSize || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const aliases: Record<string, string> = { "defending:goals_against": "overview:goals_against", "shooting:goals": "overview:goals_for", "shooting:display_goals": "overview:goals_for" };
  const seen = new Set<string>();
  return candidates.filter(metric => {
    const keys = [aliases[metric.id] ?? metric.id, `label:${metric.label.replace(/\s+/g, "")}`];
    if (keys.some(key => seen.has(key))) return false;
    keys.forEach(key => seen.add(key));
    return true;
  }).slice(0, limit);
}
