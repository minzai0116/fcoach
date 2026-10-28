const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');
const render = (type, props) => typeof type === 'function' ? type(props) : ({ type, props });
let detailTab = 'record';
function load(file, parent = `${__dirname}/../components/coaching`) {
  const base = path.resolve(parent, file);
  const source = [base, base + '.tsx', base + '.ts'].find(p => existsSync(p));
  const output = { exports: {} };
  runInNewContext(ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: output.exports, require: name => name === 'react' ? { useState: initial => [initial === 'record' ? detailTab : initial, () => {}], useRef: () => ({current:null}), useEffect: () => {}, useMemo: fn => fn(), useId: () => 'test-id' } : name === 'react/jsx-runtime'
    ? { jsx: render, jsxs: render, Fragment: 'fragment' } : load(name, path.dirname(source)) });
  return output.exports;
}
const chart = load('MetricComparisonCards');
const traitIcons = tree => tree.props.children[0].props.children.flat().filter(item=>item?.type==='img');
test('선수 선택은 긴 영문 시즌 설명을 줄이되 이름·시즌·강화·포지션은 보존한다', () => {
  const {playerOptionLabel}=load('../../lib/playerComparison');
  assert.equal(playerOptionLabel({player_name:'페데리코 발베르데',season_name:'25 UCL (25 UEFA Champions League)',sp_grade:10,position_name:'RM'}),'페데리코 발베르데 · 25 UCL +10 · RM');
  assert.equal(playerOptionLabel({player_name:'카카',season_name:'',sp_grade:8,position_name:'RF'}),'카카 · +8 · RF');
});
test('강화만 다른 피드는 저장된 특성·코치·전술을 보여주고 경기의 강화와 능력치는 유지한다', () => {
  const { savedPlayerSettings } = load('../../lib/playerTraits');
  const source = {sp_id:877138449,grade:9,position:'RF',overall:145,
    intrinsic_features:{status:'present',value:[{code:65,known:true,label:'라인브레이커',icon_url:'linebreaker'}]},
    acquired_traits:{status:'present',value:[{code:63,known:true,label:'두 개의 심장',icon_url:'hearts'}]},
    training_coach:{status:'present',value:[{code:1,known:true,label:'침투 요청 즉각 반응',icon_url:'coach'}]},
    personal_tactics:{status:'present',value:[{label:'뒤에서 침투'}]},participation:{status:'present',value:[3,1]}};
  assert.equal(savedPlayerSettings(source,877138449,'RF'),source);
  assert.equal(savedPlayerSettings(source,877138449,'LS'),undefined);
  assert.equal(savedPlayerSettings(source,863231747,'RF'),undefined);
  detailTab='settings';
  try {
    const {PlayerDetailPanel}=load('PlayerDetailPanel');
    const tree=JSON.stringify(PlayerDetailPanel({player:{key:'kaka',spId:877138449,grade:8,position:'RF',name:'카카',traitSource:source,
      comparison:{label:'강화 불일치',linked:false}},id:'detail',onBack:()=>{}}));
    for (const label of ['피드 저장 설정','9강','8강','라인브레이커','두 개의 심장','침투 요청 즉각 반응','뒤에서 침투','공격 3 · 수비 1']) assert.ok(tree.includes(label),label);
    assert.ok(!tree.includes('강화 불일치'));
    assert.ok(!tree.includes('player-saved-overall'));
  } finally { detailTab='record'; }
});
test('포메이션 카드는 기본·획득 신규 특성만 두 개까지 표시하고 급여 결측을 숫자로 만들지 않는다', () => {
  const {PitchPlayerAppearance}=load('PitchPlayerAppearance');
  const player={spId:863231747,grade:9,name:'킬리안 음바페',position:'LS',settings:{overall:150,salary:31,
    intrinsic_features:{status:'present',value:[65,13].map(code=>({code,known:true,label:`특성 ${code}`,icon_url:`icon-${code}`}))},
    acquired_traits:{status:'present',value:[22,63,55].map(code=>({code,known:true,label:`특성 ${code}`,icon_url:`icon-${code}`}))}}};
  const tree=PitchPlayerAppearance({player});
  const traits=traitIcons(tree);
  assert.deepEqual(Array.from(traits,item=>item.props.alt),['특성 65','특성 63']);
  assert.ok(JSON.stringify(tree).includes('급여 31'));
  const single=PitchPlayerAppearance({player:{...player,settings:{...player.settings,
    acquired_traits:{status:'unset',value:[]}}}});
  assert.equal(traitIcons(single).length,1);
  const empty=JSON.stringify(PitchPlayerAppearance({player:{...player,settings:{acquired_traits:{status:'unset',value:[]}}}}));
  assert.ok(!empty.includes('pitch-salary'));
  assert.ok(!empty.includes('icon-'));
  assert.ok(!empty.includes('pitch-overall'));
});
test('벤제마·음바페는 포지션이 달라도 같은 카드의 피드 특성을 찾고 추아메니의 다른 강화는 출처를 보존한다', () => {
  const {feedTraitResolver,traitSourceLabel}=load('../../lib/playerTraits');
  const benzema={sp_id:846165153,grade:10,position:'RF'},mbappe={sp_id:863231747,grade:9,position:'LS'},tchouameni={sp_id:851241637,grade:10,position:'RCB'};
  const feed={author_status:'matched',mode_status:'matched',snapshot:{players:[benzema,mbappe,tchouameni]}};
  const resolve=feedTraitResolver(feed);
  assert.equal(resolve(846165153,10),benzema);
  assert.equal(resolve(863231747,9),mbappe);
  assert.equal(resolve(851241637,9),tchouameni);
  assert.equal(traitSourceLabel(resolve(851241637,9),9),'피드 10강');
  assert.equal(traitSourceLabel(resolve(863231747,9),9),'');
  assert.equal(resolve(866241637,9),undefined,'다른 시즌의 같은 선수를 대입하지 않음');
  assert.equal(feedTraitResolver({...feed,author_status:'mismatch'})(846165153,10),undefined);
  assert.equal(feedTraitResolver({...feed,mode_status:'mismatch'})(846165153,10),undefined);
  const ambiguous=feedTraitResolver({...feed,snapshot:{players:[tchouameni,{...tchouameni,grade:11}]}});
  assert.equal(ambiguous(851241637,10),tchouameni);
  assert.equal(ambiguous(851241637,9),undefined,'피드에 여러 강화가 있으면 임의 선택하지 않음');
});
test('피드 특성 표시는 다른 강화의 능력치·급여·현재 강화 단계를 덮어쓰지 않는다', () => {
  const {PitchPlayerAppearance}=load('PitchPlayerAppearance');
  const traitSource={grade:10,overall:150,salary:31,intrinsic_features:{status:'present',value:[{code:54,known:true,label:'체이서',icon_url:'chaser'}]},
    acquired_traits:{status:'present',value:[{code:56,known:true,label:'파이터',icon_url:'fighter'}]}};
  const tree=PitchPlayerAppearance({player:{spId:851241637,grade:9,name:'A. 추아메니',position:'RCB',traitSource}});
  assert.deepEqual(Array.from(traitIcons(tree),item=>item.props.alt),['체이서','파이터']);
  const serialized=JSON.stringify(tree);
  assert.ok(serialized.includes('피드 10강'));
  assert.ok(serialized.includes('9강'));
  assert.ok(!serialized.includes('pitch-overall'));
  assert.ok(!serialized.includes('pitch-salary'));
});
test('신규 특성은 기본·획득의 중복을 제거하고 회색 특성이나 미확인 코드는 포함하지 않는다', () => {
  const {newPlayerTraits}=load('../../lib/playerTraits');
  const field=codes=>({status:'present',value:codes.map(code=>({code,known:true,label:String(code),icon_url:`icon-${code}`}))});
  assert.deepEqual(Array.from(newPlayerTraits({intrinsic_features:field([52,13]),acquired_traits:field([52,55,22])}),f=>f.code),[52,55]);
  assert.deepEqual(Array.from(newPlayerTraits({intrinsic_features:field([20,21,23]),acquired_traits:field([68,49])}),f=>f.code),[68]);
  assert.equal(newPlayerTraits({intrinsic_features:field([13,22]),acquired_traits:field([49,69])}).length,0);
  assert.equal(newPlayerTraits().length,0);
});
test('선택 사진은 같은 선수에게만 연결하고 다른 사용자의 피드는 적용하지 않는다', () => {
  const {feedPortraits}=load('../../lib/pitchLineup');
  const feed={author_status:'matched',snapshot:{players:[{sp_id:863231747,portrait_img:'saved-image'}]}};
  assert.equal(feedPortraits(feed).get(231747),'saved-image');
  assert.equal(feedPortraits(feed).get(252371),undefined);
  assert.equal(feedPortraits({...feed,author_status:'mismatch'}).size,0);
});
test('직접 비교는 % 차이와 %p 차이를 구분하고 결측을 0으로 만들지 않는다', () => {
  assert.equal(chart.comparisonGap(.808, .772, 'rate'), '+3.6%p');
  assert.equal(chart.comparisonGap(.5, .6, 'rate'), '−10.0%p');
  assert.equal(chart.comparisonGap(2.3, 2, 'goals'), '+0.3골');
  assert.equal(chart.comparisonGap(null, .2, 'rate'), null);
  assert.equal(chart.comparisonValue(null, 'rate'), '—');
});
test('상대보다 앞서거나 낮은 지표가 없으면 고정 다섯 그래프를 강제로 표시하지 않는다', () => {
  const component = load('OpponentComparisonPanel');
  const result = component.OpponentComparisonPanel({ comparison: { note: '기준', metrics: [{ metric: 'pass', label: '패스', status: 'no_clear_change',
    mine: { value: .8, matches: 30 }, opponent: { value: .79, matches: 30 } }] }, modeCounts: { 50: 2, 60: 28 } });
  assert.equal(result, null);
});

test('상대 비교는 실제 차이가 큰 순으로 양쪽 세 개씩만 고르고 결측을 제외한다', () => {
  const {opponentHighlights} = load('../../lib/comparisonInsights');
  const rows = [-1, 3, -4, 5, 2, -6, 7, -8].map((gap,i)=>({metric:String(i),status:gap>0?'higher':'lower',gap_pp:gap,
    mine:{value:.5+gap/100},opponent:{value:.5}}));
  rows.push({metric:'missing',status:'higher',gap_pp:90,mine:{value:null},opponent:{value:.5}});
  const result = opponentHighlights(rows);
  assert.deepEqual(Array.from(result.strengths, item=>item.gap_pp),[7,5,3]);
  assert.deepEqual(Array.from(result.weaknesses, item=>item.gap_pp),[-8,-6,-4]);
});

test('선수 비교는 우열에 따라 막대 색이 바뀌지 않고 두 선수 색을 고정한다', () => {
  const tree = JSON.stringify(chart.MetricComparisonCards({identityColors:true,tone:'purple',mineLabel:'A',referenceLabel:'B',metrics:[{
    mine:{id:'pass',label:'패스',unit:'rate',direction:'higher',value:.3,matches:10},
    reference:{id:'pass',label:'패스',unit:'rate',direction:'higher',value:.8,matches:20}
  }]}));
  assert.ok(tree.includes('identity-comparison'));
  assert.ok(tree.includes('identity-gap'));
  assert.ok(!tree.includes('tone-worse'));
  assert.ok(!tree.includes('tone-neutral'));
});

test('랭커 강점과 보완점은 각각 제목·개수가 있는 독립 영역으로 표시한다', () => {
  const {RankerHighlights} = load('RankerHighlights');
  const metric = {id:'pass',label:'패스',unit:'rate',direction:'higher',value:.8,matches:20};
  const finding = {id:'pass',mine:metric,reference:{...metric,value:.7}};
  const tree = JSON.stringify(RankerHighlights({data:{ranker_count:20,strengths:[finding],weaknesses:[finding]},group:undefined}));
  assert.ok(tree.includes('finding-better'));
  assert.ok(tree.includes('finding-worse'));
  assert.ok(tree.includes('강점 지표'));
  assert.ok(tree.includes('보완 지표'));
  assert.ok(!tree.includes('내 최근 30경기'));
});

test('포메이션 선수 변경은 같은 자리 한 명만 교체하고 다른 자리 선택은 무시한다', () => {
  const {selectedPitchLineup,pitchPositionOptions} = load('../../lib/pitchLineup');
  const a={key:'a',position:'LS',record:{}}, b={key:'b',position:'LS',record:{}}, c={key:'c',position:'GK',record:{}};
  const records=new Map([a,b,c].map(p=>[p.key,p]));
  const selected=selectedPitchLineup([a,c],records,{LS:'b',GK:'b'});
  assert.deepEqual(Array.from(selected,p=>p.key),['b','c']);
  const options=pitchPositionOptions(records.values(),[a,c]);
  assert.equal(options.length,1);
  assert.equal(options[0][0],'LS');
  assert.equal(options[0][1].length,2);
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
