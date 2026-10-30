"use client";

import { useEffect, useRef, useState } from "react";
import { requestApi } from "../../lib/apiClient";
import { analyticsError, trackEvent } from "../../lib/analytics";
import { MATCH_LABELS, MATCH_TYPE_OPTIONS } from "../../lib/uiConstants";
import type { MatchType, RecentMatchSummary, UserSearchResponse } from "../../types/analysis";
import type { BeforeAfterPayload, ComparisonMetric } from "../../types/comparison";

function valueText(value: number | null | undefined, unit: string, delta = false) {
  if (value == null) return "—";
  const rate = unit === "rate" || unit === "percent";
  const converted = value * (rate ? 100 : unit === "yards" ? .9144 : 1);
  return `${delta && converted > 0 ? "+" : ""}${converted.toLocaleString("ko-KR", { maximumFractionDigits: rate ? 1 : 2 })}${rate ? delta ? "%p" : "%" : unit === "yards" ? "m" : unit === "goals" ? "골" : unit === "rating" ? "점" : "회"}`;
}
function matchLabel(match: RecentMatchSummary) {
  return `${new Date(match.match_date).toLocaleString("ko-KR")} · ${match.opponent_nickname} · ${match.score_for_display ?? match.score_for}:${match.score_against_display ?? match.score_against}${match.match_end_type === 1 ? " · 몰수승" : match.match_end_type === 2 ? " · 몰수패" : ""}`;
}
function MatchGroupPicker({ title, matches, selected, other, disabled, onChange }: {
  title: string; matches: RecentMatchSummary[]; selected: string[]; other: string[]; disabled: boolean; onChange: (ids: string[]) => void;
}) {
  const chosen = new Set(selected), occupied = new Set(other);
  const indices = matches.flatMap((m, index) => m.match_id && chosen.has(m.match_id) ? [index] : []);
  const startIndex = indices.length ? Math.max(...indices) : -1, endIndex = indices.length ? Math.min(...indices) : -1;
  const start = matches[startIndex]?.match_id ?? "", end = matches[endIndex]?.match_id ?? "";
  function range(from: string, to: string) {
    const first = matches.findIndex(m => m.match_id === from), last = to ? matches.findIndex(m => m.match_id === to) : 0;
    onChange(first >= 0 && last >= 0 && first >= last ? matches.slice(last, first + 1).flatMap(m => m.match_id ? [m.match_id] : []) : []);
  }
  return <section className="comparison-group-picker"><div className="coaching-section-heading"><h4>{title}</h4><strong>{selected.length}경기 선택</strong></div>
    <label>시작 경기<select aria-label={`${title} 시작 경기`} disabled={disabled} value={start} onChange={e => range(e.target.value, end)}><option value="">시작 경기를 선택하세요</option>{[...matches].reverse().map(m => <option key={m.match_id} value={m.match_id}>{matchLabel(m)}</option>)}</select></label>
    <label>종료 경기<select aria-label={`${title} 종료 경기`} disabled={disabled} value={end} onChange={e => range(start, e.target.value)}><option value="">최신 경기까지</option>{matches.map((m, i) => <option key={m.match_id} value={m.match_id} disabled={startIndex >= 0 && i > startIndex}>{matchLabel(m)}</option>)}</select></label>
    <details className="comparison-individual-picker"><summary>경기를 하나씩 고르기</summary><div>{matches.map(match => <label key={match.match_id}><input type="checkbox" checked={chosen.has(match.match_id!)} disabled={disabled || occupied.has(match.match_id!) && !chosen.has(match.match_id!)} onChange={e => onChange(e.target.checked ? [...selected, match.match_id!] : selected.filter(id => id !== match.match_id))} /><span>{matchLabel(match)}</span></label>)}</div></details>
    <button type="button" className="link-like" disabled={disabled || !selected.length} onClick={() => onChange([])}>{title} 선택 해제</button>
  </section>;
}
function MetricRow({ item }: { item: ComparisonMetric }) {
  const before = item.before.value, after = item.after.value;
  const maximum = ["rate", "percent"].includes(item.unit) ? 1 : Math.max(before ?? 0, after ?? 0, 1);
  return <article className={`comparison-metric-row change-${item.status}`}><h5>{item.label}</h5>
    <div><small>개선 전</small><strong>{valueText(before, item.unit)}</strong><span className="comparison-bar before" style={{ width: `${Math.max(0, (before ?? 0) / maximum * 100)}%` }} /></div>
    <div><small>개선 후</small><strong>{valueText(after, item.unit)}</strong><span className="comparison-bar after" style={{ width: `${Math.max(0, (after ?? 0) / maximum * 100)}%` }} /></div>
    <div><small>변화</small><strong>{valueText(item.delta, item.unit, true)}</strong><span>{item.status === "improved" ? "개선 방향" : item.status === "declined" ? "보완할 변화" : item.status === "unavailable" ? "—" : item.status === "same" ? "변화 없음" : "참고 지표"}</span></div>
  </article>;
}
export function BeforeAfterComparisonPanel({ initialNickname, initialMatchType }: { initialNickname: string; initialMatchType: MatchType }) {
  const [nickname, setNickname] = useState(initialNickname);
  const [matchType, setMatchType] = useState(initialMatchType);
  const [owner, setOwner] = useState<UserSearchResponse | null>(null);
  const [matches, setMatches] = useState<RecentMatchSummary[]>([]);
  const [before, setBefore] = useState<string[]>([]), [after, setAfter] = useState<string[]>([]);
  const [wins, setWins] = useState(false), [losses, setLosses] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<BeforeAfterPayload | null>(null);
  const [category, setCategory] = useState("main");
  const generation = useRef(0);
  const resultRef = useRef<HTMLElement>(null);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { generation.current++; setBusy(false); setNickname(initialNickname); setMatchType(initialMatchType); clear(); }, [initialNickname, initialMatchType]);
  useEffect(() => { if (result) resultRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [result]);
  function clear() { setOwner(null); setMatches([]); setBefore([]); setAfter([]); setResult(null); setError(""); }
  async function load() {
    const token = ++generation.current;
    setBusy(true); setError(""); setOwner(null); setMatches([]); setResult(null);
    let stage = "user_search";
    try {
      const user = await requestApi<UserSearchResponse>(`/users/search?nickname=${encodeURIComponent(nickname.trim())}`);
      stage = "match_list";
      const data = await requestApi<{ items: RecentMatchSummary[]; sync_warning?: string }>(`/matches/recent?ouid=${encodeURIComponent(user.ouid)}&match_type=${matchType}`, undefined, { timeoutMs: 120_000 });
      if (token !== generation.current) return;
      const ids = new Set(data.items.map(m => m.match_id));
      setOwner(user); setMatches(data.items.filter(m => m.match_id)); setBefore(current => current.filter(id => ids.has(id))); setAfter(current => current.filter(id => ids.has(id))); setResult(null);
      if (!data.items.length) setError(data.sync_warning || "이 경기 모드에서 조회할 수 있는 경기 내역이 없습니다. 다른 모드를 선택해보세요.");
      trackEvent("before_after_match_list_completed", { screen: "tracking", matchType, properties: { result_count: data.items.length } });
    } catch (e) {
      if (token === generation.current) {
        setError(e instanceof Error ? e.message : "경기 목록을 불러오지 못했습니다.");
        trackEvent("before_after_match_list_failed", { screen: "tracking", matchType, properties: { stage, ...analyticsError(e) } });
      }
    }
    finally { if (token === generation.current) setBusy(false); }
  }
  const eligible = matches.filter(m => m.match_end_type === 0 || wins && m.match_end_type === 1 || losses && m.match_end_type === 2);
  const allowed = new Set(eligible.map(m => m.match_id));
  const pre = before.filter(id => allowed.has(id)), post = after.filter(id => allowed.has(id));
  const postIds = new Set(post);
  const overlap = pre.filter(id => postIds.has(id)).length;
  async function compare() {
    if (!owner) return;
    const token = ++generation.current;
    setBusy(true); setError(""); setResult(null);
    try {
      const payload = await requestApi<BeforeAfterPayload>("/analysis/compare", { method: "POST", body: JSON.stringify({
        ouid: owner.ouid, match_type: matchType, before_match_ids: pre, after_match_ids: post, include_forfeit_wins: wins, include_forfeit_losses: losses,
      }) }, { timeoutMs: 120_000 });
      if (token === generation.current) {
        setResult(payload); setCategory("main");
        trackEvent("before_after_completed", { screen: "tracking", matchType, properties: {
          before_matches: payload.before.matches, after_matches: payload.after.matches,
          metric_count: payload.metrics.length, include_forfeit_wins: wins, include_forfeit_losses: losses,
        } });
      }
    } catch (e) {
      if (token === generation.current) {
        setError(e instanceof Error ? e.message : "두 구간을 비교하지 못했습니다.");
        trackEvent("before_after_failed", { screen: "tracking", matchType, properties: {
          stage: "compare", before_matches: pre.length, after_matches: post.length, ...analyticsError(e),
        } });
      }
    }
    finally { if (token === generation.current) setBusy(false); }
  }
  const categories = result ? [...new Map(result.metrics.map(m => [m.category, m.category_label])).entries()] : [];
  const primary = new Set(["pass_overall", "on_target", "conversion", "display_goals", "goals_against", "team_tackle", "pass_through", "win_rate"]);
  return <section className="before-after-comparison grid">
    <article className="panel"><div className="coaching-section-heading"><div><h2 className="section-title">전후 비교</h2><p>비교할 경기를 두 구간으로 나눠 수치 변화와 유지·보완할 플레이를 확인하세요.</p></div></div>
      <div className="comparison-search"><input aria-label="전후 비교 감독명" placeholder="감독명" value={nickname} disabled={busy} onChange={e => { setNickname(e.target.value); clear(); }} /><select aria-label="전후 비교 경기 모드" value={matchType} disabled={busy} onChange={e => { setMatchType(Number(e.target.value) as MatchType); clear(); }}>{MATCH_TYPE_OPTIONS.map(mode => <option key={mode} value={mode}>{MATCH_LABELS[mode]}</option>)}</select><button type="button" className="btn" disabled={busy || nickname.trim().length < 2} onClick={() => void load()}>{busy ? "처리 중…" : "경기 목록 불러오기"}</button></div>
      {!!matches.length && <><div className="comparison-selection-toolbar"><button type="button" className="btn secondary" disabled={busy || eligible.length < 2} onClick={() => { const half = Math.ceil(eligible.length / 2); setAfter(eligible.slice(0, half).map(m => m.match_id!)); setBefore(eligible.slice(half).map(m => m.match_id!)); setResult(null); }}>조회 경기를 앞·뒤 절반으로 나누기</button><label><input type="checkbox" checked={wins} disabled={busy} onChange={e => { setWins(e.target.checked); setResult(null); }} />몰수승 포함</label><label><input type="checkbox" checked={losses} disabled={busy} onChange={e => { setLosses(e.target.checked); setResult(null); }} />몰수패 포함</label></div>
      <div className="comparison-group-grid"><MatchGroupPicker title="개선 전" matches={eligible} selected={pre} other={post} disabled={busy} onChange={ids => { setBefore(ids); setResult(null); }} /><MatchGroupPicker title="개선 후" matches={eligible} selected={post} other={pre} disabled={busy} onChange={ids => { setAfter(ids); setResult(null); }} /></div>
      {!!overlap && <p role="alert" className="notice error">두 구간에 {overlap}경기가 겹칩니다. 한쪽에서 제외해주세요.</p>}
      <button type="button" className="btn comparison-run" disabled={busy || !pre.length || !post.length || !!overlap} onClick={() => void compare()}>{busy ? "비교 중…" : `개선 전 ${pre.length}경기 · 개선 후 ${post.length}경기 비교하기`}</button></>}
      {!!error && <p role="alert" className="notice error">{error}</p>}
    </article>
    {result && <><article className="panel comparison-results" ref={resultRef}><div className="coaching-section-heading"><h3 className="section-title">두 구간의 변화</h3><span>{owner?.nickname} · {MATCH_LABELS[matchType]}</span></div>
      <div className="comparison-periods">{([['개선 전', result.before], ['개선 후', result.after]] as const).map(([title, group]) => <div key={title}><small>{title}</small><strong>{group.matches}경기</strong><span>{new Date(group.from).toLocaleDateString("ko-KR")} ~ {new Date(group.to).toLocaleDateString("ko-KR")}</span>{group.forfeit_count > 0 && <small>정상 {group.normal_count} · 몰수 {group.forfeit_count}</small>}</div>)}</div>
      <div className="comparison-insights">{[{ title: "좋아진 수치 · 유지할 플레이", items: result.strengths, tone: "positive" }, { title: "보완할 변화 · 이렇게 바꾸세요", items: result.improvements, tone: "check" }].map(section => <section key={section.tone} className={`comparison-insight-${section.tone}`}><h4>{section.title}</h4>{section.items.length ? section.items.map(item => <article key={item.metric}><strong>{item.label} · {valueText(item.before, item.unit)} → {valueText(item.after, item.unit)}</strong><p>{item.action}</p></article>) : <p>비교 가능한 지표에서 해당 방향의 변화가 없습니다.</p>}</section>)}</div>
      <nav className="coaching-domain-nav" aria-label="전후 비교 지표 영역"><button aria-pressed={category === "main"} onClick={() => setCategory("main")}>핵심 지표</button>{categories.map(([id, label]) => <button key={id} aria-pressed={category === id} onClick={() => setCategory(id)}>{label}</button>)}</nav>
      <div className="comparison-metrics">{result.metrics.filter(m => category === "main" ? primary.has(m.metric) : m.category === category).map(item => <MetricRow key={item.metric} item={item} />)}</div>
    </article></>}
  </section>;
}
