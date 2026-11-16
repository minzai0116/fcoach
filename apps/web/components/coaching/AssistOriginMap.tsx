"use client";

import { useMemo, useState } from "react";
import type { ShotPoint } from "../../types/analysis";
import { SHOT_MAP_ZONES, summarizeAssistOrigins } from "../../lib/shotZones";
import { ShotPitchLines } from "./ShotPitchLines";

export function AssistOriginMap({ points }: { points: ShotPoint[] }) {
  const zones = useMemo(() => summarizeAssistOrigins(points), [points]);
  const [selected, setSelected] = useState<string>();
  const active = zones.find(zone => zone.label === selected) ?? zones[0];
  const counts = new Map(zones.map(zone => [zone.label, zone.count]));
  const total = zones.reduce((sum, zone) => sum + zone.count, 0);
  return <section className="zone-card assist-origin-map" aria-label="도움 패스 출발 구역 분포">
    <h4 className="action-title">도움 패스 출발 구역 분포</h4>
    {active ? <>
      <p className="muted compact">출발 좌표가 있는 도움 {total}회 · 공격 방향 ↑</p>
      <svg viewBox="0 0 240 352" role="group" aria-label="도움 패스 출발 위치 지도. 구역을 선택하면 횟수와 비중을 볼 수 있습니다.">
        <ShotPitchLines fullPitch />
        {SHOT_MAP_ZONES.map(({ label, shape, x, y }) => {
          const count = counts.get(label);
          if (!count) return null;
          const isActive = active.label === label;
          return <g key={label} role="button" tabIndex={0} aria-label={`${label} 도움 ${count}회`} aria-pressed={isActive}
            className="assist-origin-zone" onClick={() => setSelected(label)} onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(label); }
            }}>
            <path d={shape} fill="#6942a2" fillOpacity={.14 + .66 * count / zones[0].count} stroke={isActive ? "#4a266f" : "none"} />
            <rect x={x - 10} y={y - 7} width="20" height="14" rx="5" fill={isActive ? "#4a266f" : "#61408d"} pointerEvents="none" />
            <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize="8" fontWeight="700" pointerEvents="none">{count}</text>
          </g>;
        })}
      </svg>
      <div className="assist-origin-selection" aria-live="polite"><strong>{active.label}</strong><span>{active.count}회 · {(active.ratio * 100).toFixed(1)}%</span></div>
    </> : <p className="muted compact">확인된 도움 좌표가 없습니다.</p>}
  </section>;
}
