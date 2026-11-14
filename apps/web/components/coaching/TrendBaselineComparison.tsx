import type { MatchTrends } from "../../types/comparison";
import { compareTrendEndpoints, compareTrendPeriods, trendEndpointLabels } from "../../lib/trendPeriods";
import { trendChangePresentation } from "../../lib/comparisonInsights";
import { comparisonGap, comparisonValue } from "./MetricComparisonCards";

export function TrendBaselineComparison({ data, baseline, category }: { data: MatchTrends; baseline: number | null; category?: string }) {
  const metrics = baseline === null ? compareTrendEndpoints(data, category) : compareTrendPeriods(data, baseline, category);
  const title = baseline === null ? "이전·최근 기록 비교" : "기준 경기 전후 비교";
  const endpoints = baseline === null ? trendEndpointLabels(data) : [];
  return <section className="trend-period-comparison" aria-label={title}>
    <header><h3>{title}</h3>{baseline !== null && <span>{`기준 경기 이전 ${baseline}경기 · 기준 경기부터 ${data.points.length - baseline}경기`}</span>}</header>
    {endpoints.length > 0 && <div className="trend-period-values trend-period-scopes">{endpoints.map(point => <div key={point.label}><b>{point.label}</b><span>{point.scope}</span></div>)}</div>}
    <div className="trend-period-grid">{metrics.map(metric => {
      const change = trendChangePresentation(metric.after.value, metric.before.value, metric.unit, metric.direction);
      return <article key={metric.id}><header><h4>{metric.label}</h4><b style={{color: change.color}}>{change.label} {comparisonGap(metric.after.value, metric.before.value, metric.unit)}</b></header>
        <div className="trend-period-values">{([[baseline === null ? '이전 집계' : '기준 경기 이전', metric.before], [baseline === null ? '최근 집계' : '기준 경기부터', metric.after]] as const).map(([label, sample]) => <div key={label}><span>{label}</span><strong>{comparisonValue(sample.value, metric.unit)}</strong><small>{sample.matches}경기{metric.unit === 'rate' ? ` · ${sample.success}/${sample.trials}회` : ''}</small></div>)}</div>
      </article>;
    })}</div>
    {!metrics.length && <p>선택한 구간 양쪽에 비교할 기록이 없습니다.</p>}
  </section>;
}
