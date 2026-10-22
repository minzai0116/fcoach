"use client";

import type { PositionCoaching } from "../../types/coaching";
import { PlayerCoachingSummary } from "./PlayerCoachingSummary";
import { FeedPlanCard } from "./FeedPlanCard";

const PASS_ACTIONS: Record<string, string> = {
  short: "받는 선수 앞에 수비수가 있으면 직선 패스를 강행하지 말고 옆이나 뒤의 동료에게 연결한 뒤 다시 전진하세요.",
  long: "받는 선수 주변에 공간과 지원 선수가 있을 때 긴 패스로 전환하세요. 경합으로 보내는 공은 가까운 연결로 바꿔 보세요.",
  through: "침투하는 선수와 수비수 사이의 패스 경로가 열렸을 때 보내세요. 막힌 경로에서는 가까운 패스로 공격을 이어가세요.",
  lobbed_through: "수비 뒷공간이 열리고 받는 선수가 먼저 출발했을 때 사용하세요. 골키퍼가 나올 수 있는 공은 짧게 연결하세요.",
};

export function PrescriptionPanel({ coaching, onOpenAnalysis }: { coaching?: PositionCoaching | null; onOpenAnalysis: () => void }) {
  if (!coaching) return <article className="panel"><p>먼저 검색/설정에서 경기 진단을 실행하세요.</p></article>;
  const feed = coaching.squad_feed?.status === "available" ? coaching.squad_feed : undefined;
  const linked = new Map(feed?.comparisons.filter(p => p.linked).map(p => [`${p.sp_id}:${p.sp_grade}:${p.position_name}`, p.guidance]));
  const candidates = coaching.players.filter(p => p.position_name !== "GK").map(player => ({ ...player,
    guidance: linked.get(`${player.sp_id}:${player.sp_grade}:${player.position_name}`) ?? player.guidance,
  })).sort((a, b) => (b.guidance?.improvements.length ?? 0) - (a.guidance?.improvements.length ?? 0) || b.appearances - a.appearances);
  const groups = [new Set(["ST", "LS", "RS", "CF", "LF", "RF", "LW", "RW"]),
    new Set(["CAM", "LAM", "RAM", "LM", "RM", "CM", "LCM", "RCM", "CDM", "LDM", "RDM"]),
    new Set(["LB", "RB", "LCB", "RCB", "CB", "LWB", "RWB", "SW"])];
  const players = groups.flatMap(group => { const player = candidates.find(p => group.has(p.position_name) && p.guidance?.recommendations.length); return player ? [player] : []; });
  const passingTypes = coaching.passing?.types.filter(p => p.status === "sufficient" && p.failures > 0) ?? [];
  const firstPriority = coaching.passing?.priorities[0]?.metric;
  const passing = passingTypes.find(p => p.metric === firstPriority) ?? passingTypes.reduce<typeof passingTypes[number] | undefined>((best, p) =>
    !best || (p.failure_share ?? 0) - (p.usage_share ?? 0) > (best.failure_share ?? 0) - (best.usage_share ?? 0) ? p : best, undefined);
  return <article className="panel prescription-panel">
    <div className="coaching-section-heading"><div><h3 className="section-title">바로 적용할 전술·플레이 제안</h3><p>확인된 기록에 맞춰 바꿀 행동을 제안합니다. 이전 경기 대비 상승·하락이 확인된 항목은 따로 표시합니다.</p></div><button type="button" className="btn secondary" onClick={onOpenAnalysis}>선수별 상세 분석</button></div>
    {!!feed?.team_plans?.length && feed.team_plans.map(plan => <FeedPlanCard key={plan.id} plan={plan} />)}
    {passing && <section className="prescription-team-action"><span className="guidance-kind">팀 플레이</span><h4>{passing.label} 선택 · 받는 선수의 공간부터 확보</h4><p>{PASS_ACTIONS[passing.metric] ?? "받는 선수 주변의 압박과 패스 경로를 확인하세요. 지원 선수가 없으면 가까운 동료를 통해 공격 방향을 바꾸세요."}</p><small>{passing.success}/{passing.trials}회 성공 ({((passing.success_rate ?? 0) * 100).toFixed(1)}%) · 실패 {passing.failures}회 · 사용 비중 {((passing.usage_share ?? 0) * 100).toFixed(1)}% · 전체 실패 중 {((passing.failure_share ?? 0) * 100).toFixed(1)}%</small></section>}
    <div className="prescription-player-grid">{players.map(player => <section key={`${player.sp_id}:${player.position_name}`}><h4>{player.position_name} · {player.player_name}</h4><PlayerCoachingSummary guidance={player.guidance} /></section>)}</div>
    {!players.length && !passing && <p>선택한 경기에서 연결할 선수·패스 기록이 없습니다. 분석 범위를 확인하세요.</p>}
  </article>;
}
