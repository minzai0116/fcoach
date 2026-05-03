export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

const DISTINCT_ID_KEY = "fcoach_distinct_id";
const SESSION_ID_KEY = "fcoach_session_id";
const FIRST_SEEN_AT_KEY = "fcoach_first_seen_at";
const LAST_SEEN_AT_KEY = "fcoach_last_seen_at";
const LAST_VISITOR_EVENT_DATE_KEY = "fcoach_last_visitor_event_date";

type RequestApiOptions = {
  timeoutMs?: number;
};

function ensureStorageId(storage: Storage, key: string): string {
  const existing = storage.getItem(key);
  if (existing) return existing;
  const generated = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  storage.setItem(key, generated);
  return generated;
}

function maskOuid(ouid: string): string {
  const value = ouid.trim();
  if (value.length < 10) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function trackEvent(
  eventName: string,
  payload: {
    screen?: string;
    matchType?: number;
    windowSize?: number;
    ouid?: string;
    properties?: Record<string, unknown>;
  },
): void {
  if (typeof window === "undefined") return;
  try {
    const distinctId = ensureStorageId(window.localStorage, DISTINCT_ID_KEY);
    const sessionId = ensureStorageId(window.sessionStorage, SESSION_ID_KEY);
    const body = {
      event_name: eventName,
      distinct_id: distinctId,
      session_id: sessionId,
      path: window.location.pathname,
      screen: payload.screen ?? null,
      referrer: document.referrer || null,
      properties: {
        match_type: payload.matchType ?? null,
        window_size: payload.windowSize ?? null,
        ouid_masked: payload.ouid ? maskOuid(payload.ouid) : null,
        ...(payload.properties ?? {}),
      },
    };
    void fetch(`${API_BASE_URL}/events/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    return;
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromIso: string | null, to: Date): number | null {
  if (!fromIso) return null;
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return null;
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

export function trackVisitorLifecycle(screen?: string): void {
  if (typeof window === "undefined") return;
  try {
    const storage = window.localStorage;
    const now = new Date();
    const today = todayKey();
    const firstSeenAt = storage.getItem(FIRST_SEEN_AT_KEY);
    const lastSeenAt = storage.getItem(LAST_SEEN_AT_KEY);
    const lastVisitorEventDate = storage.getItem(LAST_VISITOR_EVENT_DATE_KEY);

    if (!firstSeenAt) {
      const nowIso = now.toISOString();
      storage.setItem(FIRST_SEEN_AT_KEY, nowIso);
      storage.setItem(LAST_SEEN_AT_KEY, nowIso);
      storage.setItem(LAST_VISITOR_EVENT_DATE_KEY, today);
      trackEvent("visitor_first_seen", {
        screen,
        properties: {
          visit_type: "new",
          visit_date: today,
          first_seen_at: nowIso,
        },
      });
      return;
    }

    storage.setItem(LAST_SEEN_AT_KEY, now.toISOString());
    if (lastVisitorEventDate === today) return;

    storage.setItem(LAST_VISITOR_EVENT_DATE_KEY, today);
    trackEvent("visitor_return", {
      screen,
      properties: {
        visit_type: "returning",
        visit_date: today,
        first_seen_at: firstSeenAt,
        days_since_first_seen: daysBetween(firstSeenAt, now),
        days_since_last_seen: daysBetween(lastSeenAt, now),
      },
    });
  } catch {
    return;
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
      const detail = typeof body.detail === "string" ? body.detail : `HTTP ${res.status}`;
      throw new Error(detail);
    }
    return (await res.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
