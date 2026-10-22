import type { CoachingMetric } from "../../types/coaching";
import { displayQuantity } from "../../lib/footballDisplay";
import { formatPercent } from "./CoachingVisuals";

export function metricUnit(unit: CoachingMetric["unit"]): string {
  return unit === "yards" ? "m" : unit === "rating" ? "점" : unit === "goals" ? "골" : "회";
}

export function metricValue(metric: Pick<CoachingMetric, "unit" | "value">): string {
  if (metric.value === null) return "—";
  if (["rate", "percent"].includes(metric.unit)) return formatPercent(metric.value);
  return `${displayQuantity(metric.value, metric.unit).toFixed(metric.unit === "rating" ? 2 : 1)}${metricUnit(metric.unit)}`;
}

export function MetricTrend({ metric, compact = false }: { metric: CoachingMetric; compact?: boolean }) {
  const values = metric.history.map((point) => point.value);
  const valid = values.filter((value): value is number => value !== null);
  if (!valid.length) return <span className="muted">기록 없음</span>;
  const maximum = ["rate", "percent"].includes(metric.unit) ? 1 : Math.max(...valid, 1);
  const left = compact ? 10 : 64, bottom = compact ? 66 : 90, plotWidth = compact ? 260 : 270, plotHeight = compact ? 54 : 72;
  const points = values.map((value, index) => value === null ? null : [left + index / Math.max(1, values.length - 1) * plotWidth, bottom - value / maximum * plotHeight]);
  const segments: string[] = [];
  let current = "";
  for (const point of points) {
    if (point) current += `${current ? " L" : "M"}${point[0]},${point[1]}`;
    else if (current) { segments.push(current); current = ""; }
  }
  if (current) segments.push(current);
  return (
    <div className={compact ? "metric-trend compact" : "metric-trend"}>
      {!compact && <div className="metric-trend-caption"><strong>경기별 변화</strong></div>}
      <svg viewBox={compact ? "0 0 280 80" : "0 0 350 136"} role="img" aria-label={`${metric.label}의 경기별 추이. 각 지표 자체의 척도이며 다른 단위와 높이를 비교하지 않습니다.`}>
        {[0, .5, 1].map(fraction => <g key={fraction}>
          <path d={`M${left} ${bottom - fraction * plotHeight} H${left + plotWidth}`} stroke="#dce5f1" strokeDasharray="3 4" />
          {!compact && <text x={left - 7} y={bottom - fraction * plotHeight + 3} textAnchor="end" className="chart-axis-label">{metricValue({ ...metric, value: maximum * fraction }).replace(/\.0(?=[^\d])/, "")}</text>}
        </g>)}
        {!compact && <>
          <path d={`M${left} 18 V${bottom} H${left + plotWidth}`} fill="none" stroke="#9cadc2" />
          <text x={left} y="112" className="chart-axis-label">{new Date(metric.history[0].date).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</text>
          <text x={left + plotWidth} y="112" textAnchor="end" className="chart-axis-label">{new Date(metric.history.at(-1)!.date).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</text>
          <text x="199" y="132" textAnchor="middle" className="chart-axis-label">경기일</text>
        </>}
        {segments.map((path, index) => <path key={index} d={path} fill="none" stroke="#2563eb" strokeWidth="2" />)}
        {points.map((point, index) => point && <circle key={index} cx={point[0]} cy={point[1]} r={compact ? 2 : 3} fill="#2563eb"><title>{new Date(metric.history[index].date).toLocaleDateString("ko-KR")} · {metricValue({ ...metric, value: values[index] })}</title></circle>)}
      </svg>
    </div>
  );
}
