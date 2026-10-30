import { API_BASE_URL } from "./apiConfig";
export { API_BASE_URL } from "./apiConfig";
export { trackEvent } from "./analytics";

type RequestApiOptions = { timeoutMs?: number };

export class ApiRequestError extends Error {
  constructor(message: string, public code: "http" | "timeout" | "network", public status?: number,
    public reason?: string, public action?: string) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function requestApi<T>(path: string, init?: RequestInit, options?: RequestApiOptions): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: init?.signal ?? controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = body.detail;
      const message = typeof detail === "string" ? detail : typeof detail?.message === "string" ? detail.message : res.status === 422 ? "입력한 내용을 확인해주세요. 감독명과 경기 선택을 다시 확인해주세요." : "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
      throw new ApiRequestError(message, "http", res.status,
        typeof detail?.code === "string" ? detail.code : undefined,
        typeof detail?.action === "string" ? detail.action : undefined);
    }
    return (await res.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiRequestError("요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.", "timeout");
    }
    if (error instanceof TypeError) throw new ApiRequestError("서비스에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.", "network");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
