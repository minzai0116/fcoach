"use client";

import { useState } from "react";
import type { PassingCoaching } from "../../types/coaching";
import { formatPercent, SuccessRing } from "./CoachingVisuals";
import { AnalysisInfo } from "./AnalysisInfo";
import { PassingComparisonChart } from "./PassingComparisonChart";

export function PassingCoachingPanel({ passing, observation }: { passing: PassingCoaching; observation: boolean }) {
  const [selection, setSelection] = useState(passing.priorities[0]?.metric ?? passing.types[0]?.metric);
  const [mode, setMode] = useState<"share" | "success">("share");
  const selected = passing.types.find((item) => item.metric === selection) ?? passing.types[0];
  const priority = passing.priorities.find((item) => item.metric === selected?.metric);
  const rank = passing.priorities.findIndex((item) => item.metric === selected?.metric) + 1;
  return (
    <section className="passing-coaching" aria-label="팀 패스 유형 분석">
      <div className="coaching-section-heading"><div><span className="coaching-eyebrow">팀 전체 · {passing.observed_matches}경기</span><h4>패스 선택, 한눈에 보기</h4></div><AnalysisInfo><p className="muted">{passing.note}</p>
        {passing.excluded_matches > 0 && <p className="muted">정상 {passing.sample_count}경기 중 누락·모순 기록 {passing.excluded_matches}경기를 제외했습니다.</p>}
        {passing.remainder.trials > 0 && <p className="muted">전체와 6유형 합계의 차이: 시도 {passing.remainder.trials}회 · 성공 {passing.remainder.success}회 · 실패 {passing.remainder.failures}회. 종류를 알 수 없어 특정 유형에 포함하지 않습니다.</p>}
      </AnalysisInfo></div>
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
        <PassingComparisonChart passing={passing} selected={selected?.metric ?? ""} mode={mode} onSelect={setSelection} />
        </div>
        {selected && <div className="passing-selected-card" aria-live="polite" aria-atomic="true">
          <div className="passing-selected-heading"><div><span className={`coaching-badge${priority ? "" : " muted-badge"}`}>{priority ? `점검 순서 ${rank}` : "기록"}</span><h5>{selected.label}</h5><span className="muted">{selected.success}/{selected.trials}회 성공 · 실패 {selected.failures}회</span></div><SuccessRing value={selected.success_rate} /></div>
          <div className="passing-selected-stats"><div><small>사용 비중</small><strong>{formatPercent(selected.usage_share)}</strong></div><span aria-hidden="true">→</span><div><small>전체 실패 중 비중</small><strong>{formatPercent(selected.failure_share)}</strong></div><div><small>전체 패스 100회당 유형 실패</small><strong>{selected.loss_per_100_passes === null ? "—" : `${selected.loss_per_100_passes.toFixed(2)}회`}</strong></div></div>
          {priority ? <>
            <p className="passing-insight">{priority.evidence}</p>
            {observation ? <div className="coaching-observation"><strong>같은 선수·포메이션으로 자동 경기 추가 관찰</strong><p className="muted">감독 모드에서는 직접 패스 조작을 교정하지 않습니다.</p></div> : <section className="metric-coaching-advice" aria-label="패스 교정안"><h6>플레이 교정안</h6><p>{priority.adjustment}</p></section>}
            <div className="coaching-recheck"><span className="coaching-step-number">↻</span><div><strong>다음 5경기 · 이 유형 20회 이상</strong><small>성공률 + 사용 비중 + 실패량 비교<br />팀 슈팅·득점이 함께 줄지 않았는지도 확인</small></div></div>
            <details className="detail-block"><summary>상세 근거와 비교 방법</summary><p>{priority.evidence}</p><p className="muted">{priority.interpretation}</p><p className="muted">{priority.verification}</p></details>
          </> : <p className="coaching-scope-note">{selected.status === "insufficient" ? `${selected.observed_matches}경기 · ${selected.trials}회 시도` : "성공률과 사용량을 함께 확인하세요."}</p>}
        </div>}
      </div>}

    </section>
  );
}
