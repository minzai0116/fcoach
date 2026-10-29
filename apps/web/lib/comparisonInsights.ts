import type { ComparableMetric, MatchTrends, MetricUnit } from "../types/comparison";
import type { OpponentComparison } from "../types/analysis";
export function opponentHighlights(metrics: OpponentComparison["metrics"]) {
  const valid = metrics.filter(metric => metric.mine.value != null && metric.opponent.value != null && metric.gap_pp != null && Number.isFinite(metric.gap_pp));
  const select = (status: string) => valid.filter(metric => metric.status === status)
    .sort((a, b) => Math.abs(b.gap_pp!) - Math.abs(a.gap_pp!) || a.metric.localeCompare(b.metric)).slice(0, 3);
  return { strengths: select("higher"), weaknesses: select("lower") };
}
export type DifferenceTone = "better" | "worse" | "neutral";
export function differenceTone(mine: number | null | undefined, reference: number | null | undefined, direction: ComparableMetric["direction"], unit?: MetricUnit): DifferenceTone {
  if (mine == null || reference == null || !Number.isFinite(mine) || !Number.isFinite(reference) || direction === "neutral" || Math.abs(mine - reference) < (unit ? (["rate", "percent"].includes(unit) ? .0005 : .05) : 1e-8)) return "neutral";
  return (mine > reference) === (direction === "higher") ? "better" : "worse";
}
export function trendChangePresentation(current: number | null, previous: number | null, unit: MetricUnit, direction: ComparableMetric["direction"]) {
  const tone = differenceTone(current, previous, direction, unit);
  return tone === "better" ? { direction: "improved", label: "개선", color: "#c42e3a" }
    : tone === "worse" ? { direction: "declined", label: "악화", color: "#2563eb" }
    : { direction: "unchanged", label: direction === "neutral" ? "변화" : "비슷", color: "#74869b" };
}
export function notableTrends(data: MatchTrends) {
  const lastWindow = data.points.at(-1)?.window_matches;
  const fullWindows = data.points.flatMap((point, index) => point.window_matches === lastWindow ? [index] : []);
  const indices = fullWindows.length >= 5 ? fullWindows : data.points.map((_, index) => index);
  if (indices.length < 5) return [];
  const candidates = data.groups.flatMap(group => group.metrics.flatMap(metric => {
    if (metric.direction === "neutral") return [];
    const valid = indices.filter(i => metric.history[i]?.value != null && metric.history[i].observed_matches >= 5 && (metric.unit !== "rate" || (metric.history[i].trials ?? 0) >= 20));
    if (valid.length < 5 || valid.at(-1) !== data.points.length - 1 || valid.some((index, i) => i > 0 && index !== valid[i - 1] + 1)) return [];
    const first = metric.history[valid[0]].value!, latest = metric.history[valid.at(-1)!].value!;
    const values = valid.map(i => metric.history[i].value!);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const spread = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
    const delta = Math.abs(latest - first), precision = ["rate", "percent"].includes(metric.unit) ? .0005 : .05;
    if (delta < precision || delta < spread) return [];
    return [{ ...metric, group: group.id, first, latest, values, score: delta / (spread || delta), tone: differenceTone(latest, first, metric.direction, metric.unit), firstWindow: data.points[valid[0]].window_matches, lastWindow: data.points[valid.at(-1)!].window_matches }];
  })).sort((a, b) => b.score - a.score);
  const used = new Set<string>();
  return candidates.filter(item => {
    const key = item.id.replace(/^(shooting:display_goals|shooting:goals)$/, "overview:goals_for").replace(/^defending:goals_against$/, "overview:goals_against");
    if (used.has(key)) return false;
    used.add(key); return true;
  }).slice(0, 4);
}
