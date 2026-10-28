const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');
const moduleContext = { exports: {} };
runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/../lib/uiConstants.ts`, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, moduleContext);
const nav = moduleContext.exports;
test('경기 분석의 세 화면은 모두 같은 주 메뉴에 속한다', () => {
  for (const screen of ['diagnosis', 'players', 'matches']) {
    assert.equal(nav.primaryScreen(screen), 'diagnosis');
    assert.equal(nav.screenFromPath(nav.SCREEN_PATHS[screen]), screen);
  }
  assert.equal(nav.primaryScreen('actions'), 'actions');
  assert.equal(nav.SCREEN_FLOW.length, 5);
});
test('기존 주소와 뒤로가기에 쓰는 경로 해석을 유지한다', () => {
  assert.equal(nav.screenFromPath('/habits/'), 'players');
  assert.equal(nav.screenFromPath('/players'), 'players');
  assert.equal(nav.screenFromPath('/coaching'), 'actions');
  assert.equal(nav.screenFromPath('/missing'), null);
});
