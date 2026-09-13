"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeStore, BATCH_OK, markerOk } = require("./helpers.js");

function sealedSetup() {
  const ctx = makeStore();
  const b = ctx.store.addBatch(BATCH_OK).batch;
  ctx.store.addMarker(markerOk(b.id, { code: "A-001" }));
  ctx.store.addMarker(markerOk(b.id, { code: "W-001", type: "wood", x: 58, y: 39 }));
  return { ...ctx, batchId: b.id };
}

test("封存生成只读版本：工作区后续改动不影响版本", () => {
  const { store, batchId } = sealedSetup();
  const r = store.sealWorking({ sealedBy: "张海" });
  assert.equal(r.ok, true);
  assert.equal(r.version.seq, 1);
  assert.equal(r.version.snapshot.markers.length, 2);

  // 版本被深冻结
  assert.ok(Object.isFrozen(store.state.versions[0]));
  assert.ok(Object.isFrozen(store.state.versions[0].snapshot.markers[0]));

  // 工作区继续修改/新增（待续录），版本内容不变
  store.addMarker(markerOk(batchId, { code: "M-001", type: "metal" }));
  store.updateMarker(store.state.markers[0].id, { depth: "99m" });
  const v = store.getVersion(r.version.id);
  assert.equal(v.snapshot.markers.length, 2);
  assert.notEqual(v.snapshot.markers.find(m => m.code === "A-001").depth, "99m");
});

test("差异：与上一版对比新增/变更/移除", () => {
  const { store, batchId } = sealedSetup();
  const v1 = store.sealWorking({ sealedBy: "张海" }).version;
  assert.equal(v1.diff.summary.addedMarkers, 2);
  assert.equal(v1.diff.summary.addedBatches, 1);

  // 新增一条、修改一条、删除一条
  store.addMarker(markerOk(batchId, { code: "M-002", type: "metal" }));
  const w1 = store.state.markers.find(m => m.code === "W-001");
  store.updateMarker(w1.id, { condition: "已加固" });
  const a1 = store.state.markers.find(m => m.code === "A-001");
  store.removeMarker(a1.id);

  const v2 = store.sealWorking({ sealedBy: "张海" }).version;
  assert.equal(v2.seq, 2);
  assert.equal(v2.diff.summary.addedMarkers, 1);
  assert.equal(v2.diff.summary.removedMarkers, 1);
  assert.equal(v2.diff.summary.changedMarkers, 1);
  const changed = v2.diff.markers.changed.find(c => c.code === "W-001");
  assert.deepEqual(changed.changes, [{ field: "condition", before: "边缘残缺", after: "已加固" }]);
  assert.equal(v2.diff.markers.added[0].code, "M-002");
  assert.equal(v2.diff.markers.removed[0].code, "A-001");
});

test("有错误时禁止封存", () => {
  const { store, batchId } = sealedSetup();
  store.state.markers.push({ ...store.state.markers[0], id: "dup-x" }); // 制造重复编号
  const r = store.sealWorking({ sealedBy: "张海" });
  assert.equal(r.ok, false);
  assert.ok(r.issues.errors.some(e => e.rule === "code-duplicate"));
  assert.equal(store.state.versions.length, 0);
});

test("有提醒时需确认后封存", () => {
  const { store, batchId } = sealedSetup();
  store.addMarker(markerOk(batchId, { code: "LATE-1", recordedAt: "2026-09-12T02:00:00.000Z" }));
  const r1 = store.sealWorking({ sealedBy: "张海" });
  assert.equal(r1.ok, false);
  assert.equal(r1.needsConfirm, true);
  assert.equal(store.state.versions.length, 0);
  const r2 = store.sealWorking({ sealedBy: "张海", confirmWarnings: true });
  assert.equal(r2.ok, true);
  assert.equal(store.state.versions.length, 1);
});

test("封存人必填", () => {
  const { store } = sealedSetup();
  const r = store.sealWorking({ sealedBy: "  " });
  assert.equal(r.ok, false);
  assert.ok(r.issues.errors.some(e => e.message.includes("封存人")));
});

test("复制续录：历史版本载入工作区", () => {
  const { store, batchId } = sealedSetup();
  const v1 = store.sealWorking({ sealedBy: "张海" }).version;
  store.addMarker(markerOk(batchId, { code: "EXTRA-1" }));
  assert.equal(store.state.markers.length, 3);
  const r = store.continueFromVersion(v1.id);
  assert.equal(r.ok, true);
  assert.equal(store.state.markers.length, 2);
  assert.deepEqual(store.state.markers.map(m => m.code).sort(), ["A-001", "W-001"]);
});

test("版本摘要稳定且与内容对应", () => {
  const a = sealedSetup();
  const b = sealedSetup();
  // 两个独立实例相同数据 → 快照摘要一致（摘要只覆盖快照内容）
  const va = a.store.sealWorking({ sealedBy: "张海" }).version;
  const vb = b.store.sealWorking({ sealedBy: "张海" }).version;
  assert.equal(va.digest, vb.digest);
  a.store.addMarker({ ...markerOk(a.batchId), code: "NEW-1" });
  const va2 = a.store.sealWorking({ sealedBy: "张海" }).version;
  assert.notEqual(va2.digest, va.digest);
});
