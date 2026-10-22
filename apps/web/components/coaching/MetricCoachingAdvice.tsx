import { METRIC_ADVICE } from "./metricAdvice";

export function MetricCoachingAdvice({ metric, observation }: { metric: string; observation: boolean }) {
  const key = ["yellow", "red", "yellow_cards", "red_cards"].includes(metric) ? "foul" : metric;
  const advice = METRIC_ADVICE[key];
  if (observation || !advice) return null;
  return <section className="metric-coaching-advice" aria-label="플레이 선택지">
    <h6>이 지표를 개선하려면</h6><strong>{advice.title}</strong><p>{advice.action}</p>
    <div className="coaching-recheck"><div><strong>함께 개선할 지표</strong><small>{advice.compare}</small></div></div>
  </section>;
}
