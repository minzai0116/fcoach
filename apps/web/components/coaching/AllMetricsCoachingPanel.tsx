"use client";

import { displayQuantity, hasShotLocations, METRIC_LABELS } from "../../lib/footballDisplay";
import { useMemo, useState } from "react";
import type { CoachingDomain, CoachingMetric, PositionCoaching } from "../../types/coaching";
import { PassingCoachingPanel } from "./PassingCoachingPanel";
import { PercentageBar, SuccessRing } from "./CoachingVisuals";
import { MetricTrend, metricUnit, metricValue } from "./MetricTrend";
import { MetricCoachingAdvice } from "./MetricCoachingAdvice";
import type { MetricGroup, RankerBenchmark, RankerCoaching } from "../../types/comparison";
import { teamComparisons, TeamMetricComparison, MetricReferenceLine, type TeamComparisons } from "./TeamMetricComparison";
import { RankerHighlights } from "./RankerHighlights";
import { ShotLocationMap } from "./ShotLocationMap";

function PeriodChart({ domain }: { domain: CoachingDomain }) {
  if (!domain.periods) return null;
  const maximum = Math.max(1, ...domain.periods.flatMap(period => [period.goals_for, period.goals_against]));
  return <div className="coaching-period-chart"><h5>득점·실점 시간대</h5><p className="coaching-scope-note">파랑: 득점 · 황갈색: 실점 · 같은 {maximum}골 척도</p>
    {domain.periods.map(period => <div className="coaching-period-row" key={period.label}><small>{period.label}분</small><div><span><PercentageBar value={period.goals_for / maximum} /><b>{period.goals_for}</b></span><span><PercentageBar value={period.goals_against / maximum} tone="amber" /><b>{period.goals_against}</b></span></div></div>)}
  </div>;
}

function MetricDetail({ metric, domain, observation, comparisons }: { metric: CoachingMetric; domain: CoachingDomain; observation: boolean; comparisons: TeamComparisons }) {
  const ratio = ["rate", "percent"].includes(metric.unit);
  const labels = metric.metric === "late_conceded" ? ["60분 이후 실점", "시간 확인 실점", "60분 이전 실점"] : metric.metric === "win_rate" ? ["승리", "분석 경기", "무승부·패배"] : domain.id === "shooting" ? [metric.metric === "on_target" ? "유효 슈팅" : "득점", "슈팅 시도", metric.metric === "on_target" ? "골문 밖 슈팅" : "미득점 슈팅"] : ["성공", "시도", "실패"];
  return <div className="passing-selected-card domain-selected-card" aria-live="polite">
    <div className="passing-selected-heading"><div><h5>{metric.label}</h5><span className="muted">확인된 {metric.observed_matches}경기</span></div>
      {ratio ? <SuccessRing value={metric.value} label={metric.unit === "percent" ? "평균 비율" : "비율"} /> : <strong className="metric-main-value">{metricValue(metric)}</strong>}
    </div>
    <TeamMetricComparison pairs={comparisons} ids={[`${domain.id}:${metric.metric}`]} includeUsage />
    {metric.trials !== undefined && <div className="domain-outcome-stats"><div><small>{labels[0]}</small><strong>{metric.success}회</strong></div><div><small>{labels[1]}</small><strong>{metric.trials}회</strong></div><div><small>{labels[2]}</small><strong>{metric.failures}회</strong></div></div>}
    {metric.total !== undefined && !ratio && metric.unit !== "rating" && <p className="metric-total">{metric.observed_matches}경기 합계 <strong>{displayQuantity(metric.total, metric.unit).toLocaleString("ko-KR", { maximumFractionDigits: metric.unit === "yards" ? 1 : 0 })}{metricUnit(metric.unit)}</strong></p>}
    <MetricTrend metric={metric} />
    {domain.shot_map && hasShotLocations(metric.metric) && <ShotLocationMap domain={domain} metric={metric.metric} />}
    {metric.value !== null && <MetricCoachingAdvice metric={metric.metric} observation={observation} />}
  </div>;
}

function DomainPanel({ domain, observation, comparisons }: { domain: CoachingDomain; observation: boolean; comparisons: TeamComparisons }) {
  const [selection, setSelection] = useState(domain.focus_metric);
  const [shootScope, setShootScope] = useState("efficiency");
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const visible = domain.metrics.filter(metric => domain.id !== "shooting" || (shootScope === "types" ? metric.metric.startsWith("shot_type_") && (includeEmpty || (metric.trials ?? 0) > 0) : shootScope === "counts" ? metric.unit !== "rate" : metric.unit === "rate" && !metric.metric.startsWith("shot_type_")));
  const selected = visible.find(metric => metric.metric === selection) ?? visible[0];
  return <section className="passing-coaching" aria-label={`${domain.label} 분석`}>
    <div className="coaching-section-heading"><h4>{domain.description}</h4></div>
    {domain.id === "shooting" && <div className="coaching-view-toggle domain-scope-toggle" aria-label="슈팅 분석 항목"><button aria-pressed={shootScope === "efficiency"} onClick={() => setShootScope("efficiency")}>슈팅 성공률·위치</button><button aria-pressed={shootScope === "types"} onClick={() => setShootScope("types")}>슈팅 종류</button><button aria-pressed={shootScope === "counts"} onClick={() => setShootScope("counts")}>득점·도움</button></div>}
    {domain.id === "shooting" && shootScope === "types" && <label className="domain-empty-toggle"><input type="checkbox" checked={includeEmpty} onChange={event => setIncludeEmpty(event.target.checked)} />시도 없는 종류도 보기</label>}
    <div className="passing-analysis-layout"><div className="passing-comparison"><div className="domain-metric-list" aria-label={`${domain.label} 지표 선택`}>
      {visible.map(metric => <button key={metric.metric} className={`passing-chart-row${selected?.metric === metric.metric ? " selected" : ""}`} aria-pressed={selected?.metric === metric.metric} aria-label={`${metric.label}, ${metricValue(metric)}, 기록 확인`} onClick={() => setSelection(metric.metric)}>
        <span className="passing-chart-label"><strong>{metric.label}</strong></span>
        <span className="passing-chart-line">{["rate", "percent"].includes(metric.unit) ? <PercentageBar value={metric.value} /> : <MetricTrend metric={metric} compact />}<b>{metricValue(metric)}</b></span>
        <MetricReferenceLine pair={comparisons.get(`${domain.id}:${metric.metric}`)} />
        <small className="domain-row-caption">{metric.trials !== undefined ? `${metric.success}/${metric.trials}회` : metric.unit === "percent" ? "경기별 값의 평균" : "경기당 평균"}</small>
      </button>)}
      {visible.length === 0 && <p className="muted">해당 종류의 슈팅 기록이 없습니다.</p>}
    </div><PeriodChart domain={domain} /></div>
    {selected && <MetricDetail metric={selected} domain={domain} observation={observation} comparisons={comparisons} />}</div>

  </section>;
}

export function AllMetricsCoachingPanel({ coaching, comparisonGroups, benchmark, rankerCoaching }: { coaching: PositionCoaching; comparisonGroups?: MetricGroup[]; benchmark?: RankerBenchmark; rankerCoaching?: RankerCoaching }) {
  const comparisons = useMemo(() => teamComparisons(comparisonGroups, benchmark), [comparisonGroups, benchmark]);
  const [selection, setSelection] = useState(coaching.domains?.length ? "shooting" : "passing");
  const domains = useMemo(() => (coaching.domains ?? []).map(domain => ({ ...domain,
    label: domain.id === "carrying" ? "드리블·경합" : domain.label,
    note: domain.note.replaceAll("종료 화면 득점", "경기 결과의 팀 득점").replaceAll("디펜딩", "수비 기록")
      .replace("거리 단위는 야드이며", "원본 거리는 야드이며 화면에서는 m로 환산합니다."),
    metrics: domain.metrics.map(metric => ({ ...metric, label: METRIC_LABELS[metric.metric] ?? metric.label })),
  })), [coaching.domains]);
  const options = [{ id: "overview", label: "경기 종합" }, { id: "passing", label: "패스" }, ...domains.filter(domain => domain.id !== "overview")];
  const selected = domains.find(domain => domain.id === selection);
  return <div className="all-metrics-coaching"><nav className="coaching-domain-nav" aria-label="코칭 분석 영역">
    {options.filter(option => option.id === "passing" ? coaching.passing : domains.some(domain => domain.id === option.id)).map(option => <button key={option.id} aria-pressed={selection === option.id} onClick={() => setSelection(option.id)}>{option.label}</button>)}
  </nav>
    <RankerHighlights data={rankerCoaching} group={selection} />
    {selection === "passing" && coaching.passing ? <PassingCoachingPanel passing={coaching.passing} observation={coaching.mode === "observation"} comparisons={comparisons} /> : selected ? <DomainPanel key={selected.id} domain={selected} observation={coaching.mode === "observation"} comparisons={comparisons} /> : <p className="muted">분석 기록을 다시 불러오세요.</p>}
  </div>;
}
