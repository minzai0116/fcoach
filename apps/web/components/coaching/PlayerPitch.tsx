"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PositionCoaching } from "../../types/coaching";
import type { PlayerReportEntry } from "../../types/analysis";
import { buildPitchLineup, layoutPitchPlayers, lineupKey, type PitchPlayer } from "../../lib/pitchLineup";
import { PlayerPortrait } from "../player/PlayerPortrait";
import { OfficialPlayerBadges } from "../player/OfficialPlayerBadges";
import { PlayerDetailPanel } from "./PlayerDetailPanel";
import { layoutPitchCards, type PitchCardLayout } from "../../lib/pitchCardLayout";

function playerState(player: PitchPlayer) {
  if (!player.record) return { label: "이 자리 기록 없음", tone: "empty" };
  if (player.comparison?.plans?.some(p => p.status === "priority" || p.status === "review") || player.record.findings.length)
    return { label: "교정 후보", tone: "review" };
  return { label: "기록 확인", tone: "observe" };
}

export function PlayerPitch({ coaching, reportPlayers = [] }: { coaching: PositionCoaching; reportPlayers?: PlayerReportEntry[] }) {
  const [source, setSource] = useState<"feed" | "match">("feed");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mobileDetails, setMobileDetails] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const pitchRef = useRef<HTMLDivElement>(null);
  const [cardLayout, setCardLayout] = useState<PitchCardLayout | null>(null);
  const detailId = useId();
  const feed = coaching.squad_feed?.status === "available" ? coaching.squad_feed : undefined;
  const currentSource = feed?.snapshot.players.some(p => p.lineup_role === "starter") ? source : "match";
  const lineup = useMemo(() => buildPitchLineup(coaching, currentSource), [coaching, currentSource]);
  const nodes = useMemo(() => layoutPitchPlayers(lineup), [lineup]);
  const savedPositions = feed?.snapshot.players.filter(p => p.lineup_role === "starter").every(p => p.pitch_position?.status === "present");
  const portraits = useMemo(() => new Map(reportPlayers.map(p => [`${p.sp_id}:${p.sp_grade}`, p])), [reportPlayers]);
  const records = useMemo(() => {
    const all = new Map(lineup.map(p => [p.key, p]));
    const comparisons = new Map(feed?.comparisons.map(p => [lineupKey(p.sp_id, p.sp_grade, p.position_name), p]));
    coaching.players.forEach(record => {
      const key = lineupKey(record.sp_id, record.sp_grade, record.position_name);
      if (all.has(key)) return;
      const comparison = comparisons.get(key);
      all.set(key, { key, spId: record.sp_id, grade: record.sp_grade, position: record.position_name, name: record.player_name,
        record, comparison, settings: comparison?.linked ? comparison.settings ?? undefined : undefined });
    });
    return all;
  }, [coaching.players, feed, lineup]);
  const defaultPlayer = lineup.find(p => p.comparison?.plans?.some(plan => plan.status === "priority" || plan.status === "review")) ?? lineup[0] ?? records.values().next().value;
  const selected = selectedKey ? records.get(selectedKey) ?? defaultPlayer : defaultPlayer;
  const pitchKeys = new Set(nodes.map(node => node.key));
  const otherRecords = [...records.values()].filter(p => !pitchKeys.has(p.key));
  const portrait = (player: PitchPlayer) => portraits.get(`${player.spId}:${player.grade}`) ?? { sp_id: player.spId, face_img: "", action_img: "", fallback_img: "" };
  const badges = (player: PitchPlayer) => <OfficialPlayerBadges seasonImg={portraits.get(`${player.spId}:${player.grade}`)?.season_img || player.settings?.season_img} seasonName={player.record?.season_name || player.settings?.season_code} grade={player.grade} />;
  function selectPlayer(player: PitchPlayer) { setSelectedKey(player.key); }
  useEffect(() => {
    const field = pitchRef.current;
    if (!field) return;
    const observer = new ResizeObserver(() => {
      const bounds = field.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      setCardLayout(layoutPitchCards(nodes, bounds.width, bounds.height, window.innerWidth <= 900));
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [nodes]);
  useEffect(() => {
    if (!window.matchMedia("(max-width: 900px)").matches || (!selectedKey && !mobileDetails)) return;
    const target = mobileDetails ? ".mobile-detail-back" : '.pitch-player[aria-pressed="true"]';
    workspaceRef.current?.querySelector<HTMLButtonElement>(target)?.focus({ preventScroll: true });
  }, [mobileDetails, selectedKey]);
  return <div className="player-pitch-workspace compact-player-workspace" data-mobile-view={mobileDetails ? "detail" : "formation"} ref={workspaceRef}>
    <div className="player-pitch-overview">
      <div className="coaching-section-heading"><div><h4>포메이션</h4></div>
        {feed && <label className="pitch-source">배치 기준<select aria-label="선수 배치 기준" value={currentSource} onChange={event => { setSource(event.target.value as "feed" | "match"); setSelectedKey(null); setMobileDetails(false); }}>
          <option value="feed">{savedPositions ? "피드 포메이션" : "피드 등록 포지션"} · {feed.snapshot.formation}</option><option value="match">최근 경기 등록 포지션</option>
        </select></label>}
        {!!otherRecords.length && <details className="pitch-other-records"><summary>다른 선수 {otherRecords.length}</summary><div className="pitch-other-popover"><div className="pitch-other-players">{otherRecords.map(player => <button key={player.key} type="button" aria-pressed={selected?.key === player.key} aria-controls={detailId} onClick={event => { selectPlayer(player); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{player.position} · {player.name} +{player.grade}</button>)}</div></div></details>}
      </div>
      <p className="pitch-source-note">{currentSource === "feed" ? `${feed?.snapshot.title} · 선발 ${nodes.length}명` : coaching.latest_lineup ? `${new Date(coaching.latest_lineup.match_date).toLocaleString("ko-KR")} · 등록 자리 ${nodes.length}명` : "이전 분석에는 경기 배치 정보가 없습니다. 다시 진단하면 최근 경기의 배치를 볼 수 있습니다."}</p>
      <div className="pitch-fit-area" role="region" aria-label="포메이션 경기장">
      <div className="player-pitch" ref={pitchRef} data-compact={cardLayout?.compact} style={cardLayout ? { "--pitch-card-width": `${cardLayout.cardWidth}px`, "--pitch-face": `${cardLayout.photoSize}px`, "--pitch-font": `${cardLayout.fontSize}px`, "--pitch-badge-height": `${cardLayout.badgeHeight}px`, "--pitch-card-height": `${cardLayout.cardHeight}px` } as React.CSSProperties : undefined} role="group" aria-label={currentSource === "feed" ? "공개 피드 선발 포메이션" : "최근 분석 경기 선수 배치"}>
        <div className="player-pitch-markings" aria-hidden="true"><i className="pitch-half" /><i className="pitch-circle" /><i className="pitch-area north" /><i className="pitch-area south" /><i className="pitch-goal north" /><i className="pitch-goal south" /></div>
        <div className="player-pitch-players">{nodes.map(player => {
          const state = playerState(player);
          const card = cardLayout?.positions[player.key];
          return <button type="button" className={`pitch-player tone-${state.tone}`} data-player-key={player.key} data-position-source={player.exact ? "saved" : "role"} data-pitch-role={player.position} key={player.key} title={`${player.position} · ${player.name}`} style={card ? { left: `${card.x}px`, top: `${card.y}px` } : { left: `${player.left}%`, top: `${player.top}%` }}
            aria-label={`${player.position} ${player.name} +${player.grade ?? "?"} · ${state.label} · 상세 보기`} aria-pressed={selected?.key === player.key} aria-controls={detailId} onClick={() => selectPlayer(player)}>
            <span className="pitch-position">{player.position}<span className="pitch-state-dot" aria-hidden="true" /></span>
            <span className="pitch-face-circle"><PlayerPortrait player={portrait(player)} alt="" className="pitch-portrait" /></span>
            <span className="pitch-player-caption"><span className="pitch-card-badges">{badges(player)}</span><strong className="pitch-name-full">{player.name}</strong><strong className="pitch-name-short">{player.name.trim().split(/\s+/).at(-1)}</strong></span>
          </button>;
        })}
        {!nodes.length && <p className="pitch-empty">배치할 선수 정보가 없습니다.</p>}</div>
      </div>
      </div>
      <div className="pitch-legend"><span><i className="review" />교정 후보</span><span><i className="observe" />기록 확인</span><span><i className="empty" />이 자리 기록 없음</span></div>


    </div>
    <div className="mobile-player-selection" aria-live="polite">
      <div>{selectedKey && selected ? <><strong>{selected.position} · {selected.name}</strong><span>{badges(selected)}</span></> : <strong>선수를 선택하세요</strong>}</div>
      <button type="button" className="btn" disabled={!selectedKey} aria-controls={detailId} onClick={() => setMobileDetails(true)}>자세히 보기 →</button>
    </div>
    <PlayerDetailPanel key={selected?.key ?? "empty"} player={selected} report={selected ? portraits.get(`${selected.spId}:${selected.grade}`) : undefined} observation={coaching.mode === "observation"} id={detailId} onBack={() => setMobileDetails(false)} />
  </div>;
}
