"use strict";
/*
 * seal.js — 封存：生成只读版本、计算与上一版的差异。
 */
(function (root, factory) {
  const deps = typeof module !== "undefined" && module.exports
    ? { model: require("./model.js"), digest: require("./digest.js") }
    : { model: root.DiveCore.model, digest: root.DiveCore.digest };
  if (typeof module !== "undefined" && module.exports) module.exports = factory(deps);
  else { root.DiveCore = root.DiveCore || {}; root.DiveCore.seal = factory(deps); }
})(typeof self !== "undefined" ? self : globalThis, function ({ model, digest }) {

  const TRACKED_BATCH_FIELDS = ["name", "leader", "calibrationNo", "startTime", "endTime", "imagerySummary", "note"];
  const TRACKED_MARKER_FIELDS = ["code", "type", "dive", "batchId", "recordedAt", "x", "y", "depth", "orientation", "condition", "note"];

  function diffItems(prevList, nextList, fields) {
    const prevById = new Map((prevList || []).map(x => [x.id, x]));
    const nextById = new Map((nextList || []).map(x => [x.id, x]));
    const added = [];
    const removed = [];
    const changed = [];
    for (const [id, next] of nextById) {
      const prev = prevById.get(id);
      if (!prev) { added.push(model.deepClone(next)); continue; }
      const fieldChanges = [];
      for (const f of fields) {
        if (JSON.stringify(prev[f] ?? null) !== JSON.stringify(next[f] ?? null)) {
          fieldChanges.push({ field: f, before: prev[f] ?? null, after: next[f] ?? null });
        }
      }
      if (fieldChanges.length) changed.push({ id, code: next.code || next.name || id, changes: fieldChanges });
    }
    for (const [id, prev] of prevById) {
      if (!nextById.has(id)) removed.push(model.deepClone(prev));
    }
    return { added, removed, changed };
  }

  // 与上一封存版本的快照对比；prevVersion 为 null 时全部为新增。
  function diffSnapshots(prevSnapshot, nextSnapshot) {
    const prev = prevSnapshot || { batches: [], markers: [] };
    const batches = diffItems(prev.batches, nextSnapshot.batches, TRACKED_BATCH_FIELDS);
    const markers = diffItems(prev.markers, nextSnapshot.markers, TRACKED_MARKER_FIELDS);
    return {
      batches, markers,
      summary: {
        addedBatches: batches.added.length, removedBatches: batches.removed.length, changedBatches: batches.changed.length,
        addedMarkers: markers.added.length, removedMarkers: markers.removed.length, changedMarkers: markers.changed.length
      }
    };
  }

  // 生成只读封存版本（深拷贝 + 深冻结，之后对工作区的任何改动都不影响版本）
  function buildVersion({ state, prevVersion, seq, sealedBy, note, now, id, origin, source }) {
    const snapshot = model.snapshotOf(state.batches, state.markers);
    const version = {
      id: id(),
      seq,
      createdAt: now(),
      sealedBy: String(sealedBy || "").trim(),
      note: String(note || "").trim(),
      origin: origin || "local",
      source: source || "local",
      snapshot,
      diff: diffSnapshots(prevVersion ? prevVersion.snapshot : null, snapshot)
    };
    version.digest = digest.digestOf(snapshot);
    return model.deepFreeze(model.deepClone(version));
  }

  return { diffSnapshots, buildVersion, diffItems };
});
