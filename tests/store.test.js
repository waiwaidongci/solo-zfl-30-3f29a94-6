"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeStore, makeCtx, BATCH_OK, markerOk } = require("./helpers.js");
const { EvidenceStore } = require("../src/core/store.js");
const { createMemoryStorage } = require("../src/core/storage.js");
const model = require("../src/core/model.js");

test("状态持久化：同一存储重开数据仍在", () => {
  const ctx = makeCtx();
  const s1 = new EvidenceStore(ctx);
  const b = s1.addBatch(BATCH_OK).batch;
  s1.addMarker(markerOk(b.id));
  const s2 = new EvidenceStore({ ...ctx, id: s1._id });
  assert.equal(s2.state.batches.length, 1);
  assert.equal(s2.state.markers.length, 1);
  assert.equal(s2.state.markers[0].code, "A-001");
});

test("旧版 zfl30Marks 数据自动迁移进默认批次", () => {
  const storage = createMemoryStorage({
    zfl30Marks: JSON.stringify([
      { id: "old-1", code: "A-017", type: "ceramic", dive: "DIVE-01", x: 42, y: 46, depth: "17.8m", orientation: "东", condition: "边缘残缺", note: "靠近船肋" },
      { id: "old-2", code: "W-003", type: "wood", dive: "DIVE-02", x: 58, y: 39, depth: "18.2m", orientation: "西北", condition: "稳定", note: "疑似横梁" }
    ])
  });
  const store = new EvidenceStore({ storage, now: () => "2026-09-13T00:00:00.000Z" });
  assert.equal(store.state.batches.length, 1);
  assert.equal(store.state.batches[0].name, "旧入口默认批次");
  assert.equal(store.state.markers.length, 2);
  assert.ok(store.state.markers.every(m => m.batchId === store.state.batches[0].id));
  assert.ok(store.state.markers.every(m => m.origin === "legacy"));
  // 旧键保留不删，作为备份
  assert.ok(storage.getItem("zfl30Marks"));
  // 迁移只发生一次：重开不重复
  const again = new EvidenceStore({ storage });
  assert.equal(again.state.markers.length, 2);
});

test("损坏的存量数据被备份并重建空状态", () => {
  const storage = createMemoryStorage({ [model.STATE_KEY]: "{broken json" });
  const store = new EvidenceStore({ storage });
  assert.equal(store.state.batches.length, 0);
  const keys = Object.keys(storage._dump());
  assert.ok(keys.some(k => k.startsWith(model.STATE_KEY + ".corrupt.")));
});

test("ensureDefaultBatch：无批次时自动建批且幂等", () => {
  const { store } = makeStore();
  const id1 = store.ensureDefaultBatch();
  const id2 = store.ensureDefaultBatch();
  assert.equal(id1, id2);
  assert.equal(store.state.batches.length, 1);
});

test("导入审计记录留存", () => {
  const a = makeStore();
  const b = a.store.addBatch(BATCH_OK).batch;
  a.store.addMarker(markerOk(b.id));
  const v = a.store.sealWorking({ sealedBy: "张海" }).version;
  const pack = a.store.exportVersion(v.id, "张海").pack;

  const c = makeStore();
  c.store.importPackage(JSON.stringify(pack));
  c.store.importPackage("garbage");
  assert.equal(c.store.state.imports.length, 2);
  assert.equal(c.store.state.imports[0].result, "accepted");
  assert.equal(c.store.state.imports[1].result, "rejected");
});
