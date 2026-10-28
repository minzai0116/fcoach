import type { OpponentComparison } from "../../types/analysis";
import { MetricComparisonCards } from "./MetricComparisonCards";

export function OpponentComparisonPanel({ comparison, modeCounts }: { comparison?: OpponentComparison; modeCounts?: Record<string, number> }) {
  if (!comparison || !comparison.metrics.some(metric => metric.mine.value !== null && metric.opponent.value !== null)) return null;
  const groups = [{ status: "higher", title: "장점 · 상대보다 앞선 점", tone: "positive" }, { status: "lower", title: "보완할 플레이", tone: "check" }];
  return <section className="opponent-summary span-3" aria-label="상대와 직접 비교">
    <div className="coaching-section-heading"><div><h3 className="section-title">상대와 비교한 내 플레이</h3></div><span className="comparison-sample">공식 {modeCounts?.["50"] ?? 0} · 친선 {modeCounts?.["60"] ?? 0}경기</span></div>
    {groups.filter(group => comparison.metrics.some(metric => metric.status === group.status)).map(group => <section key={group.status} className={`comparison-findings ${group.tone}`}><h4>{group.title}</h4>{comparison.metrics.filter(metric => metric.status === group.status).map(metric => <p key={metric.metric}><strong>{metric.label}</strong> {group.status === "higher" ? "현재의 성공한 플레이를 유지해 보세요." : metric.action}</p>)}</section>)}
    <MetricComparisonCards referenceLabel="상대" metrics={comparison.metrics.map(metric => ({
      mine: { id: metric.metric, label: metric.label, unit: "rate", direction: "higher", ...metric.mine },
      reference: { id: metric.metric, label: metric.label, unit: "rate", direction: "higher", ...metric.opponent },
    }))} />
  </section>;
}
