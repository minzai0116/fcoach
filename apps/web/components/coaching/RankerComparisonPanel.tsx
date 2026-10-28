"use client";
import { useEffect, useState } from "react";
import type { AnalysisPayload } from "../../types/analysis";
import type { RankerBenchmark } from "../../types/comparison";
import { requestApi } from "../../lib/apiClient";
import { MetricComparisonCards } from "./MetricComparisonCards";
import { RankerHighlights } from "./RankerHighlights";

export function RankerComparisonPanel({ analysis, onSearch, onRefresh, loading = false }: { analysis: AnalysisPayload | null; onSearch: () => void; onRefresh: () => void; loading?: boolean }) {
  const [fetched, setData] = useState<RankerBenchmark | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const [group, setGroup] = useState("overview");
  const data = analysis?.ranker_benchmark?.status === "available" ? analysis.ranker_benchmark : fetched;
  useEffect(() => {
    if (analysis?.ranker_benchmark?.status === "available") return;
    let cancelled = false; setBusy(true); setError("");
    requestApi<RankerBenchmark>("/rankers/benchmark", undefined, { timeoutMs: 60_000 })
      .then(result => { if (!cancelled) setData(result); })
      .catch(failure => { if (!cancelled) setError(failure instanceof Error ? failure.message : "랭커 평균을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [retry, analysis?.ranker_benchmark]);
  const reference = data?.groups.find(item => item.id === group);
  const mine = analysis?.comparison_metrics?.all?.find(item => item.id === group);
  const mineById = new Map(mine?.metrics.map(metric => [metric.id, metric]));
  const mineCount = analysis?.sample_count ?? 0;
  const findings = analysis?.ranker_coaching?.by_group?.[group];
  const highlighted = new Set([...findings?.strengths ?? [], ...findings?.weaknesses ?? []].map(item => item.id));
  const remaining = reference?.metrics.filter(metric => !highlighted.has(metric.id)) ?? [];
  return <section className="panel ranker-comparison-panel"><div className="coaching-section-heading"><div><h2 className="section-title">랭커 비교</h2><p>최근 30경기 기록과 랭커 평균을 비교합니다.</p></div><button type="button" className="btn secondary" disabled={busy || loading} onClick={analysis ? onRefresh : () => setRetry(value => value + 1)}>{busy || loading ? "불러오는 중…" : analysis ? "최근 30경기 다시 비교" : "랭커 평균 새로고침"}</button></div>
    {error && <p role="alert" className="notice error">{error}</p>}
    {data?.status === "available" && <>
      <p className="ranker-brief">{analysis && <>내 최근 {mineCount}경기 <span>vs</span> </>}랭커 {data.ranker_count}명 평균</p>
      <nav className="comparison-domain-nav" aria-label="랭커 비교 지표">{data.groups.map(item => <button key={item.id} aria-pressed={group === item.id} onClick={() => setGroup(item.id)}>{item.label}</button>)}</nav>
      <RankerHighlights data={analysis?.ranker_coaching} group={group} />
      {!analysis && <button type="button" className="btn" onClick={onSearch}>내 경기 분석 시작하기</button>}
      {!!remaining.length && <section className="comparison-remaining" aria-label={highlighted.size ? "그 외 지표" : "전체 지표"}><h3>{highlighted.size ? "그 외 지표" : "전체 지표"}</h3>
        <MetricComparisonCards tone="purple" referenceLabel="랭커 평균" metrics={remaining.map(metric => ({ reference: metric, mine: mineById.get(metric.id) }))} />
      </section>}

    </>}
    {!busy && data?.status !== "available" && !error && <p>아직 비교할 랭커 경기 기록이 없습니다. 실제 경기 기록이 연결되면 평균을 표시합니다.</p>}
  </section>;
}
