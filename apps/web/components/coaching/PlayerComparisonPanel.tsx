"use client";
import { useMemo, useState } from "react";
import type { PositionPlayer } from "../../types/coaching";
import { positionPlayerKey } from "../../types/coaching";
import type { PlayerReportEntry } from "../../types/analysis";
import { pairPlayerMetrics } from "../../lib/playerComparison";
import { PlayerPortrait } from "../player/PlayerPortrait";
import { OfficialPlayerBadges } from "../player/OfficialPlayerBadges";
import { MetricComparisonCards } from "./MetricComparisonCards";

export function PlayerComparisonPanel({ players, reports = [] }: { players: PositionPlayer[]; reports?: PlayerReportEntry[] }) {
  const [leftKey, setLeft] = useState("");
  const [rightKey, setRight] = useState("");
  const [category, setCategory] = useState("attack");
  const ordered = useMemo(() => players.map(player => ({ player, goals: player.observations?.find(item => item.metric === "goals")?.total ?? 0 }))
    .sort((a, b) => b.goals - a.goals || b.player.appearances - a.player.appearances).map(item => item.player), [players]);
  const left = players.find(player => positionPlayerKey(player) === leftKey) ?? ordered[0];
  const right = players.find(player => positionPlayerKey(player) === rightKey && positionPlayerKey(player) !== positionPlayerKey(left))
    ?? ordered.find(player => player.sp_id !== left?.sp_id) ?? ordered.find(player => player !== left);
  if (!left || !right) return <p>비교할 선수 기록이 두 개 이상 필요합니다.</p>;
  const categories = [
    { id: "attack", label: "공격", keys: ["goals", "assists", "shot", "finishing", "rating"] },
    { id: "passing", label: "패스·드리블", keys: ["pass", "dribble", "ball_possession", "dribble_distance"] },
    { id: "defense", label: "수비·경합", keys: ["tackle", "block", "aerial", "intercept", "defending_actions", "yellow_cards", "red_cards"] },
    { id: "all", label: "전체", keys: [] },
  ];
  const keys = categories.find(item => item.id === category)!.keys;
  const sides = [{ player: left, set: setLeft, other: right, title: "첫 번째 선수" }, { player: right, set: setRight, other: left, title: "두 번째 선수" }];
  return <section className="player-comparison" aria-label="우리 팀 선수 비교"><h4>선수 비교</h4>
    <div className="player-compare-selectors">{sides.map(({ player, set, other, title }) => {
      const report = reports.find(item => item.sp_id === player.sp_id && item.sp_grade === player.sp_grade);
      return <div className="player-compare-identity" key={title}><label>{title}<select aria-label={title} value={positionPlayerKey(player)} onChange={event => set(event.target.value)}>{ordered.map(option => <option key={positionPlayerKey(option)} value={positionPlayerKey(option)} disabled={positionPlayerKey(option) === positionPlayerKey(other)}>{option.player_name} · {option.season_name} +{option.sp_grade} · {option.position_name}</option>)}</select></label>
        <div><PlayerPortrait player={report ?? player} alt="" className="player-compare-face" /><div><strong>{player.player_name}</strong><OfficialPlayerBadges seasonImg={report?.season_img} seasonName={player.season_name} grade={player.sp_grade} /><small>{player.position_name} · {player.appearances}경기 출전</small></div></div>
      </div>;
    })}</div>
    <nav className="comparison-domain-nav" aria-label="선수 비교 지표">{categories.map(item => <button key={item.id} type="button" aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.label}</button>)}</nav>
    <MetricComparisonCards mineLabel={left.player_name} referenceLabel={right.player_name} tone="purple" showTotals metrics={pairPlayerMetrics(left, right).filter(pair => category === "all" || keys.includes((pair.mine ?? pair.reference)!.id))} />
  </section>;
}
