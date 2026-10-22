const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const ts = require("typescript");
const compiled = { exports: {} };
runInNewContext(ts.transpileModule(readFileSync(`${__dirname}/../lib/pitchCardLayout.ts`, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, compiled);
const { layoutPitchCards } = compiled.exports;
const players = [
  ["GK", 50, 92.24], ["RB", 78.1938, 85.1894], ["RCB", 59.4255, 84.588],
  ["LCB", 40.1483, 85.4321], ["LB", 22.7991, 83.7122],
  ["RDM", 58.6969, 68.4758], ["LDM", 40.5202, 68.6868],
  ["RM", 82.8256, 52.5429], ["LM", 16.8614, 50.0106],
  ["RF", 59.9438, 32.4106], ["LS", 44.3963, 13.8398]
].map(([key, left, top]) => ({ key, left, top }));

for (const [width, height, mobile] of [[838, 622, false], [612, 569, false], [507, 422, false],
  [364, 571, true], [294, 427, true], [294, 328, true]]) {
  test(`사진과 정보가 함께 놓이는 포메이션 ${width}×${height}`, () => {
    const original = JSON.stringify(players);
    const layout = layoutPitchCards(players, width, height, mobile);
    const boxes = players.map(player => {
      const center = layout.positions[player.key];
      return { key: player.key, x: center.x - layout.cardWidth / 2, y: center.y - layout.cardHeight / 2,
        right: center.x + layout.cardWidth / 2, bottom: center.y + layout.cardHeight / 2 };
    });
    boxes.forEach((box, index) => {
      assert.ok(box.x >= 0 && box.y >= 0 && box.right <= width && box.bottom <= height, box.key);
      for (const other of boxes.slice(index + 1)) assert.ok(box.right <= other.x || other.right <= box.x ||
        box.bottom <= other.y || other.bottom <= box.y, `${box.key}/${other.key}`);
    });
    for (const [left, right] of [["LB", "LCB"], ["LCB", "RCB"], ["RCB", "RB"], ["LDM", "RDM"], ["LM", "RM"]])
      assert.ok(layout.positions[left].x < layout.positions[right].x, "좌우 순서 유지");
    assert.ok(layout.positions.GK.y > layout.positions.RCB.y, "골키퍼와 수비수 분리");
    assert.ok(layout.positions.LS.y < layout.positions.RF.y, "전방 선수의 앞뒤 순서 유지");
    assert.equal(JSON.stringify(players), original, "원본 좌표 변경 없음");
  });
}

test("빈 포메이션", () => assert.equal(Object.keys(layoutPitchCards([], 300, 400).positions).length, 0));
