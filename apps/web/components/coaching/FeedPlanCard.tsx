import type { FeedPlan } from "../../types/squadFeed";
import { formatPercent, PercentageBar } from "./CoachingVisuals";


export const PLAN_STATUS = { priority: "우선 점검", review: "개선 제안", maintain: "유지", insufficient: "", observation: "기록 확인" };

export function FeedPlanCard({ plan }: { plan: FeedPlan }) {
  if (plan.status === "insufficient") return null;
  return <article className={`feed-plan-card plan-${plan.status}`}>
    <div className="coaching-section-heading"><h5>{plan.title}</h5><span className="coaching-badge">{PLAN_STATUS[plan.status]}</span></div>
    <div className="feed-plan-metrics">{plan.evidence.map((e, i) => <div key={`${e.label}:${i}`}>
      <span>{e.label}</span><strong>{formatPercent(e.value)}</strong><PercentageBar value={e.value} />
      <small>{e.success}/{e.trials}회 · {e.observed_matches}경기</small>
    </div>)}</div>
    {!!plan.actions.length && <section><h6>이번에 바꿔 볼 것</h6><ol className="feed-plan-actions">{plan.actions.map((action, index) => <li key={index}>
      <strong>{action.kind === "alternative" ? "별도 대안 · " : ""}{action.label}</strong>
      {action.current !== null && action.proposed !== null && <div className="feed-setting-change"><span>{action.current}</span><b aria-hidden="true">→</b><strong>{action.proposed}</strong></div>}
      <p>{action.reason}</p>
    </li>)}</ol></section>}

    <details className="detail-block plan-reasoning"><summary>판단 근거</summary><p>{plan.reason}</p>{plan.settings.map((setting, index) => <div key={index}><strong>{setting.features.length ? "특성·코치 활용" : setting.label}</strong>{!setting.features.length && <p>{setting.value}</p>}<p>{setting.reason}</p></div>)}<p>{plan.limitation}</p><p>{plan.verification}</p></details>
  </article>;
}
