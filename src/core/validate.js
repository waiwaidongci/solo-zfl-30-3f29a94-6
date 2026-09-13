"use strict";
/*
 * validate.js — 封存前检查与表单级校验。
 * 规则分两级：error（必须修复，阻断封存）与 warning（逐条列出，确认后可封存）。
 * 检查项：必填内容、编号重复、坐标范围、批次起止有效、时间重叠（标记记录时间
 * 不在批次窗口内、批次之间时间区间相交）。
 */
(function (root, factory) {
  const deps = typeof module !== "undefined" && module.exports
    ? { model: require("./model.js") }
    : { model: root.DiveCore.model };
  if (typeof module !== "undefined" && module.exports) module.exports = factory(deps);
  else { root.DiveCore = root.DiveCore || {}; root.DiveCore.validate = factory(deps); }
})(typeof self !== "undefined" ? self : globalThis, function ({ model }) {

  function issue(severity, rule, message, refs) {
    return { severity, rule, message, refs: refs || [] };
  }

  function isBlank(v) { return v === undefined || v === null || String(v).trim() === ""; }

  function parseTime(v) {
    if (isBlank(v)) return null;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }

  // 单条批次字段校验（建批/编辑时即时反馈，也在封存检查中复用）
  function validateBatchFields(batch) {
    const errors = [];
    for (const field of model.BATCH_REQUIRED) {
      if (isBlank(batch[field])) {
        errors.push(issue("error", "required",
          `批次「${batch.name || batch.id}」缺少必填项：${model.BATCH_FIELD_NAMES[field]}`,
          [{ kind: "batch", id: batch.id, field }]));
      }
    }
    const start = parseTime(batch.startTime);
    const end = parseTime(batch.endTime);
    if (!isBlank(batch.startTime) && start === null) {
      errors.push(issue("error", "time-format",
        `批次「${batch.name || batch.id}」开始时间无法解析`, [{ kind: "batch", id: batch.id, field: "startTime" }]));
    }
    if (!isBlank(batch.endTime) && end === null) {
      errors.push(issue("error", "time-format",
        `批次「${batch.name || batch.id}」结束时间无法解析`, [{ kind: "batch", id: batch.id, field: "endTime" }]));
    }
    if (start !== null && end !== null && end <= start) {
      errors.push(issue("error", "time-order",
        `批次「${batch.name || batch.id}」结束时间不晚于开始时间`,
        [{ kind: "batch", id: batch.id, field: "endTime" }]));
    }
    return errors;
  }

  // 单条标记字段校验（codeOwnerIds：允许占用该编号的标记 id，用于编辑时排除自身）
  function validateMarkerFields(marker, state, codeOwnerIds) {
    const errors = [];
    for (const field of model.MARKER_REQUIRED) {
      if (isBlank(marker[field])) {
        errors.push(issue("error", "required",
          `标记「${marker.code || marker.id}」缺少必填项：${model.MARKER_FIELD_NAMES[field]}`,
          [{ kind: "marker", id: marker.id, field }]));
      }
    }
    if (marker.x === null || marker.y === null) {
      errors.push(issue("error", "coord-range",
        `标记「${marker.code || marker.id}」缺少坐标（请在平面图上点选位置）`,
        [{ kind: "marker", id: marker.id, field: "x" }]));
    } else if (
      marker.x < model.COORD_MIN || marker.x > model.COORD_MAX ||
      marker.y < model.COORD_MIN || marker.y > model.COORD_MAX
    ) {
      errors.push(issue("error", "coord-range",
        `标记「${marker.code || marker.id}」坐标超出范围（${model.COORD_MIN}–${model.COORD_MAX}）：(${marker.x}, ${marker.y})`,
        [{ kind: "marker", id: marker.id, field: "x" }]));
    }
    if (!isBlank(marker.batchId) && !state.batches.some(b => b.id === marker.batchId)) {
      errors.push(issue("error", "batch-missing",
        `标记「${marker.code || marker.id}」所属批次不存在，标记只能进入已建批次`,
        [{ kind: "marker", id: marker.id, field: "batchId" }]));
    }
    if (!isBlank(marker.code)) {
      const owners = (codeOwnerIds || [marker.id]);
      const clash = state.markers.find(m => m.code === marker.code && !owners.includes(m.id));
      if (clash) {
        errors.push(issue("error", "code-duplicate",
          `编号「${marker.code}」与已有标记重复`,
          [{ kind: "marker", id: marker.id }, { kind: "marker", id: clash.id }]));
      }
    }
    return errors;
  }

  // 封存前整体检查：逐条返回 {severity, rule, message, refs}
  function validateWorking(state) {
    const errors = [];
    const warnings = [];

    for (const batch of state.batches) {
      errors.push(...validateBatchFields(batch));
    }

    // 批次之间时间区间相交 → 时间重叠（提醒级）
    const timed = state.batches
      .map(b => ({ b, start: parseTime(b.startTime), end: parseTime(b.endTime) }))
      .filter(x => x.start !== null && x.end !== null && x.end > x.start);
    for (let i = 0; i < timed.length; i++) {
      for (let j = i + 1; j < timed.length; j++) {
        const a = timed[i], c = timed[j];
        if (a.start < c.end && c.start < a.end) {
          warnings.push(issue("warning", "time-overlap",
            `批次「${a.b.name || a.b.id}」与「${c.b.name || c.b.id}」起止时间重叠`,
            [{ kind: "batch", id: a.b.id }, { kind: "batch", id: c.b.id }]));
        }
      }
    }

    // 编号重复（错误级，按编号聚合逐条列出）
    const byCode = new Map();
    for (const m of state.markers) {
      if (isBlank(m.code)) continue;
      if (!byCode.has(m.code)) byCode.set(m.code, []);
      byCode.get(m.code).push(m);
    }
    for (const [code, group] of byCode) {
      if (group.length > 1) {
        errors.push(issue("error", "code-duplicate",
          `编号「${code}」重复出现 ${group.length} 次`,
          group.map(m => ({ kind: "marker", id: m.id }))));
      }
    }

    const batchById = new Map(state.batches.map(b => [b.id, b]));
    for (const marker of state.markers) {
      // 必填 / 坐标范围 / 批次存在（单条维度，重复编号已在上面聚合，这里跳过）
      for (const field of model.MARKER_REQUIRED) {
        if (isBlank(marker[field])) {
          errors.push(issue("error", "required",
            `标记「${marker.code || marker.id}」缺少必填项：${model.MARKER_FIELD_NAMES[field]}`,
            [{ kind: "marker", id: marker.id, field }]));
        }
      }
      if (marker.x === null || marker.y === null) {
        errors.push(issue("error", "coord-range",
          `标记「${marker.code || marker.id}」缺少坐标`,
          [{ kind: "marker", id: marker.id, field: "x" }]));
      } else if (
        marker.x < model.COORD_MIN || marker.x > model.COORD_MAX ||
        marker.y < model.COORD_MIN || marker.y > model.COORD_MAX
      ) {
        errors.push(issue("error", "coord-range",
          `标记「${marker.code || marker.id}」坐标超出范围（${model.COORD_MIN}–${model.COORD_MAX}）：(${marker.x}, ${marker.y})`,
          [{ kind: "marker", id: marker.id, field: "x" }]));
      }
      const batch = batchById.get(marker.batchId);
      if (!isBlank(marker.batchId) && !batch) {
        errors.push(issue("error", "batch-missing",
          `标记「${marker.code || marker.id}」所属批次不存在，标记只能进入已建批次`,
          [{ kind: "marker", id: marker.id, field: "batchId" }]));
      }
      // 标记记录时间不在批次起止窗口内 → 时间重叠（提醒级）
      if (batch) {
        const rec = parseTime(marker.recordedAt);
        const start = parseTime(batch.startTime);
        const end = parseTime(batch.endTime);
        if (rec !== null && start !== null && end !== null && (rec < start || rec > end)) {
          warnings.push(issue("warning", "time-overlap",
            `标记「${marker.code || marker.id}」记录时间不在批次「${batch.name || batch.id}」起止时间内`,
            [{ kind: "marker", id: marker.id }, { kind: "batch", id: batch.id }]));
        }
      }
    }

    return { errors, warnings };
  }

  return { validateBatchFields, validateMarkerFields, validateWorking, isBlank, parseTime };
});
