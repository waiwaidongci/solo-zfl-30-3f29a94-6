"use strict";
/*
 * transfer.js — 版本包导出与导入校验。
 * 导入时核对：格式兼容性、归属（导出方/封存人）、摘要（包摘要 + 版本摘要）、
 * 结构完整性；损坏或重复的包一律拒绝，绝不覆盖现有数据。
 */
(function (root, factory) {
  const deps = typeof module !== "undefined" && module.exports
    ? { model: require("./model.js"), digest: require("./digest.js") }
    : { model: root.DiveCore.model, digest: root.DiveCore.digest };
  if (typeof module !== "undefined" && module.exports) module.exports = factory(deps);
  else { root.DiveCore = root.DiveCore || {}; root.DiveCore.transfer = factory(deps); }
})(typeof self !== "undefined" ? self : globalThis, function ({ model, digest }) {

  const PACK_FORMAT = "dive-evidence-pack";
  const PACK_VERSION = 1;

  // 包摘要覆盖的字段（payloadHash 之外的整个包体）
  function packPayload(pack) {
    return {
      format: pack.format,
      formatVersion: pack.formatVersion,
      packId: pack.packId,
      exportedAt: pack.exportedAt,
      exportedBy: pack.exportedBy,
      version: pack.version
    };
  }

  function buildPack(version, { exportedBy, now, id }) {
    const pack = {
      format: PACK_FORMAT,
      formatVersion: PACK_VERSION,
      packId: id(),
      exportedAt: now(),
      exportedBy: String(exportedBy || "").trim(),
      version: model.deepClone(version)
    };
    pack.payloadHash = digest.digestOf(packPayload(pack));
    return pack;
  }

  function check(name, ok, message) { return { name, ok, message }; }

  // 结构完整性：快照内批次/标记数组合法、标记归属存在于快照批次中、必填字段在位
  function verifyStructure(version) {
    const problems = [];
    if (!version || typeof version !== "object") problems.push("版本不是对象");
    if (version && (!version.snapshot || typeof version.snapshot !== "object")) problems.push("缺少快照");
    const snap = version && version.snapshot;
    if (snap) {
      if (!Array.isArray(snap.batches)) problems.push("快照批次不是数组");
      if (!Array.isArray(snap.markers)) problems.push("快照标记不是数组");
      if (Array.isArray(snap.batches) && Array.isArray(snap.markers)) {
        const batchIds = new Set(snap.batches.map(b => b && b.id));
        for (const b of snap.batches) {
          if (!b || typeof b.id !== "string" || !b.id) problems.push("存在无 id 的批次");
          for (const f of model.BATCH_REQUIRED) {
            if (b && (b[f] === undefined || b[f] === null)) problems.push(`批次「${b.name || b.id}」缺字段 ${f}`);
          }
        }
        for (const m of snap.markers) {
          if (!m || typeof m.id !== "string" || !m.id) problems.push("存在无 id 的标记");
          if (m && !batchIds.has(m.batchId)) problems.push(`标记「${(m && m.code) || "?"}」归属批次不在包内`);
          for (const f of ["code", "type", "dive", "recordedAt"]) {
            if (m && (m[f] === undefined || m[f] === null || m[f] === "")) problems.push(`标记「${(m && m.code) || "?"}」缺字段 ${f}`);
          }
          if (m && (typeof m.x !== "number" || typeof m.y !== "number" ||
            m.x < model.COORD_MIN || m.x > model.COORD_MAX || m.y < model.COORD_MIN || m.y > model.COORD_MAX)) {
            problems.push(`标记「${(m && m.code) || "?"}」坐标缺失或越界`);
          }
        }
      }
    }
    return problems;
  }

  /*
   * 校验版本包。raw 为字符串或已解析对象；knownDigests 为本地已有版本摘要集合。
   * 返回 { ok, checks: [{name, ok, message}], pack?, version?, reason? }，
   * 任何一项不通过则 ok=false，调用方不得写入任何数据。
   */
  function verifyPack(raw, { knownDigests } = {}) {
    const checks = [];

    // 1. 可解析性
    let pack = raw;
    if (typeof raw === "string") {
      try { pack = JSON.parse(raw); }
      catch (e) {
        checks.push(check("可解析", false, "不是合法的 JSON，文件可能已损坏"));
        return { ok: false, checks, reason: "corrupt" };
      }
    }
    if (!pack || typeof pack !== "object" || Array.isArray(pack)) {
      checks.push(check("可解析", false, "内容不是版本包对象"));
      return { ok: false, checks, reason: "corrupt" };
    }
    checks.push(check("可解析", true, "JSON 解析成功"));

    // 2. 兼容性
    const compatible = pack.format === PACK_FORMAT &&
      Number.isInteger(pack.formatVersion) && pack.formatVersion >= 1 && pack.formatVersion <= PACK_VERSION;
    checks.push(check("兼容性", compatible, compatible
      ? `格式 ${pack.format} v${pack.formatVersion}，本机支持到 v${PACK_VERSION}`
      : `不支持的格式或版本：${pack.format || "未知"} v${pack.formatVersion ?? "?"}`));

    // 3. 归属
    const hasOwner = typeof pack.exportedBy === "string" && pack.exportedBy.trim() !== "" &&
      pack.version && typeof pack.version.sealedBy === "string" && pack.version.sealedBy.trim() !== "";
    checks.push(check("归属", !!hasOwner, hasOwner
      ? `导出方：${pack.exportedBy}；封存人：${pack.version.sealedBy}`
      : "缺少导出方或封存人信息，来源不明"));

    // 4. 摘要（包摘要 + 版本摘要）
    let hashOk = false;
    if (typeof pack.payloadHash === "string" && /^[0-9a-f]{64}$/.test(pack.payloadHash)) {
      hashOk = digest.digestOf(packPayload(pack)) === pack.payloadHash;
    }
    checks.push(check("包摘要", hashOk, hashOk ? "包内容摘要一致" : "包摘要校验失败，内容可能被篡改或已损坏"));
    let versionHashOk = false;
    if (pack.version && typeof pack.version.digest === "string" && /^[0-9a-f]{64}$/.test(pack.version.digest) && pack.version.snapshot) {
      versionHashOk = digest.digestOf(pack.version.snapshot) === pack.version.digest;
    }
    checks.push(check("版本摘要", versionHashOk, versionHashOk ? "版本快照摘要一致" : "版本快照摘要校验失败"));

    // 5. 结构完整性
    const structureProblems = hashOk && versionHashOk ? verifyStructure(pack.version) : ["摘要未通过，跳过结构检查"];
    const structureOk = structureProblems.length === 0;
    checks.push(check("结构完整", structureOk, structureOk
      ? `快照含 ${pack.version.snapshot.batches.length} 个批次、${pack.version.snapshot.markers.length} 条标记`
      : structureProblems.slice(0, 5).join("；")));

    // 6. 重复
    let duplicate = false;
    if (versionHashOk && knownDigests) {
      duplicate = knownDigests.has(pack.version.digest);
    }
    checks.push(check("非重复", !duplicate, duplicate ? "该版本已存在，按重复包拒绝，不覆盖现有数据" : "本地无相同版本"));

    const ok = checks.every(c => c.ok);
    const reason = ok ? null
      : !checks[0].ok ? "corrupt"
      : !checks[1].ok ? "incompatible"
      : !checks[2].ok ? "no-owner"
      : (!checks[3].ok || !checks[4].ok || !checks[5].ok) ? "corrupt"
      : "duplicate";
    return { ok, checks, pack: ok ? pack : undefined, version: ok ? pack.version : undefined, reason };
  }

  return { PACK_FORMAT, PACK_VERSION, buildPack, verifyPack, packPayload, verifyStructure };
});
