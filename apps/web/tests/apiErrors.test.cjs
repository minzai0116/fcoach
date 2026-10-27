const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

function client(detail, status) {
  const module = { exports: {} };
  runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/../lib/apiClient.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: module.exports, require: () => ({ API_BASE_URL: 'http://localhost' }),
    AbortController, DOMException, setTimeout, clearTimeout,
    fetch: async () => ({ ok: false, status, json: async () => ({ detail }) }),
  });
  return module.exports;
}

test('구조화된 오류에서 안내·복구 동작·원인 코드를 보존한다', async () => {
  const api = client({ message: '경기 목록을 다시 불러오세요.', code: 'match_range_expired', action: 'reload_matches' }, 409);
  await assert.rejects(api.requestApi('/analysis/run'), error => {
    assert.equal(error.message, '경기 목록을 다시 불러오세요.');
    assert.equal(error.reason, 'match_range_expired');
    assert.equal(error.action, 'reload_matches');
    assert.equal(error.status, 409);
    return true;
  });
});

test('이전 서버의 문자열 오류 안내도 그대로 읽는다', async () => {
  await assert.rejects(client('선택 조건을 바꿔주세요.', 400).requestApi('/analysis/run'), /선택 조건을 바꿔주세요/);
});
