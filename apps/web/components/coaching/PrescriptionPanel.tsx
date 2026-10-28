"use client";

import type { RankerCoaching } from "../../types/comparison";
import { RankerAdvicePanel } from "./RankerHighlights";
import type { PositionCoaching } from "../../types/coaching";
import { PlayerCoachingSummary } from "./PlayerCoachingSummary";
import { FeedPlanCard } from "./FeedPlanCard";

const PASS_ACTIONS: Record<string, string> = {
  short: "받는 선수 앞에 수비수가 있으면 직선 패스를 강행하지 말고 옆이나 뒤의 동료에게 연결한 뒤 다시 전진하세요.",
  long: "받는 선수 주변에 공간과 지원 선수가 있을 때 긴 패스로 전환하세요. 경합으로 보내는 공은 가까운 연결로 바꿔 보세요.",
  through: "침투하는 선수와 수비수 사이의 패스 경로가 열렸을 때 보내세요. 막힌 경로에서는 가까운 패스로 공격을 이어가세요.",
  lobbed_through: "수비 뒷공간이 열리고 받는 선수가 먼저 출발했을 때 사용하세요. 골키퍼가 나올 수 있는 공은 짧게 연결하세요.",
};

export function PrescriptionPanel({ coaching, onOpenAnalysis, rankerCoaching }: { coaching?: PositionCoaching | null; onOpenAnalysis: () => void; rankerCoaching?: RankerCoaching }) {
  if (!coaching) return <article className="panel"><p>먼저 경기 검색에서 경기 분석을 시작하세요.</p></article>;
  const feed = coaching.squad_feed?.status === "available" ? coaching.squad_feed : undefined;
  const linked = new Map(feed?.comparisons.filter(p => p.linked).map(p => [`${p.sp_id}:${p.sp_grade}:${p.position_name}`, p.guidance]));
  const candidates = rankerCoaching?.advice.length ? [] : coaching.players.filter(p => p.position_name !== "GK").map(player => ({ ...player,
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
    <div className="coaching-section-heading"><div><h2 className="section-title">맞춤 코칭</h2><p>최근 30경기와 랭커 평균의 차이, 선수별 실패 기록과 피드 설정을 함께 참고해 제안합니다.</p></div><button type="button" className="btn secondary" onClick={onOpenAnalysis}>선수 분석 보기</button></div>
    <RankerAdvicePanel data={rankerCoaching} />
    {!!feed?.team_plans?.length && feed.team_plans.map(plan => <FeedPlanCard key={plan.id} plan={plan} />)}
    {!rankerCoaching?.advice.length && passing && <section className="prescription-team-action"><span className="guidance-kind">팀 플레이</span><h4>{passing.label} 선택 · 받는 선수의 공간부터 확보</h4><p>{PASS_ACTIONS[passing.metric] ?? "받는 선수 주변의 압박과 패스 경로를 확인하세요. 지원 선수가 없으면 가까운 동료를 통해 공격 방향을 바꾸세요."}</p><small>{passing.success}/{passing.trials}회 성공 ({((passing.success_rate ?? 0) * 100).toFixed(1)}%) · 실패 {passing.failures}회 · 사용 비중 {((passing.usage_share ?? 0) * 100).toFixed(1)}% · 전체 실패 중 {((passing.failure_share ?? 0) * 100).toFixed(1)}%</small></section>}
    {!rankerCoaching?.advice.length && <div className="prescription-player-grid">{players.map(player => <section key={`${player.sp_id}:${player.position_name}`}><h4>{player.position_name} · {player.player_name}</h4><PlayerCoachingSummary guidance={player.guidance} /></section>)}</div>}
    {!players.length && !passing && <p>선택한 경기에서 연결할 선수·패스 기록이 없습니다. 분석 범위를 확인하세요.</p>}
  </article>;
}
