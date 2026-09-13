/*
 * station.js — 封存台界面逻辑。只做渲染与交互，所有数据规则走 DiveCore。
 */
(function () {
  "use strict";
  const { model, store: { EvidenceStore }, storage: { createBrowserStorage } } = window.DiveCore;
  const store = new EvidenceStore({ storage: createBrowserStorage() });
  const TYPE_NAMES = model.TYPE_NAMES;

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  // ---------- 通用工具 ----------

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = "none"; }, 2600);
  }

  function isoToLocal(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function localToIso(v) {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d) ? "" : d.toISOString();
  }
  function fmtTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return esc(iso);
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  const RULE_NAMES = {
    "required": "必填内容", "coord-range": "坐标范围", "code-duplicate": "编号重复",
    "time-overlap": "时间重叠", "time-order": "时间无效", "time-format": "时间格式",
    "batch-missing": "批次缺失", "in-use": "使用中", "missing": "不存在"
  };
  function ruleName(rule) { return RULE_NAMES[rule] || rule; }

  function issueHtml(list, cls) {
    if (!list.length) return "";
    return list.map(i =>
      `<div class="issue ${cls}"><span class="rule">[${esc(ruleName(i.rule))}]</span>${esc(i.message)}</div>`
    ).join("");
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function operatorName() {
    return localStorage.getItem("diveEvidenceStation.operator") || "";
  }
  function saveOperatorName(v) {
    localStorage.setItem("diveEvidenceStation.operator", v);
  }

  // ---------- 页签 ----------

  $$("#tabs button").forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });
  function switchTab(name) {
    $$("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    $$("section.tab").forEach(s => s.classList.toggle("active", s.id === "tab-" + name));
    if (name === "seal") renderSealStats();
    if (name === "versions") renderVersions();
    if (name === "import") renderImportLog();
    if (name === "markers") renderMarkers();
    if (name === "batches") renderBatches();
  }

  // ---------- 批次 ----------

  const batchForm = $("#batchForm");
  let editingBatchId = null;

  function renderBatches() {
    const batches = store.state.batches;
    $("#batchCount").textContent = batches.length;
    $("#batchList").innerHTML = batches.length ? batches.map(b => {
      const count = store.state.markers.filter(m => m.batchId === b.id).length;
      return `<div class="card" data-id="${esc(b.id)}">
        <div><b>${esc(b.name)}</b> <span class="pill">${count} 条标记</span></div>
        <div class="muted">负责人 ${esc(b.leader)} · 校准号 ${esc(b.calibrationNo)}</div>
        <div class="muted">${fmtTime(b.startTime)} → ${fmtTime(b.endTime)}</div>
        <div class="muted">影像摘要：${esc(b.imagerySummary)}</div>
        <div class="actions">
          <button class="ghost" data-act="edit">编辑</button>
          <button class="danger" data-act="del">删除</button>
        </div>
      </div>`;
    }).join("") : '<div class="muted">还没有批次。建批后才能在「补录」页录入标记。</div>';
    $$("#batchList .card").forEach(card => {
      const id = card.dataset.id;
      card.querySelector('[data-act="edit"]').onclick = () => editBatch(id);
      card.querySelector('[data-act="del"]').onclick = () => {
        if (!confirm("确定删除该批次？（批次内有标记时会被拒绝）")) return;
        const r = store.removeBatch(id);
        if (!r.ok) { toast(r.errors.map(e => e.message).join("；")); return; }
        if (editingBatchId === id) resetBatchForm();
        renderAll();
        toast("批次已删除");
      };
    });
    // 补录页的批次下拉同步刷新
    renderBatchSelects();
  }

  function editBatch(id) {
    const b = store.state.batches.find(x => x.id === id);
    if (!b) return;
    editingBatchId = id;
    $("#batchFormTitle").textContent = "编辑批次";
    batchForm.id.value = b.id;
    batchForm.name.value = b.name;
    batchForm.leader.value = b.leader;
    batchForm.calibrationNo.value = b.calibrationNo;
    batchForm.startTime.value = isoToLocal(b.startTime);
    batchForm.endTime.value = isoToLocal(b.endTime);
    batchForm.imagerySummary.value = b.imagerySummary;
    batchForm.note.value = b.note || "";
    switchTab("batches");
    batchForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetBatchForm() {
    editingBatchId = null;
    $("#batchFormTitle").textContent = "新建调查批次";
    batchForm.reset();
    batchForm.id.value = "";
    $("#batchErrors").innerHTML = "";
  }

  $("#batchCancel").onclick = resetBatchForm;

  batchForm.onsubmit = e => {
    e.preventDefault();
    const fields = {
      name: batchForm.name.value.trim(),
      leader: batchForm.leader.value.trim(),
      calibrationNo: batchForm.calibrationNo.value.trim(),
      startTime: localToIso(batchForm.startTime.value),
      endTime: localToIso(batchForm.endTime.value),
      imagerySummary: batchForm.imagerySummary.value.trim(),
      note: batchForm.note.value.trim()
    };
    const r = editingBatchId ? store.updateBatch(editingBatchId, fields) : store.addBatch(fields);
    if (!r.ok) {
      $("#batchErrors").innerHTML = issueHtml(r.errors, "error");
      return;
    }
    const wasEdit = !!editingBatchId;
    resetBatchForm();
    renderAll();
    toast(wasEdit ? "批次已更新" : "批次已建立");
  };

  // ---------- 补录 ----------

  const markerForm = $("#markerForm");
  const map = $("#map");
  let editingMarkerId = null;
  let pendingCoord = null;

  // 船体肋骨装饰（与旧入口一致）
  for (let i = 0; i < 7; i++) {
    const rib = document.createElement("div");
    rib.className = "rib";
    rib.style.left = 28 + i * 7 + "%";
    map.appendChild(rib);
  }

  function renderBatchSelects() {
    const batches = store.state.batches;
    const opts = batches.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("");
    const sel = markerForm.batchId;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— 选择批次 —</option>' + opts;
    if (batches.some(b => b.id === cur)) sel.value = cur;
    const filter = $("#markerFilterBatch");
    const fcur = filter.value;
    filter.innerHTML = '<option value="">全部批次</option>' + opts;
    if (batches.some(b => b.id === fcur)) filter.value = fcur;
    $("#noBatchHint").style.display = batches.length ? "none" : "block";
  }

  function suggestCode() {
    const used = new Set(store.state.markers.map(m => m.code));
    for (let i = store.state.markers.length + 1; ; i++) {
      const code = "M-" + String(i).padStart(3, "0");
      if (!used.has(code)) return code;
    }
  }

  function renderMarkers() {
    renderBatchSelects();
    // 地图
    map.querySelectorAll(".marker").forEach(el => el.remove());
    for (const m of store.state.markers) {
      if (m.x === null || m.y === null) continue;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "marker " + m.type + (m.id === editingMarkerId ? " selected" : "");
      el.style.left = m.x + "%";
      el.style.top = m.y + "%";
      el.textContent = (m.code || "?").slice(0, 2);
      el.title = m.code;
      el.onclick = ev => { ev.stopPropagation(); editMarker(m.id); };
      map.appendChild(el);
    }
    if (pendingCoord) {
      const pin = document.createElement("div");
      pin.className = "marker pending";
      pin.style.left = pendingCoord.x + "%";
      pin.style.top = pendingCoord.y + "%";
      pin.textContent = "+";
      map.appendChild(pin);
    }
    // 列表
    const fb = $("#markerFilterBatch").value;
    const ft = $("#markerFilterType").value;
    const list = store.state.markers.filter(m =>
      (!fb || m.batchId === fb) && (!ft || m.type === ft));
    $("#markerCount").textContent = list.length;
    const batchName = id => (store.state.batches.find(b => b.id === id) || {}).name || "（批次缺失）";
    $("#markerList").innerHTML = list.length ? list.map(m => `
      <div class="card" data-id="${esc(m.id)}">
        <div><b>${esc(m.code)}</b> <span class="pill">${esc(TYPE_NAMES[m.type] || m.type)}</span>
          <span class="pill info">${esc(m.dive)}</span></div>
        <div class="muted">批次：${esc(batchName(m.batchId))} · 记录：${fmtTime(m.recordedAt)}</div>
        <div class="muted">坐标 (${m.x ?? "?"}, ${m.y ?? "?"}) · 深度 ${esc(m.depth)} · 朝向 ${esc(m.orientation || "—")}</div>
        <div>${esc(m.condition || "")}</div>
        <div class="actions">
          <button class="ghost" data-act="edit">编辑</button>
          <button class="danger" data-act="del">删除</button>
        </div>
      </div>`).join("") : '<div class="muted">暂无标记。在平面图上点选位置后填写右侧表单。</div>';
    $$("#markerList .card").forEach(card => {
      const id = card.dataset.id;
      card.querySelector('[data-act="edit"]').onclick = () => editMarker(id);
      card.querySelector('[data-act="del"]').onclick = () => {
        if (!confirm("确定删除该标记？")) return;
        store.removeMarker(id);
        if (editingMarkerId === id) resetMarkerForm();
        renderMarkers();
        toast("标记已删除");
      };
    });
  }

  map.addEventListener("click", ev => {
    const rect = map.getBoundingClientRect();
    pendingCoord = {
      x: Number(((ev.clientX - rect.left) / rect.width * 100).toFixed(2)),
      y: Number(((ev.clientY - rect.top) / rect.height * 100).toFixed(2))
    };
    $("#pendingCoord").textContent = `(${pendingCoord.x}, ${pendingCoord.y})`;
    if (!editingMarkerId) {
      markerForm.code.value = suggestCode();
      if (!markerForm.recordedAt.value) markerForm.recordedAt.value = isoToLocal(new Date().toISOString());
      if (!markerForm.dive.value) markerForm.dive.value = "DIVE-01";
    }
    renderMarkers();
  });

  function editMarker(id) {
    const m = store.state.markers.find(x => x.id === id);
    if (!m) return;
    editingMarkerId = id;
    pendingCoord = { x: m.x, y: m.y };
    $("#pendingCoord").textContent = `(${m.x}, ${m.y})`;
    $("#markerFormTitle").textContent = "编辑标记 " + m.code;
    markerForm.id.value = m.id;
    markerForm.batchId.value = m.batchId;
    markerForm.code.value = m.code;
    markerForm.type.value = m.type;
    markerForm.dive.value = m.dive;
    markerForm.recordedAt.value = isoToLocal(m.recordedAt);
    markerForm.depth.value = m.depth;
    markerForm.orientation.value = m.orientation || "";
    markerForm.condition.value = m.condition || "";
    markerForm.note.value = m.note || "";
    renderMarkers();
    markerForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetMarkerForm() {
    editingMarkerId = null;
    pendingCoord = null;
    $("#pendingCoord").textContent = "未选点";
    $("#markerFormTitle").textContent = "补录标记";
    markerForm.reset();
    markerForm.id.value = "";
    $("#markerErrors").innerHTML = "";
  }

  $("#markerCancel").onclick = () => { resetMarkerForm(); renderMarkers(); };
  $("#markerDelete").onclick = () => {
    if (!editingMarkerId) return;
    if (!confirm("确定删除该标记？")) return;
    store.removeMarker(editingMarkerId);
    resetMarkerForm();
    renderMarkers();
    toast("标记已删除");
  };

  markerForm.onsubmit = e => {
    e.preventDefault();
    if (!pendingCoord && !editingMarkerId) {
      $("#markerErrors").innerHTML = issueHtml([{ rule: "coord-range", message: "请先在平面图上点选标记位置" }], "error");
      return;
    }
    const fields = {
      batchId: markerForm.batchId.value,
      code: markerForm.code.value.trim(),
      type: markerForm.type.value,
      dive: markerForm.dive.value.trim(),
      recordedAt: localToIso(markerForm.recordedAt.value),
      depth: markerForm.depth.value.trim(),
      orientation: markerForm.orientation.value.trim(),
      condition: markerForm.condition.value.trim(),
      note: markerForm.note.value.trim()
    };
    if (pendingCoord) { fields.x = pendingCoord.x; fields.y = pendingCoord.y; }
    const r = editingMarkerId ? store.updateMarker(editingMarkerId, fields) : store.addMarker(fields);
    if (!r.ok) {
      $("#markerErrors").innerHTML = issueHtml(r.errors, "error");
      return;
    }
    resetMarkerForm();
    renderMarkers();
    toast("标记已保存");
  };

  $("#markerFilterBatch").onchange = renderMarkers;
  $("#markerFilterType").onchange = renderMarkers;

  // ---------- 封存 ----------

  let lastIssues = null;

  function renderSealStats() {
    $("#statBatches").textContent = store.state.batches.length;
    $("#statMarkers").textContent = store.state.markers.length;
    $("#statVersions").textContent = store.state.versions.length;
    $("#sealedBy").value = $("#sealedBy").value || operatorName();
    lastIssues = null;
    $("#sealResult").innerHTML = '<div class="muted">点击「检查问题」逐项核对：时间重叠、坐标范围、编号重复、必填内容。</div>';
    $("#sealedVersion").innerHTML = "";
    updateSealButton();
  }

  function updateSealButton() {
    const btn = $("#sealBtn");
    const wrap = $("#sealConfirmWrap");
    if (!lastIssues) { btn.disabled = true; wrap.style.display = "none"; return; }
    if (lastIssues.errors.length) { btn.disabled = true; wrap.style.display = "none"; return; }
    if (lastIssues.warnings.length) {
      wrap.style.display = "block";
      btn.disabled = !$("#sealConfirm").checked;
    } else {
      wrap.style.display = "none";
      btn.disabled = false;
    }
  }

  $("#sealConfirm").onchange = updateSealButton;

  $("#checkBtn").onclick = () => {
    lastIssues = store.validateWorking();
    $("#sealConfirm").checked = false;
    const { errors, warnings } = lastIssues;
    let html = "";
    if (!errors.length && !warnings.length) {
      html = '<div class="banner ok">检查通过：未发现时间重叠、坐标越界、编号重复或必填缺失。</div>';
    } else {
      if (errors.length) {
        html += `<h3>错误 ${errors.length} 条（须修复后才能封存）</h3>` + issueHtml(errors, "error");
      }
      if (warnings.length) {
        html += `<h3>提醒 ${warnings.length} 条（逐条核对后可确认封存）</h3>` + issueHtml(warnings, "warning");
      }
    }
    $("#sealResult").innerHTML = html;
    $("#sealedVersion").innerHTML = "";
    updateSealButton();
  };

  $("#sealBtn").onclick = () => {
    const sealedBy = $("#sealedBy").value.trim();
    const note = $("#sealNote").value.trim();
    const r = store.sealWorking({ sealedBy, note, confirmWarnings: $("#sealConfirm").checked });
    if (!r.ok) {
      lastIssues = r.issues || lastIssues;
      $("#sealResult").innerHTML =
        (lastIssues && lastIssues.errors.length ? `<h3>错误 ${lastIssues.errors.length} 条</h3>` + issueHtml(lastIssues.errors, "error") : "") +
        (lastIssues && lastIssues.warnings.length ? `<h3>提醒 ${lastIssues.warnings.length} 条</h3>` + issueHtml(lastIssues.warnings, "warning") : "");
      updateSealButton();
      toast("封存被拒绝，请查看问题列表");
      return;
    }
    saveOperatorName(sealedBy);
    lastIssues = null;
    $("#sealConfirm").checked = false;
    renderSealStats();
    $("#sealedVersion").innerHTML = versionCardHtml(r.version, true);
    bindVersionCard($("#sealedVersion .card"));
    toast(`已封存第 ${r.version.seq} 版（只读）`);
  };

  // ---------- 版本 ----------

  function diffHtml(diff) {
    if (!diff) return '<div class="muted">首版，无对比。</div>';
    const s = diff.summary;
    const chips = [];
    if (s.addedBatches) chips.push(`<span class="pill ok">批次 +${s.addedBatches}</span>`);
    if (s.changedBatches) chips.push(`<span class="pill warn">批次 改 ${s.changedBatches}</span>`);
    if (s.removedBatches) chips.push(`<span class="pill err">批次 -${s.removedBatches}</span>`);
    if (s.addedMarkers) chips.push(`<span class="pill ok">标记 +${s.addedMarkers}</span>`);
    if (s.changedMarkers) chips.push(`<span class="pill warn">标记 改 ${s.changedMarkers}</span>`);
    if (s.removedMarkers) chips.push(`<span class="pill err">标记 -${s.removedMarkers}</span>`);
    const head = chips.length ? chips.join(" ") : '<span class="pill">与上版一致</span>';

    const lines = [];
    for (const b of diff.batches.added) lines.push(`<div class="diff-line add">＋批次 ${esc(b.name)}</div>`);
    for (const b of diff.batches.removed) lines.push(`<div class="diff-line del">－批次 ${esc(b.name)}</div>`);
    for (const c of diff.batches.changed) {
      for (const ch of c.changes) lines.push(`<div class="diff-line chg">～批次 ${esc(c.code)}：${esc(ch.field)} 「${esc(ch.before)}」→「${esc(ch.after)}」</div>`);
    }
    for (const m of diff.markers.added) lines.push(`<div class="diff-line add">＋标记 ${esc(m.code)}（${esc(TYPE_NAMES[m.type] || m.type)}）</div>`);
    for (const m of diff.markers.removed) lines.push(`<div class="diff-line del">－标记 ${esc(m.code)}</div>`);
    for (const c of diff.markers.changed) {
      for (const ch of c.changes) lines.push(`<div class="diff-line chg">～标记 ${esc(c.code)}：${esc(ch.field)} 「${esc(ch.before)}」→「${esc(ch.after)}」</div>`);
    }
    return `<div class="row" style="margin-bottom:6px">${head}</div>` +
      (lines.length ? `<div class="diff-block">${lines.join("")}</div>` : "");
  }

  function versionCardHtml(v, isNew) {
    const originPill = v.origin === "imported"
      ? `<span class="pill info">导入 · 来源 ${esc(v.source || "未知")}</span>`
      : '<span class="pill">本地封存</span>';
    return `<div class="card ${isNew ? "new" : ""}" data-id="${esc(v.id)}">
      <div><b>第 ${v.seq} 版</b> ${originPill} ${isNew ? '<span class="pill ok">刚封存</span>' : ""}</div>
      <div class="muted">封存人 ${esc(v.sealedBy)} · ${fmtTime(v.createdAt)} · 摘要 ${esc(v.digest.slice(0, 12))}…</div>
      <div class="muted">快照：${v.snapshot.batches.length} 批次 / ${v.snapshot.markers.length} 标记${v.note ? " · 备注：" + esc(v.note) : ""}</div>
      <h3>与上一版差异</h3>
      ${diffHtml(v.diff)}
      <div class="actions">
        <button class="ghost" data-act="review">审阅</button>
        <button class="ghost" data-act="continue">复制续录</button>
        <button data-act="export">导出版本包</button>
      </div>
    </div>`;
  }

  function bindVersionCard(card) {
    if (!card) return;
    const id = card.dataset.id;
    card.querySelector('[data-act="review"]').onclick = () => reviewVersion(id);
    card.querySelector('[data-act="continue"]').onclick = () => {
      const v = store.getVersion(id);
      if (!v) return;
      if (!confirm(`把工作区替换为第 ${v.seq} 版的快照继续录？\n当前未封存的改动将被覆盖。`)) return;
      const r = store.continueFromVersion(id);
      if (!r.ok) { toast(r.error || "版本不存在"); return; }
      renderAll();
      switchTab("markers");
      toast(`已载入第 ${v.seq} 版，可继续补录`);
    };
    card.querySelector('[data-act="export"]').onclick = () => {
      const who = prompt("导出方（单位/姓名），用于对方导入时核对归属：", operatorName());
      if (who === null) return;
      if (!who.trim()) { toast("导出方不能为空"); return; }
      saveOperatorName(who.trim());
      const r = store.exportVersion(id, who.trim());
      if (!r.ok) { toast(r.error || "导出失败"); return; }
      const v = store.getVersion(id);
      download(`evidence-pack-v${v.seq}-${v.digest.slice(0, 8)}.json`, JSON.stringify(r.pack, null, 2));
      toast("版本包已导出");
    };
  }

  function renderVersions() {
    const versions = store.listVersions().slice().reverse();
    $("#versionList").innerHTML = versions.length
      ? versions.map(v => versionCardHtml(v, false)).join("")
      : '<div class="muted">还没有封存版本。到「封存」页检查并封存当前工作区。</div>';
    $$("#versionList .card").forEach(card => bindVersionCard(card));
  }

  function reviewVersion(id) {
    const v = store.getVersion(id);
    if (!v) { toast("版本不存在"); return; }
    const batchRows = v.snapshot.batches.map(b => `<tr>
      <td>${esc(b.name)}</td><td>${esc(b.leader)}</td><td>${esc(b.calibrationNo)}</td>
      <td>${fmtTime(b.startTime)} → ${fmtTime(b.endTime)}</td><td>${esc(b.imagerySummary)}</td></tr>`).join("");
    const batchName = bid => (v.snapshot.batches.find(b => b.id === bid) || {}).name || "（缺失）";
    const markerRows = v.snapshot.markers.map(m => `<tr>
      <td>${esc(m.code)}</td><td>${esc(TYPE_NAMES[m.type] || m.type)}</td><td>${esc(m.dive)}</td>
      <td>${esc(batchName(m.batchId))}</td><td>${fmtTime(m.recordedAt)}</td>
      <td>(${m.x}, ${m.y})</td><td>${esc(m.depth)}</td><td>${esc(m.condition || "")}</td></tr>`).join("");
    $("#reviewBody").innerHTML = `
      <h2>审阅第 ${v.seq} 版（只读）</h2>
      <div class="muted">封存人 ${esc(v.sealedBy)} · ${fmtTime(v.createdAt)} · ${v.origin === "imported" ? "导入自 " + esc(v.source) : "本地封存"}</div>
      <div class="muted">版本摘要：<code>${esc(v.digest)}</code></div>
      <h3>与上一版差异</h3>
      ${diffHtml(v.diff)}
      <h3>批次（${v.snapshot.batches.length}）</h3>
      <div class="tablewrap"><table class="data">
        <tr><th>名称</th><th>负责人</th><th>校准号</th><th>起止时间</th><th>影像摘要</th></tr>
        ${batchRows || '<tr><td colspan="5" class="muted">无</td></tr>'}
      </table></div>
      <h3>标记（${v.snapshot.markers.length}）</h3>
      <div class="tablewrap"><table class="data">
        <tr><th>编号</th><th>类型</th><th>潜次</th><th>批次</th><th>记录时间</th><th>坐标</th><th>深度</th><th>状态</th></tr>
        ${markerRows || '<tr><td colspan="8" class="muted">无</td></tr>'}
      </table></div>`;
    $("#reviewMask").classList.add("open");
  }

  $("#reviewClose").onclick = () => $("#reviewMask").classList.remove("open");
  $("#reviewMask").onclick = e => { if (e.target === $("#reviewMask")) $("#reviewMask").classList.remove("open"); };

  // ---------- 导入 ----------

  function renderImportLog() {
    const logs = store.state.imports.slice().reverse();
    $("#importLog").innerHTML = logs.length ? logs.map(l => `
      <div class="card">
        <div><b>${l.result === "accepted" ? "已接受" : "已拒绝"}</b>
          <span class="pill ${l.result === "accepted" ? "ok" : "err"}">${esc(l.reason || "ok")}</span></div>
        <div class="muted">${fmtTime(l.at)} · 导出方：${esc(l.exportedBy || "未知")} · 摘要 ${esc((l.digest || "").slice(0, 12)) || "—"}…</div>
      </div>`).join("") : '<div class="muted">暂无导入记录。</div>';
  }

  $("#importBtn").onclick = async () => {
    let text = $("#importText").value.trim();
    const file = $("#importFile").files[0];
    if (file) {
      text = await file.text();
    }
    if (!text) { toast("请选择版本包文件或粘贴内容"); return; }
    const r = store.importPackage(text, { source: file ? `文件 ${file.name}` : "粘贴导入" });
    $("#importResult").innerHTML =
      `<h3>校验结果</h3>` +
      r.checks.map(c => `<div class="checkline ${c.ok ? "ok" : "bad"}"><b>${c.ok ? "✓" : "✗"}</b><span><b>${esc(c.name)}</b>：${esc(c.message)}</span></div>`).join("") +
      (r.ok
        ? `<div class="banner ok">导入成功：第 ${r.version.seq} 版已作为只读历史版本入库（来源 ${esc(r.version.source)}）。现有工作区与历史版本未被改动。</div>`
        : `<div class="banner err">导入被拒绝，现有数据未被改动。</div>`);
    if (r.ok) {
      $("#importText").value = "";
      $("#importFile").value = "";
    }
    renderImportLog();
    renderSealStats();
    toast(r.ok ? "导入成功" : "导入被拒绝");
  };

  // ---------- 汇总渲染 ----------

  function renderAll() {
    renderBatches();
    renderMarkers();
    renderSealStats();
    renderVersions();
    renderImportLog();
  }

  renderAll();
})();
