import { METRIC_ADVICE } from "./metricAdvice";

export function MetricCoachingAdvice({ metric, observation }: { metric: string; observation: boolean }) {
  const key = ["yellow", "red", "yellow_cards", "red_cards"].includes(metric) ? "foul" : metric;
  const advice = METRIC_ADVICE[key];
  if (observation || !advice) return null;
  return <section className="metric-coaching-advice" aria-label="플레이 선택지">
    <h6>추천 플레이</h6><strong>{advice.title}</strong><p>{advice.action}</p>
  </section>;
}
