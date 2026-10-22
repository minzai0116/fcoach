"use client";

import type { CoachingDomain } from "../../types/coaching";
import { InteractiveShotMap } from "./InteractiveShotMap";

export function ShotLocationMap({ domain, metric }: { domain: CoachingDomain; metric: string }) {
  const points = (domain.shot_map ?? []).filter(point => {
    if (metric.startsWith("shot_type_")) return point.type === (metric === "shot_type_unknown" ? null : Number(metric.slice(10)));
    if (metric === "box_inside") return point.in_penalty === true && point.type !== 9;
    if (metric === "box_outside") return point.in_penalty === false;
    const type = ({ heading: 3, freekick: 8, penalty: 9 } as Record<string, number>)[metric];
    return type === undefined || point.type === type;
  });
  return <InteractiveShotMap key={metric} points={points} />;
}
