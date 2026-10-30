const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
function load(name) {
  const output = { exports: {} };
  runInNewContext(ts.transpileModule(readFileSync(path.join(__dirname, '../lib', name + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: output.exports, URL, require: dep => load(dep.replace('./', '')) });
  return output.exports;
}
const { shareComparisonMetrics } = load('shareComparison');
const { allowedShareAsset } = load('shareAssetPolicy');
const { shareSquadLayout } = load('shareSquadLayout');
const { compareTrendEndpoints, trendEndpointIndices } = load('trendPeriods');
const metric = (id, unit, before, after, factor = 1) => ({ id, label: id, unit, direction: 'higher', history: [...before, ...after].map(value => ({
  value: null, observed_matches: 1, match: unit === 'rate' ? { success: value, trials: 10, observed: 1, total: 0 } : { success: 0, trials: 0, observed: 1, total: value * factor },
})) });
const trends = metrics => ({ points: Array.from({ length: 12 }, () => ({ date: '2026-10-28', match_type: 60 })), groups: [{ id: 'g', metrics }] });
test('공유 변화 순서는 단위 배율·원본 순서와 관계없이 같고 합산 성공률을 보존한다', () => {
  const a = metric('a', 'average', [1, 2, 1, 2, 1, 2], [5, 6, 5, 6, 5, 6]);
  const b = metric('b', 'rate', [2, 3, 2, 3, 2, 3], [5, 6, 5, 6, 5, 6]);
  const result = shareComparisonMetrics(trends([a, b]), 6);
  assert.deepEqual(Array.from(result, m => m.id), Array.from(shareComparisonMetrics(trends([b, { ...a, history: a.history.map(p => ({ ...p, match: { ...p.match, total: p.match.total * 1000 } })) }]), 6), m => m.id));
  assert.equal(result.find(m => m.id === 'b').after.value, 33 / 60);
  assert.equal(result.find(m => m.id === 'b').before.value, 15 / 60);
});
test('전후 기록·시도가 없으면 순위를 채우지 않고 중복 실점은 한 번만 보여준다', () => {
  const a = metric('overview:goals_against', 'goals', [1, 2, 1, 2, 1, 2], [5, 6, 5, 6, 5, 6]);
  const b = { ...a, id: 'defending:goals_against' };
  assert.equal(shareComparisonMetrics(trends([a, b]), 6).length, 1);
  assert.equal(shareComparisonMetrics(trends([a]), 0).length, 0);
  assert.equal(shareComparisonMetrics(trends([a]), 11).length, 0);
  const rare = metric('rare', 'rate', [0, 1, 0, 1, 0, 1], [1, 1, 1, 1, 1, 1]);
  rare.history.forEach(p => p.match.trials = 1);
  assert.equal(shareComparisonMetrics(trends([rare]), 6).length, 0);
});
test('공유 이미지 프록시는 공식 CDN 이미지만 허용하고 외부 주소·자격증명·리다이렉트 입력을 막는다', () => {
  for (const url of ['https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/playersHigh/p123.png', 'https://ssl.nexon.com/s2/game/fc/online/season/PTG.png']) assert.ok(allowedShareAsset(url));
  for (const url of ['http://127.0.0.1/a.png', 'https://fco.dn.nexoncdn.co.kr.evil.test/live/externalAssets/common/a.png', 'https://ssl.nexon.com/private/a.png', 'https://u:p@ssl.nexon.com/s2/game/fc/a.png', 'https://ssl.nexon.com/s2/game/fc/a.svg', 'https://ssl.nexon.com/s2/game/fc/../../private.png']) assert.equal(allowedShareAsset(url), null);
});
test('스쿼드 전체 이름은 이미지 안에 들어가고 수비수 네 명과 GK가 겹치지 않는다', () => {
  const players = ['LS', 'RF', 'LM', 'RM', 'LDM', 'RDM', 'LB', 'LCB', 'RCB', 'RB', 'GK'].map((position, i) => ({ position, key: String(i), name: '긴 선수 이름', spId: i, grade: 9 }));
  const layout = shareSquadLayout(players);
  for (const p of layout) { assert.ok(p.x - p.nameWidth / 2 >= 36); assert.ok(p.x + p.nameWidth / 2 <= 1044); }
  const defenders = layout.filter(p => ['LB', 'LCB', 'RCB', 'RB'].includes(p.position));
  assert.equal(new Set(defenders.map(p => p.y)).size, 1);
  for (let i = 1; i < defenders.length; i++) assert.ok(defenders[i].x - defenders[i - 1].x >= defenders[i].nameWidth);
  assert.ok(layout.find(p => p.position === 'GK').y - defenders[0].y >= 160);
});
test('기준 경기가 없으면 초반·최근의 같은 집계 크기를 비교하고 비율은 성공·시도를 사용한다', () => {
  const data = { points: Array.from({length: 6}, () => ({window_matches: 30})), groups: [{ id: 'g', metrics: [{
    id: 'passing:pass', label: '패스 성공률', unit: 'rate', direction: 'higher',
    history: Array.from({length: 6}, (_, i) => ({value: .8 + i * .02, observed_matches: 30, success: 80 + i * 2, trials: 100})),
  }] }] };
  const compared = compareTrendEndpoints(data);
  assert.equal(compared[0].before.value, .8);
  assert.equal(compared[0].after.value, .9);
  assert.equal(compared[0].before.matches, 30);
  assert.equal(shareComparisonMetrics(data, null)[0].after.trials, 100);
  assert.equal(shareComparisonMetrics(data, null)[0].before.success, 80);
  data.groups[0].metrics[0].direction = 'neutral';
  assert.equal(shareComparisonMetrics(data, null).length, 0);
  data.groups[0].metrics[0].direction = 'higher';
  data.groups[0].metrics[0].history[5].trials = undefined;
  assert.equal(compareTrendEndpoints(data).length, 0);
});
test('집계 크기가 다를 때는 확보된 초반 시점을 명시하며 한 시점만 있으면 비교값을 만들지 않는다', () => {
  const data = { points: [3, 4, 5, 6, 7, 8].map(window_matches => ({window_matches})), groups: [] };
  assert.equal(trendEndpointIndices(data).first, 2);
  assert.equal(trendEndpointIndices(data).last, 5);
  assert.equal(compareTrendEndpoints({points: [{window_matches: 30}], groups: []}).length, 0);
  assert.equal(shareComparisonMetrics({points: [], groups: []}, null).length, 0);
});
