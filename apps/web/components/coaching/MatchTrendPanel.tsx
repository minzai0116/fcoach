"use client";
import { useEffect, useRef, useState } from "react";
import type { AnalysisPayload } from "../../types/analysis";
import type { MatchTrends } from "../../types/comparison";
import { differenceTone, notableTrends } from "../../lib/comparisonInsights";
import { comparisonGap, comparisonValue } from "./MetricComparisonCards";

function ChangeHighlights({ data, onSelect }: { data: MatchTrends; onSelect: (group: string, metric: string) => void }) {
  const changes = notableTrends(data);
  if (!changes.length) return null;
  return <section className="trend-highlights" aria-label="변화가 큰 지표"><h3>변화가 큰 지표</h3><div>{changes.map(item => {
    const min = Math.min(...item.values), range = Math.max(...item.values) - min || 1;
    const points = item.values.map((value, i) => `${4 + i / Math.max(1, item.values.length - 1) * 120},${34 - (value - min) / range * 28}`).join(" ");
    return <button key={item.id} type="button" className={`trend-change-card tone-${item.tone}`} onClick={() => onSelect(item.group, item.id)}><span>{item.label}</span><strong>{comparisonGap(item.latest, item.first, item.unit)}</strong><svg viewBox="0 0 128 40" aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" /></svg><small>{comparisonValue(item.first, item.unit)} → {comparisonValue(item.latest, item.unit)}</small><small className="trend-window-scope">{item.firstWindow === item.lastWindow ? `각 ${item.lastWindow}경기 집계` : `집계 ${item.firstWindow} → ${item.lastWindow}경기`}</small></button>;
  })}</div></section>;
}

type TrendMetric = MatchTrends["groups"][number]["metrics"][number];
const pointResult = (point: MatchTrends["points"][number]) => point.match_end_type === 1 ? "몰수승" : point.match_end_type === 2 ? "몰수패" : point.result ?? "";
function TrendChart({ metric, points }: { metric: TrendMetric; points: MatchTrends["points"] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640), [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(240, element.clientWidth)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setSelected(null), [metric.id, points.at(-1)?.date]);
  const values = metric.history.flatMap(point => point.value === null ? [] : [point.value]);
  if (!values.length) return null;
  const ratio = ["rate", "percent"].includes(metric.unit), minimum = Math.min(...values), maximum = Math.max(...values);
  const padding = Math.max((maximum - minimum) * 0.18, ratio ? 0.025 : 0.2);
  const lower = Math.max(0, minimum - padding), upper = ratio ? Math.min(1, maximum + padding) : maximum + padding;
  const height = width < 600 ? 232 : 292;
  const left = 54, right = width - 16, top = 18, bottom = height - 40;
  const x = (i: number) => left + i / Math.max(1, metric.history.length - 1) * (right - left);
  const y = (value: number) => bottom - (value - lower) / Math.max(0.001, upper - lower) * (bottom - top);
  const path = metric.history.map((point, index) => point.value === null ? "" : `${index === 0 || metric.history[index - 1].value === null ? "M" : "L"}${x(index)},${y(point.value)}`).join(" ");
  const index = selected !== null && selected < metric.history.length ? selected : metric.history.length - 1, point = metric.history[index], context = points[index];
  return <div className="match-trend-chart" ref={ref}>
    <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${metric.label}의 경기 진행에 따른 최근 30경기 집계 변화`}>
      {Array.from({ length: 5 }, (_, tick) => { const value = lower + (upper - lower) * tick / 4, py = y(value); return <g key={tick}><line x1={left} x2={right} y1={py} y2={py} stroke="#d6e1ef" strokeDasharray="4 4" /><text x={left - 8} y={py + 4} textAnchor="end" fill="#425b76" fontSize="11">{comparisonValue(value, metric.unit)}</text></g>; })}
      <path d={path} fill="none" stroke="#a8b8cd" strokeWidth="2" />
      {metric.history.slice(1).map((point, i) => {
        const previous = metric.history[i].value;
        if (point.value === null || previous === null) return null;
        const tone = differenceTone(point.value, previous, metric.direction, metric.unit);
        return <line key={i} x1={x(i)} x2={x(i + 1)} y1={y(previous)} y2={y(point.value)} stroke={tone === "worse" ? "#c42e3a" : tone === "better" ? "#2563eb" : "#74869b"} strokeWidth="3" />;
      })}
      {metric.history.map((value, i) => value.value === null ? null : <g key={i} role="button" tabIndex={0} aria-label={`${i + 1}번째 경기 시점 ${comparisonValue(value.value, metric.unit)}`} aria-pressed={i === index} onClick={() => setSelected(i)} onFocus={() => setSelected(i)} onKeyDown={event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); setSelected(i); } }}>
        <circle cx={x(i)} cy={y(value.value)} r="12" fill="transparent" /><circle cx={x(i)} cy={y(value.value)} r={i === index ? 5.5 : 3} fill={i === index ? "#173e87" : "#2563eb"} pointerEvents="none" />
      </g>)}
      {[0, Math.floor((metric.history.length - 1) / 2), metric.history.length - 1].filter((n, i, all) => all.indexOf(n) === i).map(i => <text key={i} x={x(i)} y={height - 14} textAnchor={i === 0 ? "start" : i === metric.history.length - 1 ? "end" : "middle"} fontSize="12" fill="#425b76">{i === metric.history.length - 1 ? "최근 경기" : `${i + 1}번째 경기`}</text>)}
    </svg>
    <div className="trend-point-picker"><button type="button" aria-label="이전 경기 시점" disabled={index === 0} onClick={() => setSelected(index - 1)}>‹</button><select aria-label="최근 경기 추이 시점 선택" value={index} onChange={event => setSelected(Number(event.target.value))}>{points.map((point, i) => <option key={i} value={i}>{i + 1}번째 · {new Date(point.date).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {pointResult(point)}</option>)}</select><button type="button" aria-label="다음 경기 시점" disabled={index === points.length - 1} onClick={() => setSelected(index + 1)}>›</button></div>
    {context && <div className="trend-point-detail" aria-live="polite"><div><strong>{comparisonValue(point.value, metric.unit)}</strong><span>{new Date(context.date).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {pointResult(context)}</span></div><span>직전 {context.window_matches}경기 중 유효 기록 {point.observed_matches}경기</span></div>}
  </div>;
}

export function MatchTrendPanel({ analysis, loading, onRefresh, onSearch }: { analysis: AnalysisPayload | null; loading: boolean; onRefresh: () => void; onSearch: () => void }) {
  const data = analysis?.match_trends;
  const [category, setCategory] = useState("overview"), [selection, setSelection] = useState("");
  const group = data?.groups.find(group => group.id === category && group.metrics.length) ?? data?.groups.find(group => group.metrics.length);
  const metric = group?.metrics.find(metric => metric.id === selection) ?? group?.metrics[0];
  const first = metric?.history.find(point => point.value !== null)?.value ?? null;
  const latest = metric?.history.at(-1)?.value ?? null;
  const gap = metric ? comparisonGap(latest, first, metric.unit) : null;
  return <section className="panel match-trend-panel"><div className="coaching-section-heading"><div><h2 className="section-title">최근 경기 추이</h2><p>최근 30경기의 기록 변화를 시간순으로 확인하세요.</p></div><button type="button" className="btn" onClick={analysis ? onRefresh : onSearch} disabled={loading}>{loading ? "최근 경기 불러오는 중…" : analysis ? "최근 경기로 갱신" : "경기 분석 시작하기"}</button></div>
    {data && <><ChangeHighlights data={data} onSelect={(group, metric) => { setCategory(group); setSelection(metric); }} /><nav className="comparison-domain-nav" aria-label="최근 경기 추이 지표">{data.groups.filter(group => group.metrics.length).map(group => <button key={group.id} aria-pressed={category === group.id} onClick={() => { setCategory(group.id); setSelection(""); }}>{group.label}</button>)}</nav>
      {group && <label className="trend-metric-select">분석 지표<select aria-label="최근 경기 추이 분석 지표" value={metric?.id ?? ""} onChange={event => setSelection(event.target.value)}>{group.metrics.map(metric => <option key={metric.id} value={metric.id}>{metric.label}</option>)}</select></label>}
      {metric && <article className="trend-metric-card"><header><div><span>{metric.label}</span><strong>{comparisonValue(latest, metric.unit)}</strong></div>{gap && <div><span>첫 표시 시점 대비</span><b className={`tone-${differenceTone(latest, first, metric?.direction ?? "neutral", metric?.unit)}`}>{gap}</b></div>}</header><TrendChart metric={metric} points={data.points} /></article>}
    </>}
    {!data && !loading && analysis && <p>‘최근 경기로 갱신’을 누르면 최근 30경기의 흐름을 볼 수 있습니다.</p>}
  </section>;
}
