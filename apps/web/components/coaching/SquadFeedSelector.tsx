"use client";

import { useEffect, useRef, useState } from "react";
import { requestApi } from "../../lib/apiClient";
import { analyticsError, trackEvent } from "../../lib/analytics";
import { feedNicknameKey, type SquadFeedList, type SquadFeedSnapshot, type SquadFeedSummary } from "../../types/squadFeed";
import { SquadFeedSettings } from "./SquadFeedSettings";

export function SquadFeedSelector({ nickname, selected, disabled, onChange, onLoadingChange }: {
  nickname: string; selected: SquadFeedSnapshot | null; disabled: boolean;
  onChange: (snapshot: SquadFeedSnapshot | null) => void; onLoadingChange: (loading: boolean) => void;
}) {
  const [items, setItems] = useState<SquadFeedSummary[]>([]);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current += 1; onLoadingChange(false); }, [onLoadingChange]);

  async function run<T>(stage: "squad_feed_list" | "squad_feed_selection", load: () => Promise<T>, apply: (value: T) => Record<string, unknown>) {
    const request = ++sequence.current;
    setLoading(true); onLoadingChange(true); setError("");
    try {
      const value = await load();
      if (request === sequence.current) {
        const properties = apply(value);
        trackEvent(`${stage}_completed`, { screen: "search", properties });
      }
    } catch (error) {
      if (request === sequence.current) {
        setError(error instanceof Error ? error.message : "공개 피드를 불러오지 못했습니다.");
        trackEvent(`${stage}_failed`, { screen: "search", properties: analyticsError(error) });
      }
    }
    finally { if (request === sequence.current) { setLoading(false); onLoadingChange(false); } }
  }

  function loadPage(nextPage: number) {
    void run("squad_feed_list", () => requestApi<SquadFeedList>(`/squad-feeds?nickname=${encodeURIComponent(nickname.trim())}&page=${nextPage}`), result => {
      setItems(previous => nextPage === 1 ? result.items : [...new Map([...previous, ...result.items].map(item => [item.feed_id, item])).values()]);
      setPage(result.page); setMore(result.has_more);
      if (nextPage === 1 && !result.has_more && selected && !result.items.some(item => item.feed_id === selected.feed_id)) onChange(null);
      return { page: result.page, result_count: result.items.length, has_more: result.has_more };
    });
  }

  function choose(feedId: string) {
    onChange(null);
    void run("squad_feed_selection", () => requestApi<SquadFeedSnapshot>(`/squad-feeds/${encodeURIComponent(feedId)}`), snapshot => {
      if (feedNicknameKey(snapshot.author) !== feedNicknameKey(nickname)) {
        throw Object.assign(new Error("피드 작성자가 입력한 닉네임과 다릅니다. 목록을 다시 불러오세요."), { code: "author_mismatch" });
      }
      onChange(snapshot);
      return { player_count: snapshot.players.length };
    });
  }

  return <section className="squad-feed-selector" aria-label="공개 피드 선택" aria-busy={loading}>
    <div className="coaching-section-heading"><div><h3>공개 스쿼드 연결 · 선택 사항</h3><p className="coaching-scope-note">공개 피드 하나를 선택하면 분석할 경기의 기록과 저장된 설정을 함께 확인합니다.</p></div></div>
    <button className="btn" type="button" disabled={disabled || loading || nickname.trim().length < 2} onClick={() => loadPage(1)}>{loading ? "피드 불러오는 중…" : page ? "공개 피드 새로 불러오기" : "닉네임의 공개 피드 불러오기"}</button>
    {error && <p className="notice error" role="alert">{error} 경기 진단은 피드 없이도 실행할 수 있습니다.</p>}
    {page > 0 && <p className="coaching-scope-note" role="status">{items.length ? `불러온 공개 피드 ${items.length}개 · 하나를 선택하세요.` : "이 페이지에 해당 닉네임의 공개 피드가 없습니다."}</p>}
    <div className="feed-options">{items.map(item => <label key={item.feed_id} className={`feed-option${selected?.feed_id === item.feed_id ? " selected" : ""}`}>
      <input type="radio" name="squad-feed" value={item.feed_id} checked={selected?.feed_id === item.feed_id} disabled={disabled || loading} onChange={() => choose(item.feed_id)} />
      <span><strong>{item.title}</strong><small>{item.formation} · {item.mode === 1 ? "1vs1" : item.mode === 2 ? "감독 모드" : "모드 미제공"} · 생성 {item.created_at?.slice(0, 10) ?? "날짜 미제공"}</small></span>
    </label>)}</div>
    {more && <button className="btn secondary" disabled={disabled || loading} type="button" onClick={() => loadPage(page + 1)}>다음 피드 더 보기</button>}
    {selected && <div className="feed-preview" aria-live="polite"><div className="coaching-section-heading"><strong>다음 진단에 연결: {selected.title}</strong><button className="btn secondary" type="button" disabled={disabled || loading} onClick={() => onChange(null)}>선택 해제</button></div>
      <p className="coaching-scope-note">경기 선수와 다른 설정은 구분해서 표시합니다. 생성일은 최종 수정일이 아니며 과거 경기에서 사용한 설정인지는 확인되지 않습니다.</p>
      <details className="detail-block"><summary>선택한 피드 설정 미리 보기</summary><SquadFeedSettings snapshot={selected} /></details>
    </div>}
    {!selected && <p className="coaching-scope-note">피드를 연결하지 않아도 경기 기록 분석은 그대로 이용할 수 있습니다.</p>}
  </section>;
}
