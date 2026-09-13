"use strict";
/*
 * store.js — EvidenceStore：面向界面的唯一数据入口。
 * 负责持久化、旧数据迁移、批次/标记增删改、封存、版本审阅/复制续录、导入导出。
 * 不包含任何 DOM 逻辑。
 */
(function (root, factory) {
  const deps = typeof module !== "undefined" && module.exports
    ? {
        model: require("./model.js"),
        validate: require("./validate.js"),
        seal: require("./seal.js"),
        transfer: require("./transfer.js")
      }
    : {
        model: root.DiveCore.model,
        validate: root.DiveCore.validate,
        seal: root.DiveCore.seal,
        transfer: root.DiveCore.transfer
      };
  if (typeof module !== "undefined" && module.exports) module.exports = factory(deps);
  else { root.DiveCore = root.DiveCore || {}; root.DiveCore.store = factory(deps); }
})(typeof self !== "undefined" ? self : globalThis, function ({ model, validate, seal, transfer }) {

  const LEGACY_DEFAULT_BATCH = {
    name: "旧入口默认批次",
    leader: "未登记",
    calibrationNo: "未登记",
    startTime: "2020-01-01T00:00:00.000Z",
    endTime: "2099-12-31T23:59:59.000Z",
    imagerySummary: "旧版标记入口自动建批（无影像摘要，请在封存台补全登记）",
    origin: "system"
  };

  class EvidenceStore {
    /*
     * options:
     *   storage  {getItem,setItem,removeItem} 缺省为内存存储
     *   now      () => ISO 字符串（测试可注入固定时钟）
     *   id       () => 唯一 id（测试可注入序列）
     */
    constructor(options = {}) {
      this._now = options.now || (() => new Date().toISOString());
      this._id = options.id || model.defaultUuid;
      this._storage = options.storage || defaultMemory();
      this.state = this._load();
    }

    // ---------- 持久化与迁移 ----------

    _load() {
      const raw = this._storage.getItem(model.STATE_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.schemaVersion === model.SCHEMA_VERSION) return parsed;
          // 结构不符：备份后重建，绝不静默丢弃
          this._storage.setItem(model.STATE_KEY + ".corrupt." + Date.now(), raw);
        } catch (e) {
          this._storage.setItem(model.STATE_KEY + ".corrupt." + Date.now(), raw);
        }
      }
      const state = model.emptyState(this._now());
      this._migrateLegacy(state);
      this._save(state);
      return state;
    }

    // 旧版 index.html 的 zfl30Marks 数据迁移为默认批次下的标记
    _migrateLegacy(state) {
      const legacyRaw = this._storage.getItem(model.LEGACY_KEY);
      if (!legacyRaw) return;
      let legacy;
      try { legacy = JSON.parse(legacyRaw); } catch (e) { return; }
      if (!Array.isArray(legacy) || !legacy.length) return;
      const batch = model.makeBatch({ ...LEGACY_DEFAULT_BATCH, createdAt: this._now() }, this._ctx());
      state.batches.push(batch);
      for (const item of legacy) {
        state.markers.push(model.makeMarker({
          ...item,
          id: undefined,
          batchId: batch.id,
          recordedAt: item.recordedAt || this._now(),
          origin: "legacy"
        }, this._ctx()));
      }
    }

    _ctx() { return { now: this._now, id: this._id }; }

    _save(state) {
      this._storage.setItem(model.STATE_KEY, JSON.stringify(state || this.state));
    }

    save() { this._save(this.state); }

    // ---------- 批次 ----------

    addBatch(fields) {
      const batch = model.makeBatch(fields, this._ctx());
      const errors = validate.validateBatchFields(batch);
      if (errors.length) return { ok: false, errors };
      this.state.batches.push(batch);
      this.save();
      return { ok: true, batch: model.deepClone(batch) };
    }

    updateBatch(id, fields) {
      const batch = this.state.batches.find(b => b.id === id);
      if (!batch) return { ok: false, errors: [{ severity: "error", rule: "missing", message: "批次不存在", refs: [] }] };
      const next = { ...batch, ...fields, id: batch.id, createdAt: batch.createdAt };
      const errors = validate.validateBatchFields(next);
      if (errors.length) return { ok: false, errors };
      Object.assign(batch, next);
      this.save();
      return { ok: true, batch: model.deepClone(batch) };
    }

    removeBatch(id) {
      const used = this.state.markers.filter(m => m.batchId === id).length;
      if (used) {
        return { ok: false, errors: [{ severity: "error", rule: "in-use", message: `批次内仍有 ${used} 条标记，不能删除`, refs: [] }] };
      }
      this.state.batches = this.state.batches.filter(b => b.id !== id);
      this.save();
      return { ok: true };
    }

    // 旧入口使用：没有任何批次时自动建立默认批次，保证“标记只能进入已建批次”
    ensureDefaultBatch() {
      if (this.state.batches.length) return this.state.batches[0].id;
      const batch = model.makeBatch({ ...LEGACY_DEFAULT_BATCH, createdAt: this._now() }, this._ctx());
      this.state.batches.push(batch);
      this.save();
      return batch.id;
    }

    // ---------- 标记 ----------

    addMarker(fields) {
      const marker = model.makeMarker(fields, this._ctx());
      const errors = validate.validateMarkerFields(marker, this.state);
      if (errors.length) return { ok: false, errors };
      this.state.markers.push(marker);
      this.save();
      return { ok: true, marker: model.deepClone(marker) };
    }

    updateMarker(id, fields) {
      const marker = this.state.markers.find(m => m.id === id);
      if (!marker) return { ok: false, errors: [{ severity: "error", rule: "missing", message: "标记不存在", refs: [] }] };
      const next = { ...marker, ...fields, id: marker.id, createdAt: marker.createdAt };
      const errors = validate.validateMarkerFields(next, this.state, [id]);
      if (errors.length) return { ok: false, errors };
      Object.assign(marker, next);
      this.save();
      return { ok: true, marker: model.deepClone(marker) };
    }

    removeMarker(id) {
      this.state.markers = this.state.markers.filter(m => m.id !== id);
      this.save();
      return { ok: true };
    }

    // ---------- 封存 ----------

    validateWorking() {
      return validate.validateWorking(this.state);
    }

    /*
     * 封存当前工作区为只读版本。
     * 有 error 一律拒绝；有 warning 需 confirmWarnings=true。
     * 返回 { ok, issues?, needsConfirm?, version? }
     */
    sealWorking({ sealedBy, note, confirmWarnings } = {}) {
      const issues = this.validateWorking();
      if (issues.errors.length) return { ok: false, issues };
      if (issues.warnings.length && !confirmWarnings) {
        return { ok: false, issues, needsConfirm: true };
      }
      if (!sealedBy || !String(sealedBy).trim()) {
        return {
          ok: false,
          issues: { errors: [{ severity: "error", rule: "required", message: "请填写封存人", refs: [] }], warnings: issues.warnings }
        };
      }
      const localVersions = this.state.versions.filter(v => v.origin === "local");
      const prevVersion = localVersions[localVersions.length - 1] || null;
      const seq = this.state.versions.reduce((max, v) => Math.max(max, v.seq || 0), 0) + 1;
      const version = seal.buildVersion({
        state: this.state,
        prevVersion,
        seq,
        sealedBy,
        note,
        now: this._now,
        id: this._id,
        origin: "local",
        source: String(sealedBy).trim()
      });
      this.state.versions.push(version);
      this.save();
      return { ok: true, version: model.deepClone(version), issues };
    }

    // ---------- 版本 ----------

    listVersions() {
      return model.deepClone(this.state.versions);
    }

    getVersion(id) {
      const v = this.state.versions.find(x => x.id === id);
      return v ? model.deepClone(v) : null;
    }

    // 复制续录：把某个历史版本的快照载入工作区继续记录（调用方需先确认）
    continueFromVersion(id) {
      const v = this.state.versions.find(x => x.id === id);
      if (!v) return { ok: false, error: "版本不存在" };
      this.state.batches = model.deepClone(v.snapshot.batches);
      this.state.markers = model.deepClone(v.snapshot.markers);
      this.save();
      return { ok: true, version: model.deepClone(v) };
    }

    // ---------- 导入导出 ----------

    exportVersion(id, exportedBy) {
      const v = this.state.versions.find(x => x.id === id);
      if (!v) return { ok: false, error: "版本不存在" };
      const pack = transfer.buildPack(v, { exportedBy, now: this._now, id: this._id });
      return { ok: true, pack };
    }

    /*
     * 导入他人版本包：核对摘要、归属、兼容性；
     * 损坏或重复一律拒绝，现有数据（工作区与历史版本）保持不变。
     */
    importPackage(raw, { source } = {}) {
      const knownDigests = new Set(this.state.versions.map(v => v.digest));
      const result = transfer.verifyPack(raw, { knownDigests });
      const audit = {
        at: this._now(),
        source: source || "未知来源",
        exportedBy: (result.pack && result.pack.exportedBy) || "",
        digest: (result.version && result.version.digest) || "",
        result: result.ok ? "accepted" : "rejected",
        reason: result.reason || null,
        checks: result.checks.map(c => ({ name: c.name, ok: c.ok, message: c.message }))
      };
      if (!result.ok) {
        this.state.imports.push(audit);
        this.save();
        return { ok: false, checks: result.checks, reason: result.reason };
      }
      const version = model.deepFreeze(model.deepClone({
        ...result.version,
        origin: "imported",
        source: result.pack.exportedBy,
        importedAt: this._now()
      }));
      this.state.versions.push(version);
      audit.digest = version.digest;
      this.state.imports.push(audit);
      this.save();
      return { ok: true, checks: result.checks, version: model.deepClone(version) };
    }

    // 测试/演示辅助：清空重来
    reset() {
      this.state = model.emptyState(this._now());
      this.save();
    }
  }

  function defaultMemory() {
    const map = new Map();
    return {
      getItem: k => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: k => map.delete(k)
    };
  }

  return { EvidenceStore, LEGACY_DEFAULT_BATCH };
});
