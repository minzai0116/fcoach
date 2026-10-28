"use client";

import { useState } from "react";
import type { PassingCoaching } from "../../types/coaching";
import { formatPercent, SuccessRing } from "./CoachingVisuals";
import { TeamMetricComparison, type TeamComparisons } from "./TeamMetricComparison";
import { PassingComparisonChart } from "./PassingComparisonChart";

export function PassingCoachingPanel({ passing, observation, comparisons = new Map() }: { passing: PassingCoaching; observation: boolean; comparisons?: TeamComparisons }) {
  const [selection, setSelection] = useState(passing.priorities[0]?.metric ?? passing.types[0]?.metric);
  const [mode, setMode] = useState<"share" | "success">("success");
  const selected = passing.types.find((item) => item.metric === selection) ?? passing.types[0];
  const priority = passing.priorities.find((item) => item.metric === selected?.metric);
  return (
    <section className="passing-coaching" aria-label="팀 패스 유형 분석">
      <div className="coaching-section-heading"><h4>패스 유형별 기록</h4><span>{passing.observed_matches}경기</span></div>
      <TeamMetricComparison pairs={comparisons} ids={["passing:overall"]} />
      <div className="passing-overview">
        <div><small>전체 성공률</small><strong>{formatPercent(passing.overall.success_rate)}</strong></div>
        <div><small>패스 시도</small><strong>{passing.overall.trials.toLocaleString()}<em>회</em></strong></div>
        <div><small>패스 실패</small><strong>{passing.overall.failures.toLocaleString()}<em>회</em></strong></div>
      </div>

      {passing.observed_matches === 0 ? <p className="muted">유형을 비교할 수 있는 패스 기록이 없습니다.</p> : <div className="passing-analysis-layout"><div className="passing-comparison">
        <div className="passing-chart-heading"><h5>{mode === "share" ? "사용량과 실패량 비교" : "유형별 성공률 비교"}</h5><div className="coaching-view-toggle" aria-label="그래프 보기 선택">
          <button aria-pressed={mode === "share"} onClick={() => setMode("share")}>사용·실패 비중</button>
          <button aria-pressed={mode === "success"} onClick={() => setMode("success")}>성공률</button>
        </div></div>
        <PassingComparisonChart passing={passing} selected={selected?.metric ?? ""} mode={mode} onSelect={setSelection} comparisons={comparisons} />
        </div>
        {selected && <div className="passing-selected-card" aria-live="polite" aria-atomic="true">
          <div className="passing-selected-heading"><div><span className={`coaching-badge${priority ? "" : " muted-badge"}`}>{"기록"}</span><h5>{selected.label}</h5><span className="muted">{selected.success}/{selected.trials}회 성공 · 실패 {selected.failures}회</span></div><SuccessRing value={selected.success_rate} /></div>
          <TeamMetricComparison pairs={comparisons} ids={[`passing:${selected.metric}:success`, `passing:${selected.metric}:usage`]} />
          {priority && !observation && <section className="metric-coaching-advice" aria-label="패스 교정안"><h6>추천 플레이</h6><p>{priority.adjustment}</p></section>}
        </div>}
      </div>}

    </section>
  );
}
