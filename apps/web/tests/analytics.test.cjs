const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const ts = require("typescript");

function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
function client(url = "https://fcoach.fun/search", env = {}, fetchImpl) {
  const requests = [];
  const window = { location: new URL(url), localStorage: storage(), sessionStorage: storage(), screen: { width: 390, height: 844 } };
  const module = { exports: {} };
  runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/../lib/analytics.ts`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports: module.exports, require: () => ({ API_BASE_URL: "https://api.fcoach.fun" }), window,
    document: { referrer: "https://m.inven.co.kr/board?private=hidden" },
    process: { env: { NODE_ENV: "production", ...env } }, crypto: { randomUUID: () => "anonymous-browser" },
    URL, Date, fetch: fetchImpl ?? ((url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return Promise.resolve({ ok: true }); }),
  });
  return { api: module.exports, window, requests };
}

test("주소가 그대로인 갱신·모드 변경·StrictMode 반복은 페이지뷰를 늘리지 않는다", () => {
  const { api, window, requests } = client();
  api.trackPageView(); api.trackPageView();
  api.trackEvent("change_match_type", { matchType: 52 });
  window.location = new URL("https://fcoach.fun/search?matchType=52#detail");
  api.trackPageView();
  assert.equal(requests.filter(r => r.body.event_name === "page_view").length, 1);
  assert.equal(requests.filter(r => r.url.includes("nexon.com")).length, 1);
  window.location = new URL("https://fcoach.fun/players"); api.trackPageView();
  window.location = new URL("https://fcoach.fun/search"); api.trackPageView();
  assert.equal(requests.filter(r => r.body.event_name === "page_view").length, 3);
  assert.equal(requests.filter(r => r.url.includes("nexon.com")).length, 3);
  assert.equal(requests.filter(r => r.body.event_name === "visitor_first_seen").length, 1);
});

test("PC·모바일 모두 운영 호스트에서만 전송하고 개발·미리보기는 제외한다", () => {
  for (const [url, env] of [
    ["http://localhost:3010/search", {}], ["http://127.0.0.1:3010/search", {}],
    ["https://web-preview.vercel.app/search", {}], ["https://fcoach.fun/search", { NODE_ENV: "development" }],
    ["https://fcoach.fun/search", { NEXT_PUBLIC_VERCEL_ENV: "preview" }],
    ["https://fcoach.fun/search", { NEXT_PUBLIC_ANALYTICS_DISABLED: "true" }],
  ]) {
    const { api, requests } = client(url, env); api.trackPageView(); api.trackEvent("before_after_completed");
    assert.equal(requests.length, 0, `${url} ${JSON.stringify(env)}`);
    assert.equal(api.beforeSendAnalytics({ type: "pageview", url }), null);
  }
  const { api, requests } = client("https://www.fcoach.fun/tracking"); api.trackPageView();
  assert.equal(requests.filter(r => r.url.includes("nexon.com")).length, 1);
});

test("Vercel도 같은 경로 갱신을 중복 수집하지 않고 실제 되돌아가기는 기록한다", () => {
  const { api } = client();
  const send = path => api.beforeSendAnalytics({ type: "pageview", url: `https://fcoach.fun${path}` });
  assert.equal(send("/search?nickname=hidden").url, "https://fcoach.fun/search");
  assert.equal(send("/search?mode=52"), null);
  assert.ok(send("/players"));
  assert.equal(send("/habits/"), null);
  assert.ok(send("/search"));
});

test("별칭·URL·식별 정보가 수집 데이터에 섞이지 않는다", () => {
  const { api, requests } = client("https://fcoach.fun/habits/?nickname=private#player");
  api.trackPageView();
  api.trackEvent("squad_feed_connection_completed", { ouid: "private-ouid", properties: { linked_records: 11 } });
  const json = JSON.stringify(requests);
  assert.ok(!json.includes("private"));
  assert.equal(requests.find(r => r.body.event_name === "page_view").body.path, "/players");
  assert.equal(requests.find(r => r.url.includes("nexon.com")).body.href, "https://fcoach.fun/players");
  assert.equal(requests.find(r => r.body.event_name === "squad_feed_connection_completed").body.properties.linked_records, 11);
});

test("수집 서버나 브라우저 저장소 장애가 실제 기능을 막지 않는다", async () => {
  const { api, window } = client(undefined, {}, () => Promise.reject(new Error("offline")));
  assert.doesNotThrow(() => api.trackPageView());
  await new Promise(resolve => setImmediate(resolve));
  window.localStorage.getItem = () => { throw new Error("storage disabled"); };
  assert.doesNotThrow(() => api.trackEvent("before_after_failed", { properties: api.analyticsError({ code: "timeout" }) }));
});

test("분석 결과의 피드 연결은 선택과 구분하며 불일치를 실제 선수 연결로 해석하지 않는다", () => {
  const { api, requests } = client();
  api.trackFeedConnection({ status: "available", author_status: "matched", mode_status: "matched",
    summary: { linked: 11, different: 0, withheld: 0 } }, 60);
  api.trackFeedConnection({ status: "available", author_status: "mismatch", mode_status: "matched",
    summary: { linked: 0, different: 11, withheld: 0 } }, 60);
  api.trackFeedConnection({ status: "unavailable" }, 60);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].body.event_name, "squad_feed_connection_completed");
  assert.equal(requests[0].body.properties.coaching_linked, true);
  assert.equal(requests[1].body.properties.coaching_linked, false);
  assert.equal(requests[2].body.event_name, "squad_feed_connection_failed");
});
