type MetricMap = Record<string, number>;

export type TrackingEvaluationInput = {
  window_size: number;
  pre_match_count?: number;
  post_match_count?: number;
  pre: MetricMap;
  post: MetricMap;
};

export type TrackingActionCandidate = {
  rank: number;
  actionCode: string;
  title: string;
};

export type TrackingMetricInsight = {
  key: string;
  label: string;
  deltaText: string;
  comment: string;
  tone: "good" | "bad" | "neutral";
};

export type TrackingCoachInsight = {
  headline: string;
  guidance: string;
  reliabilityLabel: string;
  reliabilityDetail: string;
  reliabilityClassName: "issue-low" | "issue-mid" | "issue-high";
  outcomeLabel: string;
  outcomeClassName: "issue-low" | "issue-mid" | "issue-high";
  recommendationTitle: string;
  recommendationDescription: string;
  recommendationReason: string;
  metricInsights: TrackingMetricInsight[];
};

type TrackingMetricKey = "win_rate" | "xg_for" | "xg_against" | "shot_on_target_rate";

type MetricConfig = {
  key: TrackingMetricKey;
  label: string;
  higherIsBetter: boolean;
  perMatch: boolean;
  threshold: number;
};

const TRACKING_METRICS: MetricConfig[] = [
  { key: "win_rate", label: "승률", higherIsBetter: true, perMatch: false, threshold: 0.05 },
  { key: "xg_for", label: "경기당 xG For", higherIsBetter: true, perMatch: true, threshold: 0.15 },
  { key: "xg_against", label: "경기당 xG Against", higherIsBetter: false, perMatch: true, threshold: 0.15 },
  { key: "shot_on_target_rate", label: "유효슈팅 비율", higherIsBetter: true, perMatch: false, threshold: 0.02 },
];

function toSafeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMetricValue(
  metric: MetricConfig,
  metrics: MetricMap,
  matchCount: number,
): number {
  const raw = toSafeNumber(metrics[metric.key]);
  if (!metric.perMatch) return raw;
  if (matchCount <= 0) return 0;
  return raw / matchCount;
}

function formatSignedDelta(metric: MetricConfig, delta: number): string {
  const sign = delta >= 0 ? "+" : "-";
  const abs = Math.abs(delta);
  if (metric.key === "win_rate" || metric.key === "shot_on_target_rate") {
    return `${sign}${(abs * 100).toFixed(1)}%p`;
  }
  return `${sign}${abs.toFixed(2)}`;
}

function metricTone(metric: MetricConfig, delta: number): "good" | "bad" | "neutral" {
  if (Math.abs(delta) < metric.threshold) return "neutral";
  const improved = metric.higherIsBetter ? delta > 0 : delta < 0;
  return improved ? "good" : "bad";
}

function reliabilityInfo(postCount: number, windowSize: number): {
  label: string;
  detail: string;
  className: "issue-low" | "issue-mid" | "issue-high";
} {
  const safeWindow = Math.max(1, windowSize);
  const coverage = postCount / safeWindow;
  if (postCount < 3) {
    return {
      label: "낮음",
      detail: `POST 표본 ${postCount}/${safeWindow}경기입니다. 지금은 방향성 참고 단계입니다.`,
      className: "issue-high",
    };
  }
  if (coverage < 1) {
    return {
      label: "보통",
      detail: `POST 표본 ${postCount}/${safeWindow}경기입니다. 1차 결론 전 추가 표본이 필요합니다.`,
      className: "issue-mid",
    };
  }
  return {
    label: "높음",
    detail: `POST 표본 ${postCount}/${safeWindow}경기를 채워 1차 검증 신뢰도가 확보되었습니다.`,
    className: "issue-low",
  };
}

function recommendationForOutcome(
  outcome: "good" | "mixed" | "bad",
  reliabilityClassName: "issue-low" | "issue-mid" | "issue-high",
  actionCode: string,
  issueLabelMap: Record<string, string>,
  actions: TrackingActionCandidate[],
  postCount: number,
  windowSize: number,
): { title: string; description: string; reason: string } {
  const currentLabel = issueLabelMap[actionCode] ?? actionCode;
  const fallback = {
    title: "재진단 권장",
    description: "전술 코칭 탭에서 최신 진단을 다시 실행해 새로운 실험 후보를 생성하세요.",
    reason: "현재 비교 가능한 보조 추천이 없습니다.",
  };

  if (reliabilityClassName !== "issue-low") {
    return {
      title: "현재 실험 유지",
      description: `아직 POST 표본이 ${postCount}/${Math.max(1, windowSize)}경기입니다. 동일 플랜으로 표본을 먼저 채우세요.`,
      reason: "표본 부족 상태에서 전술을 바꾸면 실험 결과 해석이 어려워집니다.",
    };
  }

  const nextAction = actions
    .filter((item) => item.actionCode !== actionCode)
    .sort((left, right) => left.rank - right.rank)[0];

  if (outcome === "good") {
    if (!nextAction) {
      return {
        title: `${currentLabel} 유지`,
        description: "현재 액션을 1~2주 더 유지하면서 추세 안정 여부를 확인하세요.",
        reason: "핵심 지표가 개선 방향을 보이고 있습니다.",
      };
    }
    return {
      title: `다음 실험: ${issueLabelMap[nextAction.actionCode] ?? nextAction.actionCode}`,
      description: `${nextAction.title} 액션으로 약한 2순위 이슈를 순차 교정하세요.`,
      reason: "1순위 이슈가 개선되어 다음 병목으로 넘어갈 시점입니다.",
    };
  }

  if (!nextAction) return fallback;

  return {
    title: `전환 권장: ${issueLabelMap[nextAction.actionCode] ?? nextAction.actionCode}`,
    description: `${nextAction.title} 액션으로 5경기 재실험을 권장합니다.`,
    reason: "현재 액션의 개선 폭이 제한적이거나 일부 지표가 악화되었습니다.",
  };
}

export function buildTrackingCoachInsight(input: {
  evaluation: TrackingEvaluationInput | null | undefined;
  experimentActionCode?: string | null;
  actions?: TrackingActionCandidate[];
  issueLabelMap?: Record<string, string>;
}): TrackingCoachInsight | null {
  if (!input.evaluation) return null;

  const evaluation = input.evaluation;
  const issueLabelMap = input.issueLabelMap ?? {};
  const actionCode = (input.experimentActionCode ?? "").trim();
  const preCount = Math.max(0, toSafeNumber(evaluation.pre_match_count));
  const postCount = Math.max(0, toSafeNumber(evaluation.post_match_count));
  const windowSize = Math.max(1, toSafeNumber(evaluation.window_size));

  const metricInsights = TRACKING_METRICS.map((metric) => {
    const preValue = normalizeMetricValue(metric, evaluation.pre ?? {}, preCount);
    const postValue = normalizeMetricValue(metric, evaluation.post ?? {}, postCount);
    const delta = postValue - preValue;
    const tone = metricTone(metric, delta);
    const directionText =
      tone === "good"
        ? "개선"
        : tone === "bad"
          ? "악화"
          : "유지";
    return {
      key: metric.key,
      label: metric.label,
      deltaText: formatSignedDelta(metric, delta),
      tone,
      comment: `${metric.label}이 ${directionText}되었습니다.`,
      qualityDelta: metric.higherIsBetter ? delta : -delta,
    };
  });

  const goodCount = metricInsights.filter((metric) => metric.tone === "good").length;
  const badCount = metricInsights.filter((metric) => metric.tone === "bad").length;

  let outcome: "good" | "mixed" | "bad" = "mixed";
  if (goodCount >= 3 && badCount === 0) outcome = "good";
  else if (badCount >= 2) outcome = "bad";

  const reliability = reliabilityInfo(postCount, windowSize);
  const issueLabel = actionCode ? issueLabelMap[actionCode] ?? actionCode : "현재 실험";

  const headline =
    outcome === "good"
      ? `${issueLabel} 교정이 유효하게 진행 중입니다.`
      : outcome === "bad"
        ? `${issueLabel} 교정 효과가 약해 전환 검토가 필요합니다.`
        : `${issueLabel} 교정은 부분 개선 상태입니다.`;

  const guidance =
    outcome === "good"
      ? "핵심 지표가 개선 방향을 보입니다. 동일 설정을 유지한 채 표본을 더 쌓으세요."
      : outcome === "bad"
        ? "일부 핵심 지표가 악화되어 동일 처방 고정보다 다음 액션 전환이 안전합니다."
        : "수비·공격 지표가 엇갈립니다. 단기 보정 후 다음 실험으로 분기하는 전략이 좋습니다.";

  const recommendation = recommendationForOutcome(
    outcome,
    reliability.className,
    actionCode,
    issueLabelMap,
    input.actions ?? [],
    postCount,
    windowSize,
  );

  const worstMetric = [...metricInsights].sort((left, right) => left.qualityDelta - right.qualityDelta)[0];
  const recommendationReason =
    reliability.className !== "issue-low"
      ? recommendation.reason
      : worstMetric
        ? `${recommendation.reason} (${worstMetric.label} 변화 ${worstMetric.deltaText})`
        : recommendation.reason;

  return {
    headline,
    guidance,
    reliabilityLabel: reliability.label,
    reliabilityDetail: reliability.detail,
    reliabilityClassName: reliability.className,
    outcomeLabel: outcome === "good" ? "유지 권장" : outcome === "bad" ? "전환 권장" : "부분 개선",
    outcomeClassName: outcome === "good" ? "issue-low" : outcome === "bad" ? "issue-high" : "issue-mid",
    recommendationTitle: recommendation.title,
    recommendationDescription: recommendation.description,
    recommendationReason,
    metricInsights: metricInsights.map((metric) => ({
      key: metric.key,
      label: metric.label,
      deltaText: metric.deltaText,
      comment: metric.comment,
      tone: metric.tone,
    })),
  };
}
