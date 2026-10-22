"use client";

import { useId, useMemo, useState } from "react";
import type { ShotPoint } from "../../types/analysis";
import { shotPosition } from "../../lib/footballDisplay";

const outcome = (point: ShotPoint) => point.is_goal || point.result === 3 ? "득점" : point.result === 1 ? "유효 슈팅" : point.result === 2 ? "골문 밖 슈팅" : "슈팅";
const shooter = (point: ShotPoint) => `${point.player_name || "선수 정보 미제공"}${point.sp_grade ? ` +${point.sp_grade}` : ""}`;

export function InteractiveShotMap({ points }: { points: ShotPoint[] }) {
  const [fullPitch, setFullPitch] = useState(false);
  const [active, setActive] = useState<{ index: number; pinned: boolean } | null>(null);
  const tooltipId = useId();
  const visible = useMemo(() => points.filter(point => shotPosition(point, fullPitch).visible), [points, fullPitch]);
  const positions = useMemo(() => visible.map(point => shotPosition(point)), [visible]);
  const ownHalf = useMemo(() => points.filter(point => point.x < .5).length, [points]);
  const height = fullPitch ? 352 : 202;
  const selected = active ? visible[active.index] : undefined;
  const shotLabel = (point: ShotPoint) => `${shooter(point)} · ${outcome(point)}${point.minute != null ? ` · ${Math.floor(point.minute)}분` : ""}`;
  function nearestShot(svg: SVGSVGElement, clientX: number, clientY: number) {
    const bounds = svg.getBoundingClientRect();
    let best: number | null = null, distance = 22 ** 2;
    positions.forEach((point, index) => {
      const squared = (bounds.left + point.x / 240 * bounds.width - clientX) ** 2 + (bounds.top + point.y / height * bounds.height - clientY) ** 2;
      if (squared < distance) { best = index; distance = squared; }
    });
    return best;
  }
  return <section className="shot-location-map">
    <div className="shot-map-heading"><h6>슈팅 위치 <span>{visible.length}회</span></h6>
      {ownHalf > 0 && <button type="button" className="link-like" onClick={() => { setFullPitch(value => !value); setActive(null); }}>{fullPitch ? "공격 진영 보기" : `전체 보기 · 하프라인 뒤 ${ownHalf}회`}</button>}
    </div>
    <div className="shot-map-canvas">
      <svg viewBox={`0 0 240 ${height}`} onPointerMove={event => {
        if (event.pointerType !== "mouse") return;
        const index = nearestShot(event.currentTarget, event.clientX, event.clientY);
        setActive(current => index === null ? current?.pinned ? current : null : current?.index === index ? current : { index, pinned: false });
      }} onPointerLeave={() => setActive(current => current?.pinned ? current : null)} onClick={event => {
        const index = nearestShot(event.currentTarget, event.clientX, event.clientY);
        setActive(current => index === null || current?.index === index && current.pinned ? null : { index, pinned: true });
      }} role="group" aria-label={`${fullPitch ? "전체 경기장" : "공격 진영"} 슈팅 ${visible.length}회. 슈팅을 선택하면 선수를 확인합니다.`}>
        <rect x="18" y="18" width="204" height={fullPitch ? 316 : 158} rx="3" fill="#e8f4ed" stroke="#92b6a1" />
        <path d="M59 18 V68 H181 V18 M92 18 V35 H148 V18 M109 18 V12 H131 V18 M94 68 A29 29 0 0 0 146 68 M18 176 H222" fill="none" stroke="#92b6a1" />
        {fullPitch ? <><circle cx="120" cy="176" r="27" fill="none" stroke="#92b6a1" /><path d="M59 334 V284 H181 V334 M92 334 V317 H148 V334" fill="none" stroke="#92b6a1" /></> : <path d="M93 176 A27 27 0 0 1 147 176" fill="none" stroke="#92b6a1" />}
        {visible.map((point, index) => {
          const position = positions[index], result = outcome(point), goal = result === "득점";
          const label = `${shooter(point)} · ${result}${point.minute != null ? ` · ${Math.floor(point.minute)}분` : ""}`;
          return <g key={`${point.match_id ?? point.date}:${index}`} role="button" tabIndex={0} aria-label={label} aria-pressed={active?.index === index} aria-describedby={active?.index === index ? tooltipId : undefined}
            className="interactive-shot-dot"
            onFocus={() => setActive({ index, pinned: false })} onBlur={() => setActive(current => current?.pinned ? current : null)}
            onKeyDown={event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); setActive({ index, pinned: true }); } else if (event.key === "Escape") setActive(null); }}>
            <circle cx={position.x} cy={position.y} r="9" fill="transparent" />
            <circle cx={position.x} cy={position.y} r={goal ? 4 : 3.2} pointerEvents="none"
              fill={goal ? "#177452" : result === "골문 밖 슈팅" ? "#fff7e6" : "#2563eb"} stroke={active?.index === index ? "#142b49" : goal ? "#0e523a" : result === "골문 밖 슈팅" ? "#b46b13" : "#174eae"} strokeWidth={active?.index === index ? 2 : 1.1} />
          </g>;
        })}
      </svg>
    </div>
    {!!visible.length && <div className="shot-selection-controls"><label>슈팅 선택<select aria-label="슈팅 선택" value={active?.index ?? ""} onChange={event => setActive(event.target.value === "" ? null : { index: Number(event.target.value), pinned: true })}>
      <option value="">선수·시간으로 찾기</option>{visible.map((point, index) => <option key={index} value={index}>{index + 1}. {shotLabel(point)}</option>)}
    </select></label><button type="button" aria-label="이전 슈팅" disabled={!visible.length} onClick={() => setActive({ index: ((active?.index ?? 0) - 1 + visible.length) % visible.length, pinned: true })}>‹</button><button type="button" aria-label="다음 슈팅" disabled={!visible.length} onClick={() => setActive({ index: ((active?.index ?? -1) + 1) % visible.length, pinned: true })}>›</button></div>}
    {selected && <div role="region" aria-label="선택한 슈팅 정보" className="shot-event-tooltip">
      <div id={tooltipId}><strong>{shooter(selected)}</strong><span>{outcome(selected)}{selected.minute != null ? ` · ${Math.floor(selected.minute)}분` : ""}</span>
      {selected.date && <small>{new Date(selected.date).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 경기</small>}</div>
      <button type="button" aria-label="슈팅 정보 닫기" onClick={() => setActive(null)}>×</button>
    </div>}
    <div className="passing-chart-legend"><span><i className="goal" />득점</span><span><i className="blue" />유효 슈팅</span><span><i className="amber" />골문 밖 슈팅</span></div>
  </section>;
}
