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

test('특성 표시 공간도 카드 크기에 포함하고 작은 화면에서는 사진 공간을 우선한다', () => {
  for (const [width,height,mobile] of [[838,622,false],[364,571,true],[294,281,true]]) {
    const layout=layoutPitchCards(players,width,height,mobile,true);
    assert.ok(layout.photoSize>=26);
    assert.ok(layout.traitHeight>=14);
    for (const [key,a] of Object.entries(layout.positions)) {
      assert.ok(a.y-layout.cardHeight/2>=0 && a.y+layout.cardHeight/2<=height,key);
      for (const [other,b] of Object.entries(layout.positions)) if(key!==other)
        assert.ok(Math.abs(a.x-b.x)>=layout.cardWidth || Math.abs(a.y-b.y)>=layout.cardHeight,`${key}/${other}`);
    }
  }
});

test("짧은 모바일의 등록 포지션은 공격·수비 인접 행을 묶어 11명을 겹치지 않게 표시한다", () => {
  const registered = [["GK",50,93],["LS",39,12],["RF",68,22],["LM",13,44],["RM",87,44],
    ["LDM",35,61],["RDM",65,61],["LB",12,73],["LCB",36,82],["RCB",64,82],["RB",88,73]]
    .map(([key,left,top])=>({key,left,top}));
  for (const height of [278,290,328,440]) {
    const layout=layoutPitchCards(registered,294,height,true);
    const boxes=registered.map(p=>({x:layout.positions[p.key].x-layout.cardWidth/2,y:layout.positions[p.key].y-layout.cardHeight/2}));
    for (const [i,a] of boxes.entries()) {
      assert.ok(a.x>=0 && a.y>=0 && a.x+layout.cardWidth<=294 && a.y+layout.cardHeight<=height);
      for (const b of boxes.slice(i+1)) assert.ok(a.x+layout.cardWidth<=b.x || b.x+layout.cardWidth<=a.x || a.y+layout.cardHeight<=b.y || b.y+layout.cardHeight<=a.y);
    }
    assert.ok(layout.positions.LS.y<layout.positions.RF.y);
    assert.ok(layout.positions.GK.y>layout.positions.RCB.y);
  }
});
