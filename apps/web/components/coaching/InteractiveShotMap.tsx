"use client";

import { useId, useMemo, useState } from "react";
import type { ShotPoint } from "../../types/analysis";
import { shotTypeLabel, filterShotsByType, filterShotsByPlayer, shotPlayerKey } from "../../lib/shotTypes";
import { shotPosition } from "../../lib/footballDisplay";
import { placeShotMapLabels } from "../../lib/shotMapLabels";
import { PITCH_BOX, PITCH_BOX_DEPTH_LINE, PITCH_BOX_LANE_LINES, PITCH_LANE_LINES, SHOT_MAP_ZONES, groupShotsByZone, shotZoneLabel, summarizeShotZones } from "../../lib/shotZones";

const outcome = (point: ShotPoint) => point.is_goal || point.result === 3 ? "득점" : point.result === 1 ? "유효 슈팅" : point.result === 2 ? "골문 밖 슈팅" : "슈팅";
const shooter = (point: ShotPoint) => `${point.player_name || "선수 정보 미제공"}${point.sp_grade ? ` +${point.sp_grade}` : ""}`;
const shotColor = (point: ShotPoint) => outcome(point) === "득점" ? "#177452" : point.result === 2 ? "#fff7e6" : "#2563eb";

function ShotZoneSummary({ zones, selectedZone }: { zones: ReturnType<typeof summarizeShotZones>; selectedZone?: string }) {
  if (!zones.length) return null;
  return <div className="shot-zone-summary">
    <div><h6>구역별 슈팅</h6><small>미득점 많은 순</small></div>
    <table aria-label="구역별 슈팅 결과"><thead><tr>
      <th scope="col">구역</th><th scope="col">시도</th><th scope="col">미득점</th><th scope="col">골문 밖</th><th scope="col">득점 전환율</th>
    </tr></thead><tbody>{zones.map(zone => <tr key={zone.label} className={selectedZone === zone.label ? "selected-zone" : undefined}>
      <th scope="row">{zone.label}</th><td>{zone.attempts}</td><td>{zone.attempts - zone.goals}</td>
      <td>{zone.offTarget}</td><td><strong>{(zone.goals / zone.attempts * 100).toFixed(1)}%</strong><small>{zone.goals}/{zone.attempts}</small></td>
    </tr>)}</tbody></table>
  </div>;
}

export function InteractiveShotMap({ points }: { points: ShotPoint[] }) {
  const [fullPitch, setFullPitch] = useState(false);
  const [shotType, setShotType] = useState("all");
  const [player, setPlayer] = useState("all");
  const [active, setActive] = useState<{ zone: string; shot: number } | null>(null);
  const tooltipId = useId();
  const basePoints = useMemo(() => points.filter(point => shotPosition(point, fullPitch).visible), [points, fullPitch]);
  const players = useMemo(() => {
    const result = new Map<string, { name: string; count: number }>();
    basePoints.forEach(point => { const key = shotPlayerKey(point), found = result.get(key); result.set(key, { name: point.player_name || "선수 정보 미제공", count: (found?.count ?? 0) + 1 }); });
    return [...result].sort((a, b) => b[1].count - a[1].count);
  }, [basePoints]);
  const playerPoints = useMemo(() => filterShotsByPlayer(basePoints, player), [basePoints, player]);
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    playerPoints.forEach(point => { const key = point.type == null ? "unknown" : String(point.type); counts.set(key, (counts.get(key) ?? 0) + 1); });
    return [...counts].sort(([a], [b]) => a === "unknown" ? 1 : b === "unknown" ? -1 : Number(a) - Number(b));
  }, [playerPoints]);
  const visible = useMemo(() => filterShotsByType(playerPoints, shotType), [playerPoints, shotType]);
  const zoneShots = useMemo(() => groupShotsByZone(visible), [visible]);
  const zones = useMemo(() => summarizeShotZones(visible), [visible]);
  const ownHalf = useMemo(() => points.filter(point => point.x < .5).length, [points]);
  const selectedShots = active ? zoneShots.get(active.zone) : undefined;
  const selected = active ? selectedShots?.[active.shot] : undefined;
  const assist = selected && outcome(selected) === "득점" ? selected.assist : undefined;
  const showFullPitch = fullPitch || (assist !== undefined && assist.x < .5);
  const height = showFullPitch ? 352 : 202;
  const assistOrigin = assist ? shotPosition(assist, showFullPitch) : null;
  const selectedPosition = selected ? shotPosition(selected, showFullPitch) : null;
  const sceneLabels = placeShotMapLabels([
    ...(selected?.player_name && selectedPosition ? [{ point: selectedPosition, role: outcome(selected) === "득점" ? "득점" : "슈팅", name: selected.player_name }] : []),
    ...(assist?.player_name && assistOrigin ? [{ point: assistOrigin, role: "도움", name: assist.player_name }] : []),
  ], showFullPitch ? 334 : 176, SHOT_MAP_ZONES.filter(({ y }) => y < 176 || showFullPitch)
    .map(({ x, y, label }) => zoneShots.has(label)
      ? { x: x - 11, y: y - 8, width: 22, height: 16 }
      : { x: x - 4, y: y - 5, width: 8, height: 10 }));
  const arrowId = `${tooltipId}-assist`;
  const chooseZone = (zone: string) => setActive(current => current?.zone === zone ? current : { zone, shot: 0 });
  return <section className="shot-location-map">
    <div className="shot-map-heading"><h6>슈팅 위치 <span>{visible.length}회</span></h6>
      {ownHalf > 0 && <button type="button" className="link-like" onClick={() => { setFullPitch(value => !value); setShotType("all"); setPlayer("all"); setActive(null); }}>{fullPitch ? "공격 진영 보기" : `전체 보기 · 하프라인 뒤 ${ownHalf}회`}</button>}
    </div>
    <div className="shot-map-filters"><label className="shot-type-filter">선수<select aria-label="슈팅 선수별 보기" value={player} onChange={event => { setPlayer(event.target.value); setShotType("all"); setActive(null); }}><option value="all">전체 선수 · {basePoints.length}회</option>{players.map(([key, item]) => <option key={key} value={key}>{item.name} · {item.count}회</option>)}</select></label>
    <label className="shot-type-filter">슈팅 유형<select aria-label="슈팅 유형별 보기" value={shotType} onChange={event => { setShotType(event.target.value); setActive(null); }}><option value="all">전체 유형 · {playerPoints.length}회</option>{typeCounts.map(([key, count]) => <option key={key} value={key}>{shotTypeLabel(key === "unknown" ? null : Number(key))} · {count}회</option>)}</select></label></div>
    <div className="shot-map-canvas">
      <svg viewBox={`0 0 240 ${height}`} role="group" aria-label={`${showFullPitch ? "전체 경기장" : "공격 진영"} 슈팅 ${visible.length}회. 구역을 선택하면 슈팅 기록을 볼 수 있습니다.`}>
        <rect x="18" y="18" width="204" height={showFullPitch ? 316 : 158} rx="3" fill="#e8f4ed" stroke="#92b6a1" />
        <path d={`M${PITCH_BOX.left} 18 V${PITCH_BOX.bottom} H${PITCH_BOX.right} V18 M92 18 V35 H148 V18 M109 18 V12 H131 V18 M94 68 A29 29 0 0 0 146 68 M18 176 H222`} fill="none" stroke="#92b6a1" />
        {PITCH_LANE_LINES.map(x => <line key={x} x1={x} x2={x} y1={PITCH_BOX.bottom} y2="176" stroke="#92b6a1" strokeDasharray="3 4" />)}
        {PITCH_BOX_LANE_LINES.map(x => <line key={x} x1={x} x2={x} y1="18" y2={PITCH_BOX.bottom} stroke="#92b6a1" strokeDasharray="3 3" />)}
        <line x1={PITCH_BOX.left} x2={PITCH_BOX.right} y1={PITCH_BOX_DEPTH_LINE} y2={PITCH_BOX_DEPTH_LINE} stroke="#92b6a1" strokeDasharray="3 3" />
        {showFullPitch ? <><circle cx="120" cy="176" r="27" fill="none" stroke="#92b6a1" /><path d="M59 334 V284 H181 V334 M92 334 V317 H148 V334" fill="none" stroke="#92b6a1" /></> : <path d="M93 176 A27 27 0 0 1 147 176" fill="none" stroke="#92b6a1" />}
        {SHOT_MAP_ZONES.map(({ label, x, y, shape }) => {
          if (y > 176 && !showFullPitch) return null;
          const count = zoneShots.get(label)?.length ?? 0;
          if (!count) return <text key={label} x={x} y={y} textAnchor="middle" dominantBaseline="central"
            fontSize="9" fill="#587263" pointerEvents="none" aria-hidden="true">0</text>;
          const selectedZone = active?.zone === label;
          return <g key={label} role="button" tabIndex={0} aria-label={`${label} 슈팅 ${count}회`} aria-pressed={selectedZone}
            aria-describedby={selectedZone && selected ? tooltipId : undefined}
            className="interactive-shot-zone"
            onClick={() => chooseZone(label)}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseZone(label); }
              if (event.key === "Escape") setActive(null);
            }}>
            <path d={shape} fill={selectedZone ? "#693cb1" : "transparent"} fillOpacity=".12" />
            <g opacity={selected && !selectedZone ? .55 : 1} pointerEvents="none">
              <rect x={x - 11} y={y - 8} width="22" height="16" rx="6" fill={selectedZone ? "#693cb1" : "#173c61"} />
              <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="9"
                fontWeight="700" fill="#fff">{count}</text>
            </g>
          </g>;
        })}
        {assistOrigin && selectedPosition && <g aria-label="도움 위치에서 슈팅 위치까지" pointerEvents="none">
          <defs><marker id={arrowId} markerWidth="4" markerHeight="4" refX="4" refY="2" orient="auto"><path d="M0 0 L4 2 L0 4 Z" fill="#693cb1" /></marker></defs>
          <line x1={assistOrigin.x} y1={assistOrigin.y} x2={selectedPosition.x} y2={selectedPosition.y} stroke="#fff" strokeWidth="3" />
          <line x1={assistOrigin.x} y1={assistOrigin.y} x2={selectedPosition.x} y2={selectedPosition.y} stroke="#693cb1" strokeWidth="1.5" strokeDasharray="3 3" strokeLinecap="round" markerEnd={`url(#${arrowId})`} />
          <circle cx={assistOrigin.x} cy={assistOrigin.y} r="6" fill="#693cb1" opacity=".18" />
          <circle cx={assistOrigin.x} cy={assistOrigin.y} r="3.5" fill="#693cb1" stroke="#fff" strokeWidth="1.2" />
        </g>}
        {selected && selectedPosition && <g pointerEvents="none">
          <circle cx={selectedPosition.x} cy={selectedPosition.y} r="7" fill={shotColor(selected)} opacity=".22" />
          <circle cx={selectedPosition.x} cy={selectedPosition.y} r="4.5"
            fill={shotColor(selected)} stroke="#fff" strokeWidth="1.4" />
        </g>}
        {sceneLabels.map(({ role, name, point, x, y, width, height }) => {
          const variant = role === "도움" ? "assist" : role === "득점" ? "goal" : "shot";
          const color = variant === "assist" ? "#693cb1" : variant === "goal" ? "#177452" : "#174a78";
          return <g key={role} pointerEvents="none" aria-label={`${role} ${name}`}>
            <line x1={point.x} y1={point.y} x2={Math.max(x, Math.min(x + width, point.x))}
              y2={Math.max(y, Math.min(y + height, point.y))} stroke={color} strokeWidth=".8" />
            <foreignObject x={x} y={y} width={width} height={height}>
              <div className={`shot-field-player ${variant}`}>
                <span className="shot-field-icon" aria-hidden="true">{variant === "assist" ? "↗" : ""}</span>
                <div className="shot-field-identity"><span>{role}</span><strong>{name}</strong></div>
              </div>
            </foreignObject>
          </g>;
        })}
      </svg>
    </div>
    {!visible.length && <p className="shot-empty">해당 조건의 슈팅 기록이 없습니다.</p>}
    {selected && <div role="region" aria-label="선택한 슈팅 정보" className="shot-event-tooltip">
      <div id={tooltipId}><strong>{shooter(selected)}</strong><span className="shot-type-label">{shotTypeLabel(selected.type)} · {shotZoneLabel(selected)}</span><span>{outcome(selected)}{selected.hit_post ? " · 골대 적중" : ""} · {selected.minute != null ? `${Math.floor(selected.minute)}분` : "시간 미제공"}</span>
      {assist && <span>도움{assist.player_name ? ` · ${assist.player_name}` : ""} · {shotZoneLabel(assist)} 출발</span>}
      {selected.date && <small>{new Date(selected.date).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 경기</small>}
      {active && selectedShots && selectedShots.length > 1 && <nav className="shot-group-nav" aria-label="구역 내 슈팅 보기">
        <button type="button" aria-label="이전 슈팅" disabled={active.shot === 0} onClick={() => setActive({ ...active, shot: active.shot - 1 })}>‹</button>
        <span aria-live="polite">{active.shot + 1} / {selectedShots.length}</span>
        <button type="button" aria-label="다음 슈팅" disabled={active.shot === selectedShots.length - 1} onClick={() => setActive({ ...active, shot: active.shot + 1 })}>›</button>
      </nav>}</div>
      <button type="button" aria-label="슈팅 정보 닫기" onClick={() => setActive(null)}>×</button>
    </div>}
    {visible.length > 0 && !selected && <p className="shot-group-hint">구역을 누르면 슈팅을 한 장면씩 볼 수 있습니다.</p>}
    <ShotZoneSummary zones={zones} selectedZone={selected ? shotZoneLabel(selected) : undefined} />
  </section>;
}
