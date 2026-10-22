export const metres = (yards: number) => yards * 0.9144;
export const displayQuantity = (value: number, unit: string) => unit === "yards" ? metres(value) : value;

export const METRIC_LABELS: Record<string, string> = {
  display_goals: "경기당 팀 득점",
  own_goals: "경기당 자책골",
  shootout_shots: "경기당 승부차기 슈팅",
  goals: "경기당 선수 득점 합계",
  assists: "경기당 도움",
  goals_for: "경기당 팀 득점",
  goals_against: "경기당 실점",
  shots_against: "경기당 상대 슈팅",
  intercept: "경기당 인터셉트",
  defending_actions: "경기당 수비 기록 횟수",
  dribble_distance: "경기당 선수 드리블 거리 합계",
  team_distance: "경기당 팀 드리블 거리",
  offside: "경기당 오프사이드",
  foul: "경기당 파울",
  yellow: "경기당 옐로카드",
  red: "경기당 레드카드",
  yellow_cards: "경기당 선수 옐로카드 합계",
  red_cards: "경기당 선수 레드카드 합계",
  corner: "경기당 코너킥",
  injury: "경기당 부상",
};

const SHOT_LOCATION_METRICS = new Set(["on_target", "conversion", "box_inside", "box_outside", "heading", "freekick", "penalty"]);
export const hasShotLocations = (metric: string) => SHOT_LOCATION_METRICS.has(metric) || metric.startsWith("shot_type_");

export function shotPosition(point: { x: number; y: number }, fullPitch = false) {
  return { x: 18 + point.y * 204, y: 18 + (1 - point.x) * 316, visible: fullPitch || point.x >= .5 };
}
