import { API_BASE_URL } from "./apiConfig";
import type { SquadFeedCoaching } from "../types/squadFeed";
import type { BeforeSendEvent } from "@vercel/analytics/next";

export const ANALYTICS_VERSION = "2026-10-23";
const PRODUCTION_HOSTS = new Set(["fcoach.fun", "www.fcoach.fun"]);
const DISTINCT_ID_KEY = "fcoach_distinct_id";
const SESSION_ID_KEY = "fcoach_session_id";
const FIRST_SEEN_AT_KEY = "fcoach_first_seen_at";
const LAST_SEEN_AT_KEY = "fcoach_last_seen_at";
const LAST_VISITOR_EVENT_DATE_KEY = "fcoach_last_visitor_event_date";
let lastPagePath: string | null = null;
let lastVercelPath: string | null = null;

type EventPayload = {
  screen?: string;
  matchType?: number;
  windowSize?: number;
  properties?: Record<string, unknown>;
};

export function analyticsEnabled(): boolean {
  return typeof window !== "undefined"
    && process.env.NODE_ENV === "production"
    && process.env.NEXT_PUBLIC_ANALYTICS_DISABLED !== "true"
    && (!process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NEXT_PUBLIC_VERCEL_ENV === "production")
    && window.location.protocol === "https:"
    && PRODUCTION_HOSTS.has(window.location.hostname);
}

export function analyticsPath(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  return pathname === "/" ? "/guide" : pathname === "/habits" ? "/players" : pathname;
}

export function beforeSendAnalytics(event: BeforeSendEvent): BeforeSendEvent | null {
  if (!analyticsEnabled()) return null;
  const url = new URL(event.url);
  const path = analyticsPath(url.pathname);
  if (event.type === "pageview") {
    if (lastVercelPath === path) return null;
    lastVercelPath = path;
  }
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return { ...event, url: url.toString() };
}

function ensureStorageId(storage: Storage, key: string): string {
  const existing = storage.getItem(key);
  if (existing) return existing;
  const generated = crypto.randomUUID();
  storage.setItem(key, generated);
  return generated;
}

function post(url: string, body: unknown): void {
  try {
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => undefined);
  } catch { /* 수집 실패가 경기 분석을 중단하지 않도록 한다. */ }
}

export function trackEvent(eventName: string, payload: EventPayload = {}): void {
  if (!analyticsEnabled()) return;
  try {
    post(`${API_BASE_URL}/events/track`, {
      event_name: eventName,
      distinct_id: ensureStorageId(window.localStorage, DISTINCT_ID_KEY),
      session_id: ensureStorageId(window.sessionStorage, SESSION_ID_KEY),
      path: analyticsPath(window.location.pathname),
      screen: payload.screen ?? null,
      referrer: document.referrer ? new URL(document.referrer).origin : null,
      properties: {
        match_type: payload.matchType ?? null,
        window_size: payload.windowSize ?? null,
        ...payload.properties,
        hostname: window.location.hostname,
        environment: "production",
        measurement_version: ANALYTICS_VERSION,
      },
    });
  } catch { /* 저장소 접근을 차단한 브라우저에서도 서비스를 계속 제공한다. */ }
}

export function analyticsError(error: unknown): Record<string, unknown> {
  const detail = error as { code?: string; status?: number } | null;
  return { error_kind: detail?.code ?? "unknown", http_status: detail?.status ?? null };
}

export function trackFeedConnection(connection: SquadFeedCoaching | undefined, matchType: number): void {
  trackEvent(connection?.status === "available" ? "squad_feed_connection_completed" : "squad_feed_connection_failed", {
    screen: "diagnosis", matchType,
    properties: connection?.status === "available" ? {
      author_status: connection.author_status,
      mode_status: connection.mode_status,
      coaching_linked: connection.summary.linked > 0,
      linked_records: connection.summary.linked,
      different_records: connection.summary.different,
      withheld_records: connection.summary.withheld,
    } : { stage: "feed_connection", error_kind: "feed_unavailable" },
  });
}

export function trackVisitorLifecycle(): void {
  if (!analyticsEnabled()) return;
  try {
    const storage = window.localStorage;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const firstSeen = storage.getItem(FIRST_SEEN_AT_KEY);
    storage.setItem(LAST_SEEN_AT_KEY, now.toISOString());
    if (storage.getItem(LAST_VISITOR_EVENT_DATE_KEY) === today) return;
    if (!firstSeen) storage.setItem(FIRST_SEEN_AT_KEY, now.toISOString());
    storage.setItem(LAST_VISITOR_EVENT_DATE_KEY, today);
    trackEvent(firstSeen ? "visitor_return" : "visitor_first_seen", {
      properties: { visit_date: today, visit_type: firstSeen ? "returning" : "new" },
    });
  } catch { /* 방문 기록은 선택적인 부가 기능이다. */ }
}

export function trackPageView(): void {
  if (!analyticsEnabled()) return;
  const path = analyticsPath(window.location.pathname);
  if (lastPagePath === path) return;
  lastPagePath = path;
  trackVisitorLifecycle();
  trackEvent("page_view");
  // 공식 스크립트의 수집 형식을 사용하되, 같은 주소의 history 갱신은 방문으로 세지 않는다.
  // 계약 확인: https://openapi.nexon.com/js/analytics.js?app_id=289946 (2026-10-23)
  post("https://open.api.nexon.com/analytics/collect?app_id=289946", {
    referrer: document.referrer ? new URL(document.referrer).origin : "",
    href: `${window.location.origin}${path}`,
    hostname: window.location.hostname,
    screen_width: window.screen.width,
    screen_height: window.screen.height,
  });
}
