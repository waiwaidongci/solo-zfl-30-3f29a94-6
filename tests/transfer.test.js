"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeStore, BATCH_OK, markerOk } = require("./helpers.js");

function exportedPack() {
  const a = makeStore();
  const b = a.store.addBatch(BATCH_OK).batch;
  a.store.addMarker(markerOk(b.id, { code: "A-001" }));
  a.store.addMarker(markerOk(b.id, { code: "W-001", type: "wood" }));
  const v = a.store.sealWorking({ sealedBy: "张海" }).version;
  const pack = a.store.exportVersion(v.id, "东海考古队·张海").pack;
  return { a, v, pack };
}

test("导出→导入往返：版本作为只读历史版本进入", () => {
  const { pack, v } = exportedPack();
  const b = makeStore();
  const r = b.store.importPackage(JSON.stringify(pack), { source: "测试" });
  assert.equal(r.ok, true);
  assert.equal(r.checks.every(c => c.ok), true);
  assert.equal(b.store.state.versions.length, 1);
  const imported = b.store.state.versions[0];
  assert.equal(imported.origin, "imported");
  assert.equal(imported.source, "东海考古队·张海");
  assert.equal(imported.digest, v.digest);
  // 导入不触碰工作区
  assert.equal(b.store.state.batches.length, 0);
  assert.equal(b.store.state.markers.length, 0);
  // 审阅得到的是副本，改不动存储里的版本
  const review = b.store.getVersion(imported.id);
  review.snapshot.markers[0].code = "HACK";
  assert.notEqual(b.store.state.versions[0].snapshot.markers[0].code, "HACK");
});

test("损坏：非法 JSON 拒绝且不改动数据", () => {
  const b = makeStore();
  b.store.addBatch(BATCH_OK);
  const before = JSON.stringify(b.store.state);
  const r = b.store.importPackage("{not json");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "corrupt");
  assert.equal(r.checks[0].name, "可解析");
  // 工作区与历史版本未被改动（仅多了导入审计记录）
  const after = JSON.parse(JSON.stringify(b.store.state));
  const orig = JSON.parse(before);
  assert.deepEqual(after.batches, orig.batches);
  assert.deepEqual(after.markers, orig.markers);
  assert.deepEqual(after.versions, orig.versions);
  assert.equal(after.imports.length, 1);
  assert.equal(after.imports[0].result, "rejected");
});

test("篡改：改动包内容后包摘要校验失败", () => {
  const { pack } = exportedPack();
  const tampered = JSON.parse(JSON.stringify(pack));
  tampered.version.snapshot.markers[0].condition = "被篡改";
  const b = makeStore();
  const r = b.store.importPackage(JSON.stringify(tampered));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "corrupt");
  assert.ok(r.checks.some(c => c.name === "包摘要" && !c.ok));
  assert.equal(b.store.state.versions.length, 0);
});

test("篡改：重算包摘要但版本摘要不动仍失败", () => {
  const { pack } = exportedPack();
  const { digestOf } = require("../src/core/digest.js");
  const { packPayload } = require("../src/core/transfer.js");
  const tampered = JSON.parse(JSON.stringify(pack));
  tampered.version.snapshot.markers[0].note = "伪造备注";
  tampered.payloadHash = digestOf(packPayload(tampered)); // 攻击者重算了包摘要
  const b = makeStore();
  const r = b.store.importPackage(JSON.stringify(tampered));
  assert.equal(r.ok, false);
  assert.ok(r.checks.some(c => c.name === "版本摘要" && !c.ok));
});

test("兼容性：不支持的格式与版本被拒绝", () => {
  const { pack } = exportedPack();
  const b = makeStore();
  const bad1 = { ...pack, format: "other-format" };
  const r1 = b.store.importPackage(JSON.stringify(bad1));
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, "incompatible");
  const bad2 = { ...pack, formatVersion: 99 };
  assert.equal(b.store.importPackage(JSON.stringify(bad2)).ok, false);
});

test("归属：缺少导出方或封存人被拒绝", () => {
  const { pack } = exportedPack();
  const b = makeStore();
  const noOwner = JSON.parse(JSON.stringify(pack));
  noOwner.exportedBy = "";
  const r = b.store.importPackage(JSON.stringify(noOwner));
  assert.equal(r.ok, false);
  assert.ok(r.checks.some(c => c.name === "归属" && !c.ok));
});

test("重复：同一版本包再次导入被拒绝且不覆盖", () => {
  const { pack } = exportedPack();
  const b = makeStore();
  assert.equal(b.store.importPackage(JSON.stringify(pack)).ok, true);
  assert.equal(b.store.state.versions.length, 1);
  const r2 = b.store.importPackage(JSON.stringify(pack));
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, "duplicate");
  assert.ok(r2.checks.some(c => c.name === "非重复" && !c.ok));
  assert.equal(b.store.state.versions.length, 1);
});

test("重复内容换个包壳仍是重复（按版本摘要判定）", () => {
  const { a, v, pack } = exportedPack();
  // 同一版本再次导出（新 packId/导出时间 → 包摘要不同）
  const pack2 = a.store.exportVersion(v.id, "东海考古队·张海").pack;
  assert.notEqual(pack2.payloadHash, undefined);
  const b = makeStore();
  assert.equal(b.store.importPackage(JSON.stringify(pack)).ok, true);
  const r = b.store.importPackage(JSON.stringify(pack2));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "duplicate");
});

test("结构损坏：快照内标记归属不存在的批次被拒绝", () => {
  const { pack } = exportedPack();
  const { digestOf } = require("../src/core/digest.js");
  const { packPayload } = require("../src/core/transfer.js");
  const broken = JSON.parse(JSON.stringify(pack));
  broken.version.snapshot.batches = []; // 删掉批次但保留标记
  broken.version.digest = digestOf(broken.version.snapshot); // 攻击者重算两级摘要
  broken.payloadHash = digestOf(packPayload(broken));
  const b = makeStore();
  const r = b.store.importPackage(JSON.stringify(broken));
  assert.equal(r.ok, false);
  assert.ok(r.checks.some(c => c.name === "结构完整" && !c.ok));
});
