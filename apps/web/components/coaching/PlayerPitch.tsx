"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PositionCoaching } from "../../types/coaching";
import type { PlayerReportEntry } from "../../types/analysis";
import { buildPitchLineup, feedPortraits, layoutPitchPlayers, lineupKey, pitchPositionOptions, selectedPitchLineup, type PitchPlayer } from "../../lib/pitchLineup";
import { PitchPlayerAppearance } from "./PitchPlayerAppearance";
import { OfficialPlayerBadges } from "../player/OfficialPlayerBadges";
import { PlayerDetailPanel } from "./PlayerDetailPanel";
import { layoutPitchCards, type PitchCardLayout } from "../../lib/pitchCardLayout";
import { feedTraitResolver, newPlayerTraits } from "../../lib/playerTraits";
import { ShareImageButton } from "../share/ShareImageButton";

function playerState(player: PitchPlayer) {
  if (!player.record) return { label: "이 자리 기록 없음", tone: "empty" };
  if (player.comparison?.plans?.some(p => p.status === "priority" || p.status === "review") || player.record.findings.length)
    return { label: "교정 후보", tone: "review" };
  return { label: "기록 확인", tone: "observe" };
}

export function PlayerPitch({ coaching, reportPlayers = [], nickname = "" }: { coaching: PositionCoaching; reportPlayers?: PlayerReportEntry[]; nickname?: string }) {
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [showPlayerOptions, setShowPlayerOptions] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mobileDetails, setMobileDetails] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const pitchRef = useRef<HTMLDivElement>(null);
  const [cardLayout, setCardLayout] = useState<PitchCardLayout | null>(null);
  const detailId = useId();
  const optionsId = useId();
  const feed = coaching.squad_feed?.status === "available" ? coaching.squad_feed : undefined;
  const feedImages = useMemo(() => feedPortraits(feed), [feed]);
  const resolveTraits = useMemo(() => feedTraitResolver(feed), [feed]);
  const latestLineup = useMemo(() => buildPitchLineup(coaching, "match").map(player => ({ ...player,
    traitSource: player.settings ?? resolveTraits(player.spId, player.grade),
    portraitImage: player.settings?.portrait_img || feedImages.get(player.spId) || feedImages.get(player.spId % 1_000_000) })), [coaching, feedImages, resolveTraits]);
  const portraits = useMemo(() => new Map(reportPlayers.map(p => [`${p.sp_id}:${p.sp_grade}`, p])), [reportPlayers]);
  const records = useMemo(() => {
    const all = new Map(latestLineup.map(p => [p.key, p]));
    const comparisons = new Map(feed?.comparisons.map(p => [lineupKey(p.sp_id, p.sp_grade, p.position_name), p]));
    coaching.players.forEach(record => {
      const key = lineupKey(record.sp_id, record.sp_grade, record.position_name);
      if (all.has(key)) return;
      const comparison = comparisons.get(key);
      all.set(key, { key, spId: record.sp_id, grade: record.sp_grade, position: record.position_name, name: record.player_name,
        record, comparison, settings: comparison?.linked ? comparison.settings ?? undefined : undefined,
        traitSource: (comparison?.linked ? comparison.settings ?? undefined : undefined) ?? resolveTraits(record.sp_id, record.sp_grade),
        portraitImage: (comparison?.linked ? comparison.settings?.portrait_img : undefined) || feedImages.get(record.sp_id) || feedImages.get(record.sp_id % 1_000_000) });
    });
    return all;
  }, [coaching.players, feed, feedImages, latestLineup, resolveTraits]);
  const lineup = useMemo(() => selectedPitchLineup(latestLineup, records, replacements), [latestLineup, records, replacements]);
  const nodes = useMemo(() => layoutPitchPlayers(lineup), [lineup]);
  const positionOptions = useMemo(() => pitchPositionOptions(records.values(), latestLineup), [records, latestLineup]);
  const defaultPlayer = lineup.find(p => p.comparison?.plans?.some(plan => plan.status === "priority" || plan.status === "review")) ?? lineup[0] ?? records.values().next().value;
  const selected = selectedKey ? records.get(selectedKey) ?? defaultPlayer : defaultPlayer;
  const pitchPositions = new Set(latestLineup.map(player => player.position));
  const otherRecords = [...records.values()].filter(player => !pitchPositions.has(player.position));
  const badges = (player: PitchPlayer) => <OfficialPlayerBadges seasonImg={portraits.get(`${player.spId}:${player.grade}`)?.season_img || player.settings?.season_img} seasonName={player.record?.season_name || player.settings?.season_code} grade={player.grade} />;
  function selectPlayer(player: PitchPlayer) { setSelectedKey(player.key); }
  useLayoutEffect(() => {
    const field = pitchRef.current;
    if (!field) return;
    const update = () => {
      const bounds = field.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      setCardLayout(layoutPitchCards(nodes, bounds.width, bounds.height, window.innerWidth <= 900,
        nodes.some(player => newPlayerTraits(player.traitSource ?? player.settings).length > 0)));
    };
    update();
    const observer = new ResizeObserver(update);
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
      <div className="pitch-controls">
      <div className="coaching-section-heading"><div><h4>포메이션</h4></div>
        <span className="pitch-registration">최근 경기 등록 포지션</span>
        <div className="pitch-toolbar">
        {!!lineup.length && <ShareImageButton input={{kind: "squad", nickname: feed?.snapshot.author || nickname, period: "", matches: 0, players: feed ? buildPitchLineup(coaching, "feed") : lineup, reports: reportPlayers, feed: feed?.snapshot}} label="스쿼드 저장" />}
        {!!positionOptions.length && <button type="button" className="pitch-change-button" aria-expanded={showPlayerOptions} aria-controls={optionsId} onClick={() => setShowPlayerOptions(value => !value)}>선수 변경 · {positionOptions.length}개 자리</button>}
        {!!otherRecords.length && <details className="pitch-other-records"><summary>다른 자리 기록 {otherRecords.length}</summary><div className="pitch-other-popover"><div className="pitch-other-players">{otherRecords.map(player => <button key={player.key} type="button" aria-pressed={selected?.key === player.key} aria-controls={detailId} onClick={event => { selectPlayer(player); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{player.position} · {player.name} +{player.grade}</button>)}</div></div></details>}
        </div>
      </div>
      {showPlayerOptions && <div className="pitch-lineup-options" id={optionsId}>
        <div className="pitch-position-options">{positionOptions.map(([position, players]) => <label key={position}><span>{position}</span><select aria-label={`${position} 출전 선수`} value={lineup.find(player => player.position === position)?.key} onChange={event => { setReplacements(current => ({ ...current, [position]: event.target.value })); setSelectedKey(event.target.value); setMobileDetails(false); setShowPlayerOptions(false); }}>
          {players.map(player => <option key={player.key} value={player.key}>{player.name} · {player.record?.season_name} +{player.grade} · {player.record?.appearances}경기</option>)}
        </select></label>)}</div>
        <button type="button" className="pitch-reset-button" disabled={!Object.keys(replacements).length} onClick={() => { setReplacements({}); setSelectedKey(null); }}>최근 경기 선수로 되돌리기</button>
      </div>}
      </div>
      {!coaching.latest_lineup && <p>최근 경기 선수 배치를 불러오려면 다시 분석해주세요.</p>}
      <div className="pitch-fit-area" role="region" aria-label="포메이션 경기장">
      <div className="player-pitch" ref={pitchRef} data-compact={cardLayout?.compact} style={cardLayout ? { "--pitch-card-width": `${cardLayout.cardWidth}px`, "--pitch-face": `${cardLayout.photoSize}px`, "--pitch-font": `${cardLayout.fontSize}px`, "--pitch-badge-height": `${cardLayout.badgeHeight}px`, "--pitch-card-height": `${cardLayout.cardHeight}px`, "--pitch-trait-height": `${cardLayout.traitHeight}px` } as React.CSSProperties : undefined} role="group" aria-label="최근 경기 등록 포지션 선수 배치">
        <div className="player-pitch-markings" aria-hidden="true"><i className="pitch-half" /><i className="pitch-circle" /><i className="pitch-area north" /><i className="pitch-area south" /><i className="pitch-goal north" /><i className="pitch-goal south" /></div>
        <div className="player-pitch-players">{nodes.map(player => {
          const state = playerState(player);
          const card = cardLayout?.positions[player.key];
          return <button type="button" className={`pitch-player tone-${state.tone}`} data-player-key={player.key} data-position-source={player.exact ? "saved" : "role"} data-pitch-role={player.position} key={player.key} title={`${player.position} · ${player.name}`} style={card ? { left: `${card.x}px`, top: `${card.y}px` } : { left: `${player.left}%`, top: `${player.top}%` }}
            aria-label={`${player.position} ${player.name} +${player.grade ?? "?"} · ${state.label} · 상세 보기`} aria-pressed={selected?.key === player.key} aria-controls={detailId} onClick={() => selectPlayer(player)}>
            <PitchPlayerAppearance player={player} report={portraits.get(`${player.spId}:${player.grade}`)} />
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
