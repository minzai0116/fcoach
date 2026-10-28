import type { OpponentComparison } from "../../types/analysis";
import { opponentHighlights } from "../../lib/comparisonInsights";
import { ComparisonFindingGroups } from "./ComparisonFindingGroups";

export function OpponentComparisonPanel({ comparison, modeCounts }: { comparison?: OpponentComparison; modeCounts?: Record<string, number> }) {
  if (!comparison) return null;
  const { strengths, weaknesses } = opponentHighlights(comparison.metrics);
  if (!strengths.length && !weaknesses.length) return null;
  const pairs = (items: OpponentComparison["metrics"]) => items.map(metric => ({
    mine: { id: metric.metric, label: metric.label, unit: "rate" as const, direction: "higher" as const, ...metric.mine },
    reference: { id: metric.metric, label: metric.label, unit: "rate" as const, direction: "higher" as const, ...metric.opponent },
  }));
  return <section className="opponent-summary span-3" aria-label="상대와 직접 비교">
    <div className="coaching-section-heading"><h3 className="section-title">상대 대비 강점·보완점</h3><span className="comparison-sample">공식 {modeCounts?.["50"] ?? 0} · 친선 {modeCounts?.["60"] ?? 0}경기 · 차이 큰 순</span></div>
    <ComparisonFindingGroups referenceLabel="상대" groups={[
      { title: "상대보다 앞선 지표", tone: "better", metrics: pairs(strengths) },
      { title: "상대보다 낮은 지표", tone: "worse", metrics: pairs(weaknesses) },
    ]} />
  </section>;
}
