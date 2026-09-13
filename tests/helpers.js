"use strict";
// 测试公共辅助：固定时钟 + 顺序 id，保证可重复
const { EvidenceStore } = require("../src/core/store.js");
const { createMemoryStorage } = require("../src/core/storage.js");

function makeCtx(overrides = {}) {
  let tick = 0;
  let seq = 0;
  const base = Date.parse("2026-09-01T00:00:00.000Z");
  const ctx = {
    storage: createMemoryStorage(),
    now: () => new Date(base + (tick++) * 1000).toISOString(),
    id: () => "id-" + String(++seq).padStart(4, "0"),
    ...overrides
  };
  return ctx;
}

function makeStore(overrides) {
  const ctx = makeCtx(overrides);
  const store = new EvidenceStore(ctx);
  return { store, ctx };
}

const BATCH_OK = {
  name: "2026-09 第一潜次调查",
  leader: "张海",
  calibrationNo: "CAL-2026-0913",
  startTime: "2026-09-10T01:00:00.000Z",
  endTime: "2026-09-10T05:00:00.000Z",
  imagerySummary: "ROV-03 全程录像 4 段，照片 212 张"
};

function markerOk(batchId, extra = {}) {
  return {
    code: "A-001",
    type: "ceramic",
    dive: "DIVE-01",
    batchId,
    recordedAt: "2026-09-10T02:00:00.000Z",
    x: 42, y: 46,
    depth: "17.8m",
    orientation: "东",
    condition: "边缘残缺",
    note: "靠近船肋",
    ...extra
  };
}

module.exports = { makeStore, makeCtx, BATCH_OK, markerOk };
