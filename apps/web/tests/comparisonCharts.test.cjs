const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');
const render = (type, props) => typeof type === 'function' ? type(props) : ({ type, props });
function load(file, parent = `${__dirname}/../components/coaching`) {
  const base = path.resolve(parent, file);
  const source = [base, base + '.tsx', base + '.ts'].find(p => existsSync(p));
  const output = { exports: {} };
  runInNewContext(ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: output.exports, require: name => name === 'react' ? { useState: initial => [initial, () => {}], useRef: () => ({current:null}), useEffect: () => {}, useMemo: fn => fn(), useId: () => 'test-id' } : name === 'react/jsx-runtime'
    ? { jsx: render, jsxs: render, Fragment: 'fragment' } : load(name, path.dirname(source)) });
  return output.exports;
}
const chart = load('MetricComparisonCards');
test('직접 비교는 % 차이와 %p 차이를 구분하고 결측을 0으로 만들지 않는다', () => {
  assert.equal(chart.comparisonGap(.808, .772, 'rate'), '+3.6%p');
  assert.equal(chart.comparisonGap(.5, .6, 'rate'), '−10.0%p');
  assert.equal(chart.comparisonGap(2.3, 2, 'goals'), '+0.3골');
  assert.equal(chart.comparisonGap(null, .2, 'rate'), null);
  assert.equal(chart.comparisonValue(null, 'rate'), '—');
});
test('장점·보완점이 없으면 빈 안내 카드 대신 그래프만 표시한다', () => {
  const component = load('OpponentComparisonPanel');
  const result = component.OpponentComparisonPanel({ comparison: { note: '기준', metrics: [{ metric: 'pass', label: '패스', status: 'no_clear_change',
    mine: { value: .8, matches: 30 }, opponent: { value: .79, matches: 30 } }] }, modeCounts: { 50: 2, 60: 28 } });
  const tree = JSON.stringify(result);
  assert.ok(tree.includes('metric-paired-bars'));
  assert.ok(tree.includes('+1.0%p'));
  assert.ok(!tree.includes('comparison-findings'));
  assert.ok(!tree.includes('확인되지 않았습니다'));
});
test('비교할 수치 자체가 없으면 상대 비교 영역도 숨긴다', () => {
  assert.equal(load('OpponentComparisonPanel').OpponentComparisonPanel({ comparison: { metrics: [] } }), null);
});

test('낮을수록 좋은 실점 지표는 감소가 파랑이고 증가는 빨강이다', () => {
  const { differenceTone } = load('../../lib/comparisonInsights');
  assert.equal(differenceTone(1, 2, 'lower'), 'better');
  assert.equal(differenceTone(3, 2, 'lower'), 'worse');
  assert.equal(differenceTone(.9, .8, 'higher'), 'better');
  assert.equal(differenceTone(.7, .8, 'higher'), 'worse');
  assert.equal(differenceTone(.6, .5, 'neutral'), 'neutral');
  assert.equal(differenceTone(null, .5, 'higher'), 'neutral');
  assert.equal(differenceTone(.8001, .8, 'higher', 'rate'), 'neutral');
});
test('변화 요약은 중립 지표·결측·중복 득점 지표를 제외하고 실제 집계 수를 보존한다', () => {
  const { notableTrends } = load('../../lib/comparisonInsights');
  const history = Array.from({ length: 12 }, (_, i) => ({ value: .2 + i * .02, observed_matches: i + 3 }));
  const data = { points: history.map((_, i) => ({ window_matches: i + 3 })), groups: [{ id: 'overview', metrics: [
    { id: 'overview:goals_for', label: '득점', unit: 'goals', direction: 'higher', history },
    { id: 'shooting:goals', label: '중복득점', unit: 'goals', direction: 'higher', history },
    { id: 'overview:possession', label: '점유율', unit: 'percent', direction: 'neutral', history },
  ] }] };
  const result = notableTrends(data);
  assert.equal(result.length, 1);
  assert.equal(result[0].tone, 'better');
  assert.equal(result[0].firstWindow, 5);
  assert.equal(result[0].lastWindow, 14);
});
test('슈팅 유형 필터는 공식 유형·미확인 코드·미제공을 구분한다', () => {
  const { shotTypeLabel, filterShotsByType } = load('../../lib/shotTypes');
  const points = [{ type: 2 }, { type: 3 }, { type: 14 }, { type: null }];
  assert.equal(shotTypeLabel(2), '감아차기');
  assert.ok(shotTypeLabel(14).includes('코드 14'));
  assert.equal(filterShotsByType(points, '2').length, 1);
  assert.equal(filterShotsByType(points, 'unknown')[0].type, null);
  assert.equal(filterShotsByType(points, '14')[0].type, 14);
  assert.equal(filterShotsByType(points, 'all'), points);
});

test('변화 요약은 드문 유형의 소수 시도 성공률을 큰 변화로 선정하지 않는다', () => {
  const { notableTrends } = load('../../lib/comparisonInsights');
  const history = Array.from({length:12}, (_, i) => ({value: 1 - i * .05, observed_matches: 30, trials: 4}));
  const data = {points: history.map(() => ({window_matches:30})), groups:[{id:'passing', metrics:[
    {id:'passing:rare', label:'드문 패스', unit:'rate', direction:'higher', history}
  ]}]};
  assert.deepEqual(notableTrends(data), []);
});

test('영역 점수는 나와 랭커 점수를 함께 표시하고 미확인을 0점으로 만들지 않는다', () => {
  const { DomainScorePanel } = load('DomainScorePanel');
  assert.equal(DomainScorePanel({}), null);
  assert.equal(DomainScorePanel({data:{areas:[{mine:null}]}}), null);
  const data = {note:'계산 기준', method:'ranker_usage_weighted_p90_v4', areas:[
    {id:'overview',label:'경기 종합',mine:71.7,reference:86.4,metrics:[],advice:[]},
    {id:'passing',label:'패스',mine:null,reference:null,metrics:[],advice:[]}
  ]};
  const tree = JSON.stringify(DomainScorePanel({data}));
  assert.ok(tree.includes('경기 종합 72점 세부 지표 보기'));
  assert.ok(tree.includes('dialog'));
  assert.ok(!tree.includes('>나<'));
  assert.ok(tree.includes('패스 —점 세부 지표 보기'));
  assert.ok(tree.includes('disabled'));
  assert.ok(!tree.includes('나 0점'));
  assert.ok(tree.includes('랭커 상위 10% = 100점'));
  assert.ok(!tree.includes('90점 기준'));
  assert.ok(tree.includes('tone-worse'));
  assert.ok(!tree.includes('domain-score-gap'));
  assert.equal(DomainScorePanel({data:{...data,method:'relative_ratio_equal_metric_mean_v1'}}), null);
});

test('세부 점수는 성공률·사용 비중·영향과 행동만 간결하게 표시한다', () => {
  const { DomainScoreDetails } = load('DomainScoreDetails');
  const area = {id:'passing',label:'패스',mine:70,reference:86,advice:[{title:'패스 연결',play:'가까운 동료에게 연결하세요.',tactic:'지원 역할',metric_id:'pass',evidence:'패스 성공률'}],metrics:[
    {id:'pass',label:'패스 성공률',mine:.8,reference:.9,unit:'rate',direction:'higher',score:70,reference_score:86,point_impact:-16,target:.95,spread:.1,status:'weakness',section:'유형별',usage:.25,reference_usage:.2,weight:1}
  ]};
  const tree = JSON.stringify(DomainScoreDetails({area,areas:[area],onSelect:()=>{},onClose:()=>{}}));
  for (const text of ['80.0%', '90.0%', '25.0%', '20.0%', '패스 연결', '가까운 동료에게 연결하세요.', '세부 점수 닫기']) assert.ok(tree.includes(text), text);
  assert.ok(!tree.includes('영향'));
  assert.ok(!tree.includes('\"children\":\"나\"'));
  for (const text of ['평균입니다', '개선 제안은 원래', '표준편차', '100점 기준', '원인을 확정']) assert.ok(!tree.includes(text));
});

test('선수 비교는 관측 경기별 횟수와 합산 성공률을 사용하고 결측은 채우지 않는다', () => {
  const {pairPlayerMetrics} = load('../../lib/playerComparison');
  const player = (matches, total, success, trials) => ({observations:[{metric:'goals',total,observed_matches:matches}],measurements:[{metric:'pass',label:'패스 성공률',success,trials,observed_matches:matches}]});
  const pairs = pairPlayerMetrics(player(10,10,1,2), player(20,10,9,10));
  assert.equal(pairs[0].mine.value, 1);
  assert.equal(pairs[0].reference.value, .5);
  assert.equal(pairs[1].mine.value, .5);
  assert.equal(pairs[1].reference.value, .9);
  const absent = pairPlayerMetrics(player(0,0,0,0), player(20,0,0,10));
  assert.equal(absent.find(row=>row.reference?.id==='goals').mine, undefined);
  assert.equal(absent.find(row=>row.reference?.id==='pass').mine.value, null);
  assert.equal(absent.find(row=>row.reference?.id==='pass').reference.value, 0);
});

test('선수 비교의 드리블 거리는 m로 환산하되 우열을 만들지 않는다', () => {
  const {playerComparisonMetrics} = load('../../lib/playerComparison');
  const item = playerComparisonMetrics({observations:[{metric:'dribble_distance',total:1000,observed_matches:10}],measurements:[]})[0];
  assert.equal(item.value, 91.44);
  assert.equal(item.unit, 'meters');
  assert.equal(item.direction, 'neutral');
});

test('슈팅 선수와 유형 필터는 교집합이며 시즌이 달라도 같은 선수로 찾는다', () => {
  const {filterShotsByType, filterShotsByPlayer, shotPlayerKey} = load('../../lib/shotTypes');
  const shots = [{sp_id:100123456,type:2},{sp_id:200123456,type:3},{sp_id:100654321,type:2},{player_name:'미제공',type:null}];
  const player = shotPlayerKey(shots[0]);
  assert.equal(filterShotsByPlayer(shots,player).length,2);
  assert.equal(filterShotsByType(filterShotsByPlayer(shots,player),'2').length,1);
  assert.equal(filterShotsByType(filterShotsByPlayer(shots,player),'14').length,0);
  assert.equal(filterShotsByPlayer(shots,'all'),shots);
  const {InteractiveShotMap} = load('InteractiveShotMap');
  const tree = JSON.stringify(InteractiveShotMap({points:shots.map(p=>({...p,x:.8,y:.5}))}));
  assert.ok(tree.includes('슈팅 선수별 보기'));
  assert.ok(!tree.includes('선수·시간으로 찾기'));
});

test('팀 지표의 비교값은 m 단위와 실제 랭커 사용 비중을 보존한다', () => {
  const {teamComparisons,TeamMetricComparison} = load('TeamMetricComparison');
  const metric = {id:'shooting:box_outside', label:'박스 밖 득점 전환율',unit:'rate',direction:'higher',matches:30,value:.138,usage_share:.2};
  const pairs = teamComparisons([{metrics:[metric]}],{groups:[{metrics:[{...metric,value:.25,usage_share:.3}]}]});
  const tree = JSON.stringify(TeamMetricComparison({pairs,ids:[metric.id],includeUsage:true}));
  for (const text of ['13.8%','25.0%','20.0%','30.0%','−11.2%p','사용 비중']) assert.ok(tree.includes(text),text);
});
test('점수 차이는 반올림으로 생긴 음수 0을 표시하지 않는다', () => {
  const {scoreDifference} = load('../../lib/domainScoreDisplay');
  assert.equal(scoreDifference(80.01, 80.02), '0.0점');
  assert.equal(scoreDifference(80, 86), '−6.0점');
});
