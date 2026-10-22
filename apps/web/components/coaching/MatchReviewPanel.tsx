"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalysisPayload, MatchType } from "../../types/analysis";
import type { MatchMetricValue, MatchReview, MatchReviewSide } from "../../types/matchReview";
import { requestApi } from "../../lib/apiClient";
import { MATCH_LABELS } from "../../lib/uiConstants";
import { InteractiveShotMap } from "./InteractiveShotMap";

const date = (value: string) => new Date(value).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const endLabel = (value?: number) => value === 0 ? "정상 종료" : value === 1 ? "몰수승" : value === 2 ? "몰수패" : "종료 유형 미확인";
const metricText = (value: MatchMetricValue, unit: string) => value.value === null ? value.trials === 0 ? "시도 없음" : "기록 미제공" : `${value.value.toFixed(unit === "%" ? 1 : 0)}${unit}`;

function RankCard({ side, label }: { side: MatchReviewSide; label: string }) {
  const { current_rank: rank, highest_division: highest } = side.profile;
  return <article className="match-rank-card"><span>{label}</span><h5>{side.nickname}</h5>
    {side.profile.current_nickname && side.profile.current_nickname !== side.nickname && <p>현재 닉네임 · {side.profile.current_nickname}</p>}
    <dl><div><dt>현재 시즌 1대1 순위</dt><dd>{rank.status === "available" ? `${rank.rank?.toLocaleString()}위` : rank.status === "outside_public_range" ? "공개 순위에 없음" : "조회 불가"}</dd></div>
    {rank.status === "available" && rank.elo && <div><dt>랭킹 점수</dt><dd>{rank.elo}</dd></div>}
    <div><dt>역대 최고 1대1 등급</dt><dd>{highest?.name ?? "정보 없음"}</dd></div></dl>
    {highest?.achieved_at && <small>{new Date(highest.achieved_at).toLocaleDateString("ko-KR")} 달성</small>}
    <small>{rank.as_of ? `${date(rank.as_of)} 공식 집계` : `${date(side.profile.fetched_at)} 조회`}</small>
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
  useEffect(() => {
    if (!matchId) return;
    const key = `${analysis.ouid}:${analysis.match_type}:${matchId}`;
    const cached = cache.current.get(key);
    if (cached) { setData(cached); setError(""); setBusy(false); return; }
    let cancelled = false;
    setBusy(true); setError(""); setData(null);
    requestApi<MatchReview>(`/matches/${encodeURIComponent(matchId)}/review?ouid=${encodeURIComponent(analysis.ouid)}&match_type=${analysis.match_type}`)
      .then(result => { if (!cancelled) { cache.current.set(key, result); setData(result); } })
      .catch(failure => { if (!cancelled) setError(failure instanceof Error ? failure.message : "경기 분석을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [analysis.ouid, analysis.match_type, matchId, retry]);
  if (!matches.length) return <p>검색/설정에서 최근 경기 진단을 실행하면 경기별 비교를 볼 수 있습니다.</p>;
  return <section className="match-review" aria-label="경기별 상대 비교">
    <label className="match-review-selector">분석할 경기<select aria-label="경기별 분석 경기 선택" value={matchId} onChange={event => setSelected(event.target.value)}>{matches.map(match => <option key={match.match_id} value={match.match_id}>{date(match.match_date)} · {match.opponent_nickname} · {match.score_for_display ?? match.score_for}:{match.score_against_display ?? match.score_against} · {endLabel(match.match_end_type)}</option>)}</select></label>
    {busy && <p role="status">경기 기록과 상대의 공식 1대1 순위를 확인하고 있습니다…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="btn secondary" onClick={() => setRetry(value => value + 1)}>다시 불러오기</button></div>}
    {data && data.match_id === matchId && <>
      <header className="match-review-score"><div><span>나</span><strong>{data.mine.nickname}</strong></div><div><span>최종 점수</span><b>{data.mine.score ?? "–"} : {data.opponent.score ?? "–"}</b><span>{data.result} · {endLabel(data.match_end_type)}</span></div><div><span>상대</span><strong>{data.opponent.nickname}</strong></div></header>
      {(data.mine.record_goals !== data.mine.score || data.opponent.record_goals !== data.opponent.score) && <p className="match-comparison-note">슈팅 기록에 집계된 득점은 {data.mine.record_goals ?? "–"}:{data.opponent.record_goals ?? "–"}입니다. 몰수 처리·자책골 등의 반영으로 위 최종 점수와 다를 수 있습니다.</p>}
      <p className="match-review-context">{date(data.match_date)} · {MATCH_LABELS[data.match_type as MatchType] ?? "경기"}</p>
      <div className="match-rank-grid"><RankCard side={data.mine} label="나" /><RankCard side={data.opponent} label="상대" /></div>
      <details className="detail-block"><summary>순위·등급의 의미</summary><p>현재 시즌 순위는 공식 홈페이지의 1대1 랭킹이며 상위 10,000위까지만 공개됩니다. ‘공개 순위에 없음’은 현재 등급이 낮다는 뜻이 아닙니다. 역대 최고 등급은 공식 API의 달성 기록이며 현재 등급·이 경기 당시 등급과 다릅니다.</p><p>경기 당시의 순위·등급은 제공되지 않아 상대의 실력 차이나 승패 원인으로 사용하지 않습니다.</p><a href={data.mine.profile.source_url} target="_blank" rel="noreferrer">공식 1대1 랭킹 확인 ↗</a></details>
      <div className="match-review-findings">{[{ title: "이 경기에서 앞선 점", findings: data.positives, tone: "positive" }, { title: "이 경기 개선점", findings: data.checks, tone: "check" }].map(({title, findings, tone}) => <section key={title} className={`match-findings-${tone}`}><h4>{title}</h4>{findings.length ? findings.map(item => <article key={item.metric}><strong>{item.title}</strong><p>{item.evidence}</p><p className="match-next-action">{item.action}</p></article>) : <p>{data.normal ? "비교 가능한 기록에서 뚜렷한 차이가 확인되지 않았습니다." : "몰수 경기에는 교정 제안을 표시하지 않습니다."}</p>}</section>)}</div>
      <p className="match-comparison-note">{data.comparison_note}</p>
      <div className="match-metric-comparison"><h4>이 경기 기록 비교</h4><div className="match-comparison-heading"><span>기록</span><strong>나</strong><strong>상대</strong></div>
        {["슈팅", "패스", "수비", "경기 운영"].map(group => <section key={group}><h5>{group}</h5>{data.metrics.filter(metric => metric.group === group).map(metric => <div key={metric.key} className="match-metric-row"><span>{metric.label}</span>{[metric.mine, metric.opponent].map((value, index) => <div key={index}><strong>{metricText(value, metric.unit)}</strong>{value.success != null && value.trials != null && <small>{value.success}/{value.trials}회</small>}<i className={index === 0 ? "mine" : "opponent"} style={{ width: `${metric.unit === "%" ? Math.max(0, Math.min(100, value.value ?? 0)) : Math.max(0, (value.value ?? 0) / Math.max(metric.mine.value ?? 0, metric.opponent.value ?? 0, 1) * 100)}%` }} /></div>)}</div>)}</section>)}
      </div>
      <div className="match-shot-comparison"><section><h4>내 슈팅 · {data.mine.nickname}</h4><InteractiveShotMap points={data.mine.shots} /></section><section><h4>상대 슈팅 · {data.opponent.nickname}</h4><InteractiveShotMap points={data.opponent.shots} /></section></div>
    </>}
  </section>;
}
