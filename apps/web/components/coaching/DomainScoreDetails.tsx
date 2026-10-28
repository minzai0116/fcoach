"use client";
import { useEffect, useRef, useState } from "react";
import type { DomainScores, DomainScoreMetric } from "../../types/comparison";
import { differenceTone } from "../../lib/comparisonInsights";
import { scorePoint } from "../../lib/domainScoreDisplay";
import { comparisonGap, comparisonValue } from "./MetricComparisonCards";

type Area = DomainScores["areas"][number];
const shortLabel = (label: string) => label.replace(/ 성공률$| 득점 전환율$| \/ 경기$/g, "");
const share = (value: number | null) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;

function MetricRow({ metric }: { metric: DomainScoreMetric }) {
  const context = metric.direction === "neutral";
  const rateLabel = metric.label.includes("득점 전환율") ? "득점률 " : metric.label.includes("성공률") ? "성공률 " : "";
  const hasMeta = metric.usage != null || metric.attempts_per_match != null;
  const tone = context || metric.score == null ? "neutral" : differenceTone(metric.score, metric.reference_score, "higher");
  return <article className="score-breakdown-row">
    <header><h5>{shortLabel(metric.label)}</h5>{metric.status === "weakness" && <span className="score-row-warning">보완</span>}<div><strong className={`tone-${tone}`}>{context ? comparisonValue(metric.mine, metric.unit) : metric.score == null ? "—" : `${scorePoint(metric.score)}점`}</strong><span>랭커 {context ? comparisonValue(metric.reference, metric.unit) : metric.reference_score == null ? "—" : `${scorePoint(metric.reference_score)}점`}</span></div></header>
    {!context && <div className="score-row-record"><span>{rateLabel}{comparisonValue(metric.mine, metric.unit)} <small>랭커 {comparisonValue(metric.reference, metric.unit)}</small></span>{metric.score != null && <b className={`tone-${differenceTone(metric.mine, metric.reference, metric.direction, metric.unit)}`}>{comparisonGap(metric.mine, metric.reference, metric.unit)}</b>}</div>}
    {hasMeta && <footer>{metric.usage != null ? <span>사용 {share(metric.usage)} <small>랭커 {share(metric.reference_usage)}</small></span> : metric.attempts_per_match != null ? <span>시도 {metric.attempts_per_match.toFixed(1)}회/경기 <small>랭커 {metric.reference_attempts == null ? "—" : metric.reference_attempts.toFixed(1)}회</small></span> : <span />}</footer>}
  </article>;
}

export function DomainScoreDetails({ area, areas, onSelect, onClose }: { area: Area; areas: Area[]; onSelect: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const groups = [
    {id:"core",label:"핵심",items:area.metrics.filter(m => m.section !== "유형별" && m.section !== "참고 기록")},
    {id:"types",label:"유형별",items:area.metrics.filter(m => m.section === "유형별")},
    {id:"context",label:area.id === "carrying" ? "거리" : "수비 기록",items:area.metrics.filter(m => m.section === "참고 기록")},
  ].filter(group => group.items.length);
  const [tab, setTab] = useState(groups[0]?.id ?? "core");
  const showAdvice = area.advice.length > 0 && tab !== "context";
  const current = groups.find(group => group.id === tab) ?? groups[0];
  const visible = current?.id === "types" ? [...current.items].sort((a, b) => (b.usage ?? 0) - (a.usage ?? 0)) : current?.items ?? [];
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className="score-detail-dialog" aria-labelledby="score-detail-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header><h3 id="score-detail-title">{area.label}</h3><button type="button" aria-label="세부 점수 닫기" onClick={onClose}>×</button></header>
    <div className="score-detail-content"><div className="score-detail-total"><strong>{scorePoint(area.mine, 1)}<small>점</small></strong><span>랭커 평균 <b>{scorePoint(area.reference, 1)}점</b></span></div>
      {!!area.summaries?.length && <div className="score-detail-summaries">{area.summaries.map(metric => <span key={metric.id}>{shortLabel(metric.label)} <b>{comparisonValue(metric.mine, metric.unit)}</b></span>)}</div>}
      <div className={`score-detail-layout${showAdvice ? "" : " no-coaching"}`}><section aria-label="점수 구성 지표">
        {area.id === "overview" ? <><h4>영역별 점수</h4>{areas.filter(item => item.id !== "overview").map(item => <button key={item.id} type="button" className="score-component-link" onClick={() => onSelect(item.id)}><strong>{item.label} ›</strong><span>{scorePoint(item.mine, 1)}점 · 랭커 {scorePoint(item.reference, 1)}점</span></button>)}</> : <>
          <div className="score-breakdown-heading"><h4>세부 지표</h4>{groups.length > 1 && <nav aria-label="세부 지표 분류">{groups.map(group => <button type="button" key={group.id} aria-pressed={tab === group.id} onClick={() => setTab(group.id)}>{group.label}</button>)}</nav>}</div>
          {visible.map(metric => <MetricRow key={metric.id} metric={metric} />)}
        </>}
      </section>{showAdvice && <section className="score-detail-coaching" aria-label="점수 관련 플레이 코칭"><h4>추천 플레이</h4>{area.advice.map(item => <article key={item.metric_id}><span>{shortLabel(item.evidence)}</span><h5>{item.title}</h5><p>{item.play}</p>{item.tactic && <small>전술 · {item.tactic}</small>}</article>)}</section>}</div>
    </div>
  </dialog>;
}
