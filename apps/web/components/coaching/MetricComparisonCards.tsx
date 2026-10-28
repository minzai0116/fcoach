import { differenceTone } from "../../lib/comparisonInsights";
import type { ComparableMetric, MetricUnit } from "../../types/comparison";

export function comparisonValue(value: number | null | undefined, unit: MetricUnit): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (unit === "rate" || unit === "percent") return `${(value * 100).toFixed(1)}%`;
  return `${value.toFixed(1)}${unit === "meters" ? "m" : unit === "goals" ? "골" : unit === "rating" ? "점" : "회"}`;
}
export function comparisonGap(mine: number | null, reference: number | null, unit: MetricUnit): string | null {
  if (mine === null || reference === null) return null;
  const gap = (mine - reference) * (["rate", "percent"].includes(unit) ? 100 : 1);
  if (Math.abs(gap) < 0.05) return "같은 수치";
  return `${gap > 0 ? "+" : "−"}${Math.abs(gap).toFixed(1)}${["rate", "percent"].includes(unit) ? "%p" : unit === "meters" ? "m" : unit === "goals" ? "골" : unit === "rating" ? "점" : "회"}`;
}

export function MetricComparisonCards({ metrics, referenceLabel, mineLabel = "경기 기록", tone = "amber", compact = false, showTotals = false }: {
  metrics: Array<{ mine?: ComparableMetric; reference?: ComparableMetric }>;
  referenceLabel: string; mineLabel?: string; tone?: "amber" | "purple"; compact?: boolean; showTotals?: boolean;
}) {
  return <div className={`metric-compare-grid reference-${tone}${compact ? " compact-comparison" : ""}`}>{metrics.map(({ mine, reference }) => {
    const metric = mine ?? reference;
    if (!metric || (mine?.value == null && reference?.value == null)) return null;
    const mineValue = mine?.value ?? null, referenceValue = reference?.value ?? null;
    const maximum = ["rate", "percent"].includes(metric.unit) ? 1 : Math.max(mineValue ?? 0, referenceValue ?? 0, 1) * 1.08;
    const gap = comparisonGap(mineValue, referenceValue, metric.unit);
    return <article className="metric-compare-card" key={metric.id}>
      <header><h4>{metric.label}</h4>{gap && <strong className={`metric-gap tone-${differenceTone(mineValue, referenceValue, metric.direction, metric.unit)}`} aria-label={`${referenceLabel} 대비 차이 ${gap}`}>{gap}</strong>}</header>
      <div className="metric-paired-bars" role="img" aria-label={`${metric.label}: ${mineLabel} ${comparisonValue(mineValue, metric.unit)}, ${referenceLabel} ${comparisonValue(referenceValue, metric.unit)}${gap ? `, 차이 ${gap}` : ""}`}>
        {[{ label: mineLabel, metric: mine, value: mineValue, className: "mine" }, { label: referenceLabel, metric: reference, value: referenceValue, className: "reference" }].map(row => <div className="metric-paired-row" key={row.className}>
          <span>{row.label}</span><div className="metric-paired-track">{row.value !== null && <i className={`${row.className}${row.className === "mine" ? ` tone-${differenceTone(mineValue, referenceValue, metric.direction, metric.unit)}` : ""}`} style={{ width: `${Math.min(100, Math.max(0, row.value / maximum * 100))}%` }} />}</div><b>{comparisonValue(row.value, metric.unit)}</b>
        </div>)}
      </div>
      <footer>{mine && <span>{mine.matches}경기{mine.success != null && mine.trials != null ? ` · ${mine.success}/${mine.trials}회` : showTotals && mine.total != null && mine.unit !== "rating" ? ` · 합계 ${comparisonValue(mine.total, mine.unit)}` : ""}</span>}{reference?.ranker_count != null ? <span>랭커 {reference.ranker_count}명 평균</span> : reference && <span>{showTotals ? `${reference.matches}경기${reference.unit === "rating" ? "" : " · "}` : `${referenceLabel} `}{reference.success != null && reference.trials != null ? `${reference.success}/${reference.trials}회` : showTotals && reference.total != null && reference.unit !== "rating" ? `합계 ${comparisonValue(reference.total, reference.unit)}` : ""}</span>}</footer>
    </article>;
  })}</div>;
}
