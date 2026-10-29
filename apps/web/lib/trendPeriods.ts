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
