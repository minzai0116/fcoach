"use client";
import { useEffect, useState } from "react";
import type { AnalysisProgress } from "../../lib/analysisRequest";

export function AnalysisProgressPanel({ progress, startedAt }: { progress: AnalysisProgress; startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return <section className="analysis-progress-panel" aria-label="분석 진행 상황">
    <div><strong role="status">{progress.label}</strong><span aria-hidden="true">{elapsed < 60 ? `${elapsed}초` : `${Math.floor(elapsed / 60)}분 ${elapsed % 60}초`} 경과</span></div>
    <div className="analysis-progress-activity" aria-hidden="true"><i /></div>
  </section>;
}
