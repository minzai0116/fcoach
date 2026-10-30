const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {runInNewContext}=require('node:vm');
const {webcrypto}=require('node:crypto');
const ts=require('typescript');

function harness(api) {
  const timers=new Map();let id=0;
  const module={exports:{}};
  const source=ts.transpileModule(readFileSync(`${__dirname}/../lib/analysisRequest.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(source,{exports:module.exports,crypto:webcrypto,require:()=>({requestApi:api}),
    setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:key=>timers.delete(key)});
  return {request:module.exports.requestAnalysis,timers,tick:async()=>{const [key,fn]=timers.entries().next().value;timers.delete(key);await fn();}};
}

test('진행 조회의 일시 실패는 분석 요청을 중단하지 않고 완료 뒤 타이머를 정리한다',async()=>{
  let complete,body,options;
  const h=harness((path,init,opts)=>{
    if(path==='/analysis/run'){body=JSON.parse(init.body);options=opts;return new Promise(resolve=>{complete=resolve;});}
    return Promise.reject(new Error('progress unavailable'));
  });
  const stages=[];const result=h.request({ouid:'test-user'},p=>stages.push(p.stage));
  assert.match(body.progress_id,/^[a-f0-9]{32}$/);
  assert.equal(options.timeoutMs,120000);
  await h.tick();
  assert.equal(h.timers.size,1);
  complete({sample_count:30});
  assert.equal((await result).sample_count,30);
  assert.equal(h.timers.size,0);
  assert.deepEqual(stages,['accepted']);
});

test('서버가 알린 실제 단계만 전달하고 분석 종료 뒤 도착한 진행 응답은 무시한다',async()=>{
  let complete,respond;
  const h=harness(path=>path==='/analysis/run'?new Promise(resolve=>{complete=resolve;}):new Promise(resolve=>{respond=resolve;}));
  const stages=[];const result=h.request({},p=>stages.push(p.stage));
  const polling=h.tick();
  complete({sample_count:30});await result;
  respond({status:'running',stage:'rankers',label:'비교 중'});await polling;
  assert.deepEqual(stages,['accepted']);assert.equal(h.timers.size,0);
});

test('완료율 추정 없이 현재 작업을 표시하고 실패 시에도 타이머를 정리한다',async()=>{
  let fail;
  const h=harness(path=>path==='/analysis/run'?new Promise((_,reject)=>{fail=reject;}):Promise.resolve({status:'running',stage:'matches',label:'경기 기록 조회'}));
  const stages=[];const result=h.request({},p=>stages.push(p));
  await h.tick();
  assert.equal(stages.at(-1).stage,'matches');
  assert.ok(stages.every(stage=>!('percent' in stage)));
  fail(new Error('analysis unavailable'));await assert.rejects(result,/analysis unavailable/);
  assert.equal(h.timers.size,0);
});
