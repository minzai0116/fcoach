import type { ReactNode } from "react";

export function AnalysisInfo({ children }: { children: ReactNode }) {
  return <details className="analysis-info metric-analysis-info"><summary>ⓘ 집계 기준</summary><div>{children}</div></details>;
}
