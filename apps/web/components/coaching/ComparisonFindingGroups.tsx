import type { ComparableMetric } from "../../types/comparison";
import { MetricComparisonCards } from "./MetricComparisonCards";

type MetricPair = { mine?: ComparableMetric; reference?: ComparableMetric };
export function ComparisonFindingGroups({ groups, referenceLabel }: {
  groups: Array<{ title: string; tone: "better" | "worse"; metrics: MetricPair[] }>;
  referenceLabel: string;
}) {
  const visible = groups.filter(group => group.metrics.length);
  return <div className={`comparison-finding-groups${visible.length === 1 ? " single-highlight-group" : ""}`}>
    {visible.map(group => <section className={`comparison-finding-group finding-${group.tone}`} aria-label={group.title} key={group.tone}>
      <header><h4>{group.title}</h4><span>{group.metrics.length}개</span></header>
      <MetricComparisonCards compact referenceLabel={referenceLabel} tone="purple" metrics={group.metrics} />
    </section>)}
  </div>;
}
