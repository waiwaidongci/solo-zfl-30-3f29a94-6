/*
 * model.js — 数据模型、常量、工厂函数与深冻结。
 * 纯数据逻辑，不接触 DOM 与存储介质。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.DiveCore = root.DiveCore || {}; root.DiveCore.model = factory(); }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const SCHEMA_VERSION = 1;
  const STATE_KEY = "diveEvidenceStation.v1";
  const LEGACY_KEY = "zfl30Marks";

  const MARKER_TYPES = ["ceramic", "wood", "metal", "unknown"];
  const TYPE_NAMES = { ceramic: "陶片", wood: "木构件", metal: "金属件", unknown: "未知物" };

  // 批次必填：名称、负责人、设备校准号、起止时间、影像摘要
  const BATCH_REQUIRED = ["name", "leader", "calibrationNo", "startTime", "endTime", "imagerySummary"];
  const BATCH_FIELD_NAMES = {
    name: "批次名称", leader: "负责人", calibrationNo: "设备校准号",
    startTime: "开始时间", endTime: "结束时间", imagerySummary: "影像摘要"
  };

  // 标记必填：编号、类型、潜次、所属批次、记录时间、深度、坐标
  const MARKER_REQUIRED = ["code", "type", "dive", "batchId", "recordedAt", "depth"];
  const MARKER_FIELD_NAMES = {
    code: "编号", type: "类型", dive: "潜次", batchId: "所属批次",
    recordedAt: "记录时间", depth: "深度", x: "横坐标", y: "纵坐标"
  };

  const COORD_MIN = 0;
  const COORD_MAX = 100;

  function emptyState(now) {
    return {
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      batches: [],
      markers: [],
      versions: [],
      imports: []
    };
  }

  function makeBatch(fields, ctx) {
    return {
      id: ctx.id(),
      name: str(fields.name),
      leader: str(fields.leader),
      calibrationNo: str(fields.calibrationNo),
      startTime: str(fields.startTime),
      endTime: str(fields.endTime),
      imagerySummary: str(fields.imagerySummary),
      note: str(fields.note),
      origin: fields.origin || "local",
      createdAt: fields.createdAt || ctx.now()
    };
  }

  function makeMarker(fields, ctx) {
    return {
      id: ctx.id(),
      code: str(fields.code),
      type: MARKER_TYPES.includes(fields.type) ? fields.type : "unknown",
      dive: str(fields.dive),
      batchId: str(fields.batchId),
      recordedAt: str(fields.recordedAt) || ctx.now(),
      x: numOrNull(fields.x),
      y: numOrNull(fields.y),
      depth: str(fields.depth),
      orientation: str(fields.orientation),
      condition: str(fields.condition),
      note: str(fields.note),
      origin: fields.origin || "local",
      createdAt: fields.createdAt || ctx.now()
    };
  }

  function str(v) { return v === undefined || v === null ? "" : String(v); }
  function numOrNull(v) {
    if (v === "" || v === undefined || v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function deepClone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
  }

  // 快照：按 id 排序后深拷贝，保证摘要与插入顺序无关。
  function snapshotOf(batches, markers) {
    const sortById = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return {
      batches: deepClone(batches).sort(sortById),
      markers: deepClone(markers).sort(sortById)
    };
  }

  function defaultUuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  return {
    SCHEMA_VERSION, STATE_KEY, LEGACY_KEY,
    MARKER_TYPES, TYPE_NAMES,
    BATCH_REQUIRED, BATCH_FIELD_NAMES, MARKER_REQUIRED, MARKER_FIELD_NAMES,
    COORD_MIN, COORD_MAX,
    emptyState, makeBatch, makeMarker, snapshotOf,
    deepClone, deepFreeze, defaultUuid
  };
});
