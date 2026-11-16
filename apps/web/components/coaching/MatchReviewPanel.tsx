"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalysisPayload, MatchType } from "../../types/analysis";
import type { MatchMetricValue, MatchReview, MatchReviewSide } from "../../types/matchReview";
import { requestApi } from "../../lib/apiClient";
import { MATCH_LABELS } from "../../lib/uiConstants";
import { currentTierLabel, tierDateLabel } from "../../lib/userDivisions";
import { InteractiveShotMap } from "./InteractiveShotMap";
import { ControllerIcon } from "./ControllerIcon";

const date = (value: string) => new Date(value).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const endLabel = (value?: number) => value === 0 ? "정상 종료" : value === 1 ? "몰수승" : value === 2 ? "몰수패" : "종료 유형 미확인";
const metricText = (value: MatchMetricValue, unit: string) => value.value === null ? value.trials === 0 ? "시도 없음" : "기록 미제공" : `${value.value.toFixed(unit === "%" ? 1 : 0)}${unit}`;

function DivisionCard({ side, label }: { side: MatchReviewSide; label: string }) {
  const { current, highest } = side.profile;
  const currentDate = tierDateLabel(current?.as_of);
  const highestDate = tierDateLabel(highest?.as_of, true);
  return <article className="match-rank-card">{label && <span>{label}</span>}<h5>{side.nickname}</h5>
    {side.profile.current_nickname && side.profile.current_nickname !== side.nickname && <p>현재 감독명 · {side.profile.current_nickname}</p>}
    <dl>
      <div><dt>현재 시즌 1대1 등급</dt><dd>{currentTierLabel(current)}{current?.name && currentDate && <small>{currentDate} 경기 기준</small>}</dd></div>
      <div><dt>역대 최고 1대1 등급</dt><dd>{highest?.name ?? "정보 없음"}{highest?.name && highestDate && <small>{highestDate} 달성</small>}</dd></div>
    </dl>
  </article>;
}

export function MatchReviewPanel({ analysis }: { analysis: AnalysisPayload }) {
  const matches = analysis.selected_matches ?? analysis.recent_matches ?? [];
  const [selected, setSelected] = useState("");
  const [data, setData] = useState<MatchReview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const cache = useRef(new Map<string, MatchReview>());
  const matchId = matches.some(match => match.match_id === selected) ? selected : matches[0]?.match_id;
  const selectedMode = matches.find(match => match.match_id === matchId)?.match_type ?? analysis.match_type;
  useEffect(() => {
    if (!matchId) return;
    const key = `${analysis.ouid}:${selectedMode}:${matchId}`;
    const cached = cache.current.get(key);
    if (cached) { setData(cached); setError(""); setBusy(false); return; }
    let cancelled = false;
    setBusy(true); setError(""); setData(null);
    requestApi<MatchReview>(`/matches/${encodeURIComponent(matchId)}/review?ouid=${encodeURIComponent(analysis.ouid)}&match_type=${selectedMode}`)
      .then(result => { if (!cancelled) { cache.current.set(key, result); setData(result); } })
      .catch(failure => { if (!cancelled) setError(failure instanceof Error ? failure.message : "경기 분석을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [analysis.ouid, selectedMode, matchId, retry]);
  if (!matches.length) return <p>경기 검색에서 최근 경기 분석을 시작하면 경기별 비교를 볼 수 있습니다.</p>;
  return <section className="match-review" aria-label="경기별 상대 비교">
    <label className="match-review-selector">분석할 경기<select aria-label="경기별 분석 경기 선택" value={matchId} onChange={event => setSelected(event.target.value)}>{matches.map(match => <option key={match.match_id} value={match.match_id}>{date(match.match_date)} · {MATCH_LABELS[match.match_type ?? analysis.match_type as MatchType]} · {match.opponent_nickname} · {match.score_for_display ?? match.score_for}:{match.score_against_display ?? match.score_against} · {endLabel(match.match_end_type)}</option>)}</select></label>
    {busy && <p role="status">경기 기록과 공식 1대1 등급을 확인하고 있습니다…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="btn secondary" onClick={() => setRetry(value => value + 1)}>다시 불러오기</button></div>}
    {data && data.match_id === matchId && <>
      <header className="match-review-score">
        <div><strong>{data.mine.nickname}</strong><ControllerIcon value={data.mine.controller} side="내" /></div>
        <div><span>최종 점수</span><b>{data.mine.score ?? "–"} : {data.opponent.score ?? "–"}</b><span>{data.result} · {endLabel(data.match_end_type)}</span></div>
        <div><strong>{data.opponent.nickname}</strong><ControllerIcon value={data.opponent.controller} side="상대" /></div>
      </header>
      {(data.mine.record_goals !== data.mine.score || data.opponent.record_goals !== data.opponent.score) && <p className="match-comparison-note">슈팅 기록에 집계된 득점은 {data.mine.record_goals ?? "–"}:{data.opponent.record_goals ?? "–"}입니다. 몰수 처리·자책골 등의 반영으로 위 최종 점수와 다를 수 있습니다.</p>}
      <p className="match-review-context">{date(data.match_date)} · {MATCH_LABELS[data.match_type as MatchType] ?? "경기"}</p>
      <div className="match-rank-grid"><DivisionCard side={data.mine} label="" /><DivisionCard side={data.opponent} label="상대" /></div>
      <div className="match-review-findings">{[{ title: "이 경기에서 앞선 점", findings: data.positives, tone: "positive" }, { title: "이 경기 개선점", findings: data.checks, tone: "check" }].filter(item => item.findings.length).map(({title, findings, tone}) => <section key={title} className={`match-findings-${tone}`}><h4>{title}</h4>{findings.length ? findings.map(item => <article key={item.metric}><strong>{item.title}</strong><p>{item.evidence}</p><p className="match-next-action">{item.action}</p></article>) : <p>{data.normal ? "비교 가능한 기록에서 뚜렷한 차이가 확인되지 않았습니다." : "몰수 경기에는 교정 제안을 표시하지 않습니다."}</p>}</section>)}</div>
      <div className="match-metric-comparison"><h4>이 경기 기록 비교</h4><div className="match-comparison-heading"><span>기록</span><strong>경기 기록</strong><strong>상대</strong></div>
        {["슈팅", "패스", "수비", "경기 운영"].map(group => <section key={group}><h5>{group}</h5>{data.metrics.filter(metric => metric.group === group).map(metric => <div key={metric.key} className="match-metric-row"><span>{metric.label}</span>{[metric.mine, metric.opponent].map((value, index) => <div key={index}><strong>{metricText(value, metric.unit)}</strong>{value.success != null && value.trials != null && <small>{value.success}/{value.trials}회</small>}<i className={index === 0 ? "mine" : "opponent"} style={{ width: `${metric.unit === "%" ? Math.max(0, Math.min(100, value.value ?? 0)) : Math.max(0, (value.value ?? 0) / Math.max(metric.mine.value ?? 0, metric.opponent.value ?? 0, 1) * 100)}%` }} /></div>)}</div>)}</section>)}
      </div>
      <div className="match-shot-comparison"><section><h4>내 슈팅 · {data.mine.nickname}</h4><InteractiveShotMap points={data.mine.shots} /></section><section><h4>상대 슈팅 · {data.opponent.nickname}</h4><InteractiveShotMap points={data.opponent.shots} /></section></div>
    </>}
  </section>;
}
