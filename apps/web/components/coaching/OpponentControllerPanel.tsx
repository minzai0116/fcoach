"use client";

import { useState } from "react";
import type { OpponentControllerComparison } from "../../types/analysis";
import { MATCH_LABELS } from "../../lib/uiConstants";

const DEVICES = ["keyboard", "gamepad"] as const;
const METRICS = [
  { key: "goals_for", label: "경기당 득점", unit: "골" },
  { key: "goals_against", label: "경기당 실점", unit: "골" },
  { key: "on_target", label: "유효 슈팅 비율", unit: "%" },
  { key: "pass", label: "패스 성공률", unit: "%" },
  { key: "tackle", label: "태클 성공률", unit: "%" },
] as const;

export function OpponentControllerPanel({ comparisons }: { comparisons?: OpponentControllerComparison[] }) {
  const [mode, setMode] = useState<number | null>(null);
  const data = comparisons?.find(entry => entry.match_type === mode) ?? comparisons?.[0];
  if (!data) return null;
  const knownMatches = data.keyboard.matches + data.gamepad.matches;
  return <article className="panel span-3 opponent-controller-panel">
    <header className="coaching-section-heading">
      <h3 className="section-title">컨트롤러별 경기 기록</h3>
      <label className="shot-type-filter">경기 유형<select value={data.match_type} onChange={event => setMode(Number(event.target.value))}>
        {comparisons?.map(entry => <option key={entry.match_type} value={entry.match_type}>{MATCH_LABELS[entry.match_type]}</option>)}
      </select></label>
    </header>
    {knownMatches ? <>
      <div className="opponent-controller-table">
        <table aria-label="키보드 상대와 패드 상대를 만났을 때의 내 경기 기록"><thead><tr>
          <th scope="col">내 기록</th><th scope="col"><span aria-hidden="true">⌨️ </span>키보드 상대<small>{data.keyboard.matches}경기</small></th>
          <th scope="col"><span aria-hidden="true">🎮 </span>패드 상대<small>{data.gamepad.matches}경기</small></th>
        </tr></thead><tbody>
          <tr><th scope="row">승률</th>{DEVICES.map(device => {
            const { win_rate, wins, draws, losses } = data[device];
            return <td key={device}>{win_rate == null ? "—" : <><strong>{(win_rate * 100).toFixed(1)}%</strong><small>{wins}승 {draws}무 {losses}패</small></>}</td>;
          })}</tr>
          {METRICS.map(({ key, label, unit }) => <tr key={key}><th scope="row">{label}</th>{DEVICES.map(device => {
            const sample = data[device][key];
            return <td key={device}>{sample.value == null ? "—" : <>
              <strong>{(sample.value * (unit === "%" ? 100 : 1)).toFixed(1)}{unit}</strong>
              <small>{sample.matches}경기{"trials" in sample && <> · <span>{sample.success}/{sample.trials}회</span></>}</small>
            </>}</td>;
          })}</tr>)}
        </tbody></table>
      </div>
      {(!data.keyboard.matches || !data.gamepad.matches) && <p className="muted compact">한쪽 컨트롤러 상대와의 경기만 있습니다.</p>}
      <p className="muted compact">승률은 몰수 결과를 포함합니다. 득점·실점은 정상 종료 경기 기준이며, 성공률은 중단 전 유효 기록도 포함합니다. 상대 수준과 표본 수에 따라 결과가 달라질 수 있습니다.</p>
    </> : <p className="muted compact">상대 컨트롤러가 기록된 경기가 없습니다.</p>}
    {data.unknown_matches > 0 && <p className="muted compact">상대 컨트롤러 미확인 {data.unknown_matches}경기 제외</p>}
  </article>;
}
