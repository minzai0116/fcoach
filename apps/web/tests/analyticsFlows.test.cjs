const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const ts = require("typescript");
const element = (type, props) => ({ type, props });
const tick = () => new Promise(resolve => setImmediate(resolve));

function component(file, name, props, requestApi) {
  let cursor = 0, tree;
  const state = [], effects = [], scheduled = [], events = [];
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return state[index] ??= { current: initial }; },
    useEffect(effect, deps) {
      const index = cursor++, previous = effects[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        scheduled.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: effect() }; });
      }
    },
  };
  const module = { exports: {} };
  runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/../components/coaching/${file}.tsx`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports: module.exports, require: path => {
    if (path === "react") return hooks;
    if (path === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: "fragment" };
    if (path.endsWith("apiClient")) return { requestApi };
    if (path.endsWith("analytics")) return { trackEvent: (name, payload) => events.push({ name, ...payload }), analyticsError: error => ({ error_kind: error.code ?? "unknown" }) };
    if (path.endsWith("squadFeed")) return { feedNicknameKey: value => value.trim().toLowerCase() };
    if (path.endsWith("uiConstants")) return { MATCH_LABELS: { 60: "공식 경기" }, MATCH_TYPE_OPTIONS: [60] };
    return {};
  } });
  function render() {
    cursor = 0; tree = module.exports[name](props);
    scheduled.splice(0).forEach(run => run());
    return tree;
  }
  function find(predicate, node) {
    if (arguments.length === 1) node = tree;
    if (Array.isArray(node)) return node.map(child => find(predicate, child)).find(Boolean);
    if (!node?.props) return null;
    return predicate(node) ? node : node.props.children === undefined ? null : find(predicate, node.props.children);
  }
  render();
  return { render, find, events, unmount: () => effects.forEach(effect => effect?.cleanup?.()) };
}

test("공개 피드 목록·선택 완료는 각각 한 번 기록하고 분석 연결로 오인하지 않는다", async () => {
  const selected = [];
  const fixture = { author: "tester", feed_id: "feed1234", title: "saved feed", players: [] };
  const ui = component("SquadFeedSelector", "SquadFeedSelector", {
    nickname: "tester", selected: null, disabled: false, onChange: value => selected.push(value), onLoadingChange() {},
  }, async path => path.includes("?") ? { items: [fixture], page: 1, has_more: false } : fixture);
  ui.find(n => n.type === "button" && n.props.children === "닉네임의 공개 피드 불러오기").props.onClick();
  await tick(); ui.render();
  ui.find(n => n.type === "input" && n.props.type === "radio").props.onChange();
  await tick();
  assert.deepEqual(ui.events.map(e => e.name), ["squad_feed_list_completed", "squad_feed_selection_completed"]);
  assert.equal(selected.at(-1), fixture);
});

test("작성자 불일치와 실패한 조회는 선택 성공으로 기록하지 않는다", async () => {
  const fixture = { author: "other", feed_id: "feed1234", title: "saved feed", players: [] };
  const ui = component("SquadFeedSelector", "SquadFeedSelector", {
    nickname: "tester", selected: null, disabled: false, onChange() {}, onLoadingChange() {},
  }, async path => path.includes("?") ? { items: [fixture], page: 1, has_more: false } : fixture);
  ui.find(n => n.type === "button" && n.props.children === "닉네임의 공개 피드 불러오기").props.onClick();
  await tick(); ui.render();
  ui.find(n => n.type === "input" && n.props.type === "radio").props.onChange();
  await tick();
  assert.equal(ui.events.at(-1).name, "squad_feed_selection_failed");
  assert.equal(ui.events.at(-1).properties.error_kind, "author_mismatch");
  assert.ok(!ui.events.some(e => e.name === "squad_feed_selection_completed"));
});

async function comparison(requestCompare) {
  const items = Array.from({ length: 4 }, (_, i) => ({ match_id: `match000${i}`, match_end_type: 0, match_date: `2026-10-${22 - i}T00:00:00Z` }));
  const ui = component("BeforeAfterComparisonPanel", "BeforeAfterComparisonPanel", { initialNickname: "tester", initialMatchType: 60 }, async path => {
    if (path.startsWith("/users")) return { ouid: "private-ouid", nickname: "tester" };
    if (path.startsWith("/matches")) return { items };
    return requestCompare();
  });
  ui.find(n => n.type === "button" && n.props.children === "경기 목록 불러오기").props.onClick();
  await tick(); ui.render();
  ui.find(n => n.type === "button" && n.props.children === "조회 경기를 앞·뒤 절반으로 나누기").props.onClick();
  ui.render();
  ui.find(n => n.type === "button" && n.props.className === "btn comparison-run").props.onClick();
  return ui;
}

test("전후 비교 완료는 선택 수가 아닌 실제 반환된 경기 수로 기록한다", async () => {
  const ui = await comparison(async () => ({ before: { matches: 1 }, after: { matches: 2 }, metrics: [{}, {}] }));
  await tick();
  const event = ui.events.at(-1);
  assert.equal(event.name, "before_after_completed");
  assert.equal(event.properties.before_matches, 1);
  assert.equal(event.properties.after_matches, 2);
  assert.ok(!JSON.stringify(ui.events).includes("private-ouid"));
});

test("전후 비교 실패와 화면을 떠난 뒤 도착한 응답을 완료로 세지 않는다", async () => {
  const failed = await comparison(async () => { throw Object.assign(new Error("private-message"), { code: "timeout" }); });
  await tick();
  assert.equal(failed.events.at(-1).name, "before_after_failed");
  assert.equal(failed.events.at(-1).properties.error_kind, "timeout");
  assert.ok(!JSON.stringify(failed.events).includes("private-message"));
  let resolve;
  const stale = await comparison(() => new Promise(done => { resolve = done; }));
  stale.unmount(); resolve({ before: { matches: 2 }, after: { matches: 2 }, metrics: [] });
  await tick();
  assert.ok(!stale.events.some(e => e.name === "before_after_completed" || e.name === "before_after_failed"));
});
