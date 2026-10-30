import { requestApi } from "./apiClient";
import type { AnalysisPayload } from "../types/analysis";

export type AnalysisProgress = { stage: string; label: string; status: "pending" | "running" | "completed" | "failed"; elapsed_seconds?: number };

export async function requestAnalysis(body: Record<string, unknown>, onProgress: (value: AnalysisProgress) => void): Promise<AnalysisPayload> {
  const progressId = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, "0")).join("");
  let active = true;
  let timer: ReturnType<typeof setTimeout>;
  const poll = async () => {
    try {
      const value = await requestApi<AnalysisProgress>(`/analysis/progress/${progressId}`, undefined, { timeoutMs: 4000 });
      if (active && value.status === "running") onProgress(value);
    } catch { /* 진행 조회 실패가 분석 요청 자체를 중단하지 않게 한다. */ }
    if (active) timer = setTimeout(poll, 1500);
  };
  onProgress({ stage: "accepted", status: "running", label: "분석 요청을 준비하고 있어요" });
  timer = setTimeout(poll, 500);
  try {
    return await requestApi<AnalysisPayload>("/analysis/run", {
      method: "POST", body: JSON.stringify({ ...body, progress_id: progressId }),
    }, { timeoutMs: 120_000 });
  } finally {
    active = false;
    clearTimeout(timer);
  }
}
