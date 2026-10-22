"use client";

import { useEffect, useRef, useState } from "react";
import { requestApi } from "../../lib/apiClient";
import type { MatchSampleOptions, MatchType, RecentMatchSummary, UserSearchResponse } from "../../types/analysis";

const END_LABELS: Record<number, string> = { 0: "정상 종료", 1: "몰수승", 2: "몰수패" };

export function MatchSampleSelector({ nickname, matchType, value, disabled, onChange, onLoadingChange, onSelectionCountChange }: {
  nickname: string; matchType: MatchType; value: MatchSampleOptions; disabled: boolean;
  onChange: (value: MatchSampleOptions) => void; onLoadingChange: (loading: boolean) => void;
  onSelectionCountChange: (count: number | null) => void;
}) {
  const [matches, setMatches] = useState<RecentMatchSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; onLoadingChange(false); }, [onLoadingChange]);

  async function load() {
    const requestId = ++generation.current;
    setBusy(true); onLoadingChange(true); setMessage(""); setFailed(false); setLoaded(false); setMatches([]);
    try {
      const user = await requestApi<UserSearchResponse>(`/users/search?nickname=${encodeURIComponent(nickname.trim())}`);
      const data = await requestApi<{ items: RecentMatchSummary[]; sync_warning?: string }>(`/matches/recent?ouid=${encodeURIComponent(user.ouid)}&match_type=${matchType}`, undefined, { timeoutMs: 120_000 });
      if (requestId !== generation.current) return;
      setMatches(data.items);
      setLoaded(true);
      const ids = new Set(data.items.map(m => m.match_id));
      onChange({ ...value, start_match_id: value.start_match_id && ids.has(value.start_match_id) ? value.start_match_id : data.items.at(-1)?.match_id ?? null,
        end_match_id: value.end_match_id && ids.has(value.end_match_id) ? value.end_match_id : null });
      setMessage(data.items.length ? data.sync_warning || `최근 경기 ${data.items.length}개를 불러왔습니다.` : data.sync_warning || "이 경기 모드에서 조회할 수 있는 경기 내역이 없습니다. 다른 모드를 선택해보세요.");
    } catch (error) {
      if (requestId === generation.current) { setFailed(true); setMessage(error instanceof Error ? error.message : "경기를 불러오지 못했습니다."); }
    } finally {
      if (requestId === generation.current) { setBusy(false); onLoadingChange(false); }
    }
  }

  const startIndex = value.start_match_id ? matches.findIndex(m => m.match_id === value.start_match_id) : matches.length - 1;
  const endIndex = value.end_match_id ? matches.findIndex(m => m.match_id === value.end_match_id) : 0;
  const included = matches.slice(Math.max(0, endIndex), startIndex + 1).filter(m => m.match_end_type === 0 ||
    m.match_end_type === 1 && value.include_forfeit_wins || m.match_end_type === 2 && value.include_forfeit_losses);
  useEffect(() => { onSelectionCountChange(loaded ? included.length : null); }, [loaded, included.length, onSelectionCountChange]);
  const label = (m: RecentMatchSummary) => `${new Date(m.match_date).toLocaleString("ko-KR")} · ${m.opponent_nickname} · ${m.score_for_display ?? m.score_for}:${m.score_against_display ?? m.score_against} · ${END_LABELS[m.match_end_type ?? -1] ?? "종료 유형 미확인"}`;
  return <section className="match-sample-selector" aria-label="분석 경기 선택">
    <h3>분석할 경기 범위</h3>
    <button type="button" className="btn" disabled={disabled || busy || nickname.trim().length < 2} onClick={() => void load()}>{busy ? "경기 조회 중…" : "경기 목록 불러오기"}</button>
    {!!message && <p className={failed ? "notice error" : "search-feedback"} role={failed ? "alert" : "status"}>{message}</p>}
    <div className="match-range-fields">
      <label className="match-start-label">시작 경기
        <select aria-label="분석 시작 경기" value={value.start_match_id ?? ""} disabled={disabled || busy || !matches.length} onChange={e => {
          const start = matches.findIndex(m => m.match_id === e.target.value);
          onChange({ ...value, start_match_id: e.target.value || null, end_match_id: start >= 0 && endIndex > start ? null : value.end_match_id });
        }}>
          <option value="">조회 가능한 가장 오래된 경기</option>
          {value.start_match_id && !matches.some(m => m.match_id === value.start_match_id) && <option value={value.start_match_id}>선택한 시작 경기 · 목록을 불러오세요</option>}
          {[...matches].reverse().filter(m => m.match_id).map(m => <option key={m.match_id} value={m.match_id}>{label(m)}</option>)}
        </select>
      </label>
      <label className="match-start-label">종료 경기
        <select aria-label="분석 종료 경기" value={value.end_match_id ?? ""} disabled={disabled || busy || !matches.length} onChange={e => onChange({ ...value, end_match_id: e.target.value || null })}>
          <option value="">최신 경기까지</option>
          {value.end_match_id && !matches.some(m => m.match_id === value.end_match_id) && <option value={value.end_match_id}>선택한 종료 경기 · 목록을 불러오세요</option>}
          {matches.filter(m => m.match_id).map((m, index) => <option key={m.match_id} value={m.match_id} disabled={startIndex >= 0 && index > startIndex}>{label(m)}</option>)}
        </select>
      </label>
    </div>
    <div className="match-filter-options">
      <label><input type="checkbox" checked={value.include_forfeit_wins} disabled={disabled || busy} onChange={e => onChange({ ...value, include_forfeit_wins: e.target.checked })} />몰수승 포함</label>
      <label><input type="checkbox" checked={value.include_forfeit_losses} disabled={disabled || busy} onChange={e => onChange({ ...value, include_forfeit_losses: e.target.checked })} />몰수패 포함</label>
    </div>
    <p className="range-selection-summary">{matches.length ? `선택 범위 ${included.length}경기 분석 · 시작·종료 경기 포함` : "시작 경기부터 종료 경기까지 분석합니다. 종료를 지정하지 않으면 최신 경기까지 포함합니다."}</p>
    {loaded && !!matches.length && !included.length && <p className="search-feedback" role="status">선택한 범위와 몰수 포함 조건에 맞는 경기 내역이 없습니다. 경기 범위나 포함 조건을 바꿔주세요.</p>}
  </section>;
}
