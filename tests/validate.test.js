"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeStore, BATCH_OK, markerOk } = require("./helpers.js");

test("批次必填项逐条报错", () => {
  const { store } = makeStore();
  const r = store.addBatch({ name: "只有名字" });
  assert.equal(r.ok, false);
  const fields = r.errors.map(e => e.refs[0] && e.refs[0].field).sort();
  assert.deepEqual(fields, ["calibrationNo", "endTime", "imagerySummary", "leader", "startTime"]);
});

test("批次结束时间必须晚于开始时间", () => {
  const { store } = makeStore();
  const r = store.addBatch({ ...BATCH_OK, endTime: BATCH_OK.startTime });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.rule === "time-order"));
});

test("标记只能进入已建批次", () => {
  const { store } = makeStore();
  const r = store.addMarker(markerOk("no-such-batch"));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.rule === "batch-missing"));
});

test("标记必填与坐标范围校验", () => {
  const { store } = makeStore();
  const b = store.addBatch(BATCH_OK).batch;
  let r = store.addMarker({ ...markerOk(b.id), code: "", depth: "" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.refs[0].field === "code"));
  assert.ok(r.errors.some(e => e.refs[0].field === "depth"));

  r = store.addMarker(markerOk(b.id, { code: "A-002", x: 120, y: -5 }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.rule === "coord-range"));

  r = store.addMarker(markerOk(b.id, { code: "A-003", x: null, y: null }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.rule === "coord-range"));
});

test("编号重复被拒绝（新增与编辑）", () => {
  const { store } = makeStore();
  const b = store.addBatch(BATCH_OK).batch;
  assert.equal(store.addMarker(markerOk(b.id, { code: "A-001" })).ok, true);
  const dup = store.addMarker(markerOk(b.id, { code: "A-001" }));
  assert.equal(dup.ok, false);
  assert.ok(dup.errors.some(e => e.rule === "code-duplicate"));

  const m2 = store.addMarker(markerOk(b.id, { code: "A-002" })).marker;
  const upd = store.updateMarker(m2.id, { code: "A-001" });
  assert.equal(upd.ok, false);
  // 编辑自身编号不变应通过
  assert.equal(store.updateMarker(m2.id, { code: "A-002", depth: "18m" }).ok, true);
});

test("有标记的批次不能删除", () => {
  const { store } = makeStore();
  const b = store.addBatch(BATCH_OK).batch;
  store.addMarker(markerOk(b.id));
  const r = store.removeBatch(b.id);
  assert.equal(r.ok, false);
  store.removeMarker(store.state.markers[0].id);
  assert.equal(store.removeBatch(b.id).ok, true);
});

test("封存检查：时间重叠（标记在批次窗口外）为提醒级", () => {
  const { store } = makeStore();
  const b = store.addBatch(BATCH_OK).batch;
  store.addMarker(markerOk(b.id, { recordedAt: "2026-09-11T02:00:00.000Z" }));
  const issues = store.validateWorking();
  assert.equal(issues.errors.length, 0);
  assert.equal(issues.warnings.length, 1);
  assert.equal(issues.warnings[0].rule, "time-overlap");
});

test("封存检查：批次之间时间重叠为提醒级", () => {
  const { store } = makeStore();
  store.addBatch(BATCH_OK);
  store.addBatch({ ...BATCH_OK, name: "重叠批次", startTime: "2026-09-10T04:00:00.000Z", endTime: "2026-09-10T08:00:00.000Z" });
  const issues = store.validateWorking();
  assert.equal(issues.errors.length, 0);
  assert.ok(issues.warnings.some(w => w.rule === "time-overlap" && w.message.includes("重叠批次")));
});

test("封存检查：编号重复逐条列出", () => {
  const { store } = makeStore();
  const b = store.addBatch(BATCH_OK).batch;
  store.addMarker(markerOk(b.id, { code: "A-001" }));
  // 绕过单条校验直接注入重复编号，模拟历史遗留数据
  store.state.markers.push({ ...store.state.markers[0], id: "dup-1" });
  const issues = store.validateWorking();
  const dup = issues.errors.find(e => e.rule === "code-duplicate");
  assert.ok(dup);
  assert.match(dup.message, /A-001/);
  assert.equal(dup.refs.length, 2);
});

test("封存检查：全部合规时无问题", () => {
  const { store } = makeStore();
  const b = store.addBatch(BATCH_OK).batch;
  store.addMarker(markerOk(b.id));
  const issues = store.validateWorking();
  assert.equal(issues.errors.length, 0);
  assert.equal(issues.warnings.length, 0);
});
