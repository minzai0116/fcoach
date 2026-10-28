import type { ComparableMetric, MetricUnit } from "../types/comparison";
import type { PositionPlayer } from "../types/coaching";

const COUNTERS: Record<string, [string, MetricUnit, ComparableMetric["direction"]]> = {
  goals: ["경기당 득점", "goals", "higher"], assists: ["경기당 도움", "average", "higher"],
  intercept: ["경기당 인터셉트", "average", "neutral"], defending_actions: ["경기당 골 차단", "average", "neutral"],
  dribble_distance: ["경기당 드리블 거리", "meters", "neutral"], rating: ["평균 평점", "rating", "higher"],
  yellow_cards: ["경기당 옐로카드", "average", "lower"], red_cards: ["경기당 레드카드", "average", "lower"],
};

export function playerComparisonMetrics(player: PositionPlayer): ComparableMetric[] {
  const observations = (player.observations ?? []).flatMap(item => {
    const spec = COUNTERS[item.metric];
    if (!spec || !item.observed_matches) return [];
    const factor = item.metric === "dribble_distance" ? .9144 : 1;
    return [{ id: item.metric, label: spec[0], unit: spec[1], direction: spec[2],
      value: item.total / item.observed_matches * factor, total: item.total * factor, matches: item.observed_matches }];
  });
  const rates = player.measurements.map(item => ({ id: item.metric, label: item.metric === "pass" ? "패스 성공률" : item.label, unit: "rate" as const,
    direction: "higher" as const, value: item.trials > 0 && item.observed_matches > 0 ? item.success / item.trials : null,
    success: item.success, trials: item.trials, matches: item.observed_matches }));
  return [...observations.slice(0, 2), ...rates, ...observations.slice(2)];
}

export function pairPlayerMetrics(left: PositionPlayer, right: PositionPlayer) {
  const mine = playerComparisonMetrics(left), reference = playerComparisonMetrics(right);
  const leftById = new Map(mine.map(metric => [metric.id, metric]));
  const rightById = new Map(reference.map(metric => [metric.id, metric]));
  return [...new Set([...leftById.keys(), ...rightById.keys()])].map(id => ({ mine: leftById.get(id), reference: rightById.get(id) }));
}
