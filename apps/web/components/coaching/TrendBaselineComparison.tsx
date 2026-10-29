import type { MatchTrends } from "../../types/comparison";
import { compareTrendPeriods } from "../../lib/trendPeriods";
import { trendChangePresentation } from "../../lib/comparisonInsights";
import { comparisonGap, comparisonValue } from "./MetricComparisonCards";

export function TrendBaselineComparison({ data, baseline, category }: { data: MatchTrends; baseline: number; category?: string }) {
  const metrics = compareTrendPeriods(data, baseline, category);
  return <section className="trend-period-comparison" aria-label="변경 전후 지표 비교">
    <header><h3>변경 전후 비교</h3><span>변경 전 {baseline}경기 · 변경 후 {data.points.length - baseline}경기</span></header>
    <div className="trend-period-grid">{metrics.map(metric => {
      const change = trendChangePresentation(metric.after.value, metric.before.value, metric.unit, metric.direction);
      return <article key={metric.id}><header><h4>{metric.label}</h4><b style={{color: change.color}}>{change.label} {comparisonGap(metric.after.value, metric.before.value, metric.unit)}</b></header>
        <div className="trend-period-values">{([['변경 전', metric.before], ['변경 후', metric.after]] as const).map(([label, sample]) => <div key={label}><span>{label}</span><strong>{comparisonValue(sample.value, metric.unit)}</strong><small>{sample.matches}경기{metric.unit === 'rate' ? ` · ${sample.success}/${sample.trials}회` : ''}</small></div>)}</div>
      </article>;
    })}</div>
    {!metrics.length && <p>선택한 구간 양쪽에 비교할 기록이 없습니다.</p>}
  </section>;
}
