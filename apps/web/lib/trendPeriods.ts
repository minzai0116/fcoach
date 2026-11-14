import type { MatchTrends } from "../types/comparison";

type Metric = MatchTrends["groups"][number]["metrics"][number];
function aggregate(metric: Metric, from: number, until: number) {
  let success = 0, trials = 0, total = 0, matches = 0;
  for (let i = from; i < until; i++) {
    const record = metric.history[i]?.match;
    if (!record || record.observed <= 0) continue;
    success += record.success; trials += record.trials; total += record.total; matches += record.observed;
  }
  return { value: metric.unit === "rate" ? trials > 0 ? success / trials : null : matches > 0 ? total / matches : null, matches, success, trials };
}

export function compareTrendPeriods(data: MatchTrends, baseline: number, category?: string) {
  if (!Number.isInteger(baseline) || baseline < 1 || baseline >= data.points.length) return [];
  return data.groups.filter(group => !category || group.id === category).flatMap(group => group.metrics.flatMap(metric => {
    // 이동평균은 기준선 양쪽 구간이 겹치므로 경기별 원본으로 비교한다.
    const before = aggregate(metric, 0, baseline), after = aggregate(metric, baseline, data.points.length);
    return before.value === null || after.value === null ? [] : [{ ...metric, before, after }];
  }));
}

export function trendEndpointIndices(data: MatchTrends) {
  const last = data.points.length - 1;
  const sameWindow = data.points.findIndex((point, i) => i < last && point.window_matches === data.points[last]?.window_matches);
  const observed = data.points.findIndex((point, i) => i < last && point.window_matches >= 5);
  return { first: sameWindow >= 0 ? sameWindow : Math.max(0, observed), last };
}

export function trendEndpointLabels(data: MatchTrends) {
  const { first, last } = trendEndpointIndices(data);
  if (last <= first) return [];
  const dayFormat = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" });
  const format = (date?: string) => {
    const timestamp = Date.parse(date ?? "");
    return Number.isFinite(timestamp) ? dayFormat.format(timestamp) : "";
  };
  return [first, last].map((index, position) => {
    const label = position === 0 ? "이전 집계" : "최근 집계";
    const point = data.points[index];
    if (!point) return { label, scope: "" };
    const start = format(point.window_start_date ?? data.points[index - point.window_matches + 1]?.date);
    const end = format(point.date);
    const dates = start && end ? `${start === end ? end : `${start}~${end}`} ` : end ? `${end}까지 ` : "";
    return { label, scope: `${dates}${point.window_matches}경기` };
  });
}

export function compareTrendEndpoints(data: MatchTrends, category?: string) {
  const { first, last } = trendEndpointIndices(data);
  if (last <= first) return [];
  function sample(metric: Metric, index: number) {
    const point = metric.history[index];
    if (point?.value == null || !Number.isFinite(point.value) || point.observed_matches <= 0) return null;
    if (metric.unit === "rate" && (point.success == null || point.trials == null || point.trials <= 0)) return null;
    return { value: metric.unit === "rate" ? point.success! / point.trials! : point.value, matches: point.observed_matches, success: point.success ?? 0, trials: point.trials ?? 0 };
  }
  return data.groups.filter(group => !category || group.id === category).flatMap(group => group.metrics.flatMap(metric => {
    const before = sample(metric, first), after = sample(metric, last);
    return before && after ? [{ ...metric, before, after }] : [];
  }));
}
