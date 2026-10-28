import type { ComparableMetric, MetricGroup, RankerBenchmark } from "../../types/comparison";
import { comparisonGap, comparisonValue, MetricComparisonCards } from "./MetricComparisonCards";
import { differenceTone } from "../../lib/comparisonInsights";

export type TeamComparisons = Map<string, { mine?: ComparableMetric; reference?: ComparableMetric }>;
export function teamComparisons(groups?: MetricGroup[], benchmark?: RankerBenchmark): TeamComparisons {
  const refs = new Map(benchmark?.groups.flatMap(group => group.metrics.map(metric => [metric.id, metric] as const)));
  return new Map(groups?.flatMap(group => group.metrics.map(mine => [mine.id, { mine, reference: refs.get(mine.id) }] as const)));
}

export function MetricReferenceLine({ pair }: { pair?: { mine?: ComparableMetric; reference?: ComparableMetric } }) {
  if (!pair?.mine || pair.reference?.value == null || pair.mine.value == null) return <small className="metric-reference-line">비교 기록 없음</small>;
  const { mine, reference } = pair;
  return <small className="metric-reference-line"><span>랭커 {comparisonValue(reference.value, mine.unit)}</span><b className={`tone-${differenceTone(mine.value, reference.value, mine.direction, mine.unit)}`}>{comparisonGap(mine.value, reference.value, mine.unit)}</b></small>;
}

export function TeamMetricComparison({ pairs, ids, includeUsage = false }: { pairs: TeamComparisons; ids: string[]; includeUsage?: boolean }) {
  const metrics = ids.flatMap(id => {
    const pair = pairs.get(id);
    if (!pair) return [];
    const usage = (metric?: ComparableMetric) => metric && ({ ...metric, id: metric.id + ":usage", label: "사용 비중", direction: "neutral" as const, value: metric.usage_share ?? null, success: null, trials: null });
    return includeUsage && pair.mine?.usage_share != null ? [pair, { mine: usage(pair.mine), reference: usage(pair.reference) }] : [pair];
  });
  return <MetricComparisonCards compact referenceLabel="랭커 평균" tone="purple" metrics={metrics} />;
}
