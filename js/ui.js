// 页面展示层：只负责 DOM 渲染与用户交互；所有规则判断都调用 Domain，读写都经过 Store。
(() => {
  const typeNames = { ceramic: "陶片", wood: "木构件", metal: "金属件", unknown: "未知物" };

  const mapEl = document.querySelector("#map");
  const formEl = document.querySelector("#form");
  const fieldsEl = document.querySelector("#fields");
  const listEl = document.querySelector("#list");
  const filterEl = document.querySelector("#filter");
  const viewEl = document.querySelector("#view");
  const listTitleEl = document.querySelector("#listTitle");
  const diveSelectEl = document.querySelector("#diveSelect");
  const reviewerEl = document.querySelector("#reviewer");
  const diveStatusEl = document.querySelector("#diveStatus");
  const diveErrorEl = document.querySelector("#diveError");
  const revisionBoxEl = document.querySelector("#revisionBox");
  const revisionReasonEl = document.querySelector("#revisionReason");
  const reasonLabelEl = document.querySelector("#reasonLabel");
  const readonlyBannerEl = document.querySelector("#readonlyBanner");
  const readonlyTextEl = document.querySelector("#readonlyText");
  const submitBtn = document.querySelector("#submitBtn");
  const deleteBtn = document.querySelector("#deleteBtn");
  const formErrorEl = document.querySelector("#formError");

  let state = Store.load();
  // 当前选中的标本与版本：versionId 指向旧版本时进入只读的历史查看模式。
  let selected = { specimenId: null, versionId: null };
  // 地图点击后、保存前的临时坐标；编辑标本但未重新点击时沿用原坐标。
  let pendingCoords = null;

  function persist() { Store.save(state); }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }
  function fmtTime(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  }

  // 沉船平面图的船肋装饰。
  for (let i = 0; i < 7; i++) {
    const rib = document.createElement("div");
    rib.className = "rib";
    rib.style.left = 28 + i * 7 + "%";
    mapEl.appendChild(rib);
  }

  function currentDive() {
    return Domain.diveByName(state, diveSelectEl.value) || null;
  }
  function selectedSpecimen() {
    return state.specimens.find(s => s.id === selected.specimenId) || null;
  }
  function selectedVersion() {
    const s = selectedSpecimen();
    return s ? s.versions.find(v => v.id === selected.versionId) || null : null;
  }
  function isViewingHistory() {
    const s = selectedSpecimen();
    return !!s && selected.versionId !== Domain.latest(s).id;
  }

  function renderAll() {
    renderDiveSelect();
    renderDiveStatus();
    renderFormDiveOptions();
    syncFormMode();
    renderMap();
    if (viewEl.value === "timeline") renderTimeline();
    else renderList();
  }

  // ---- 潜次管理栏 ----
  function renderDiveSelect() {
    const keep = diveSelectEl.value;
    const options = state.dives.map(d =>
      `<option value="${esc(d.name)}"${d.removed ? " disabled" : ""}>${esc(d.name)}${d.removed ? "（已移除）" : ""}</option>`
    ).join("");
    diveSelectEl.innerHTML = options;
    if (keep && state.dives.some(d => d.name === keep && !d.removed)) diveSelectEl.value = keep;
    else if (!state.dives.some(d => d.name === diveSelectEl.value && !d.removed)) {
      const first = state.dives.find(d => !d.removed);
      diveSelectEl.value = first ? first.name : "";
    }
  }

  function renderDiveStatus() {
    const dive = currentDive();
    if (!dive) {
      diveStatusEl.innerHTML = '<span class="pill dead">暂无潜次，请新建</span>';
      return;
    }
    const count = Domain.activeSpecimens(state).filter(s => s.dive === dive.name).length;
    if (dive.removed) {
      diveStatusEl.innerHTML = `<span class="pill dead">已移除</span> 标本 ${count} 个；移除原因：${esc(dive.removeReason || "（未填写）")} · ${fmtTime(dive.removedAt)}`;
    } else if (Domain.isSigned(dive)) {
      diveStatusEl.innerHTML = `<span class="pill ok">已签核</span> 标本 ${count} 个 · 审核员 ${esc(dive.reviewer || "—")} · ${fmtTime(dive.signedOffAt)}。此后更正会新建修订版本并要求填写原因。`;
    } else {
      diveStatusEl.innerHTML = `<span class="pill warn">未签核</span> 标本 ${count} 个，签核前编辑直接覆盖当前记录。`;
    }
    document.querySelector("#signBtn").disabled = !dive || dive.removed || Domain.isSigned(dive);
    document.querySelector("#removeDiveBtn").disabled = !dive || dive.removed;
    reviewerEl.disabled = !dive || dive.removed || Domain.isSigned(dive);
  }

  // ---- 标本表单 ----
  function renderFormDiveOptions() {
    const select = formEl.elements.dive;
    const keep = select.value;
    select.innerHTML = state.dives.map(d =>
      `<option value="${esc(d.name)}"${d.removed ? " disabled" : ""}>${esc(d.name)}${d.removed ? "（已移除）" : ""}</option>`
    ).join("");
    if (keep && state.dives.some(d => d.name === keep)) select.value = keep;
  }

  // 表单模式：历史版本只读；未签核潜次普通编辑；已签核潜次显示修订原因框。
  function syncFormMode() {
    const history = isViewingHistory();
    const version = selectedVersion();
    const formDiveName = formEl.elements.dive.value;
    const formDive = Domain.diveByName(state, formDiveName);
    const signedForCurrentChoice = !!formDive && Domain.isSigned(formDive);
    const editing = !!selected.specimenId;

    fieldsEl.disabled = history;
    submitBtn.disabled = history;
    deleteBtn.disabled = history || !selected.specimenId;

    readonlyBannerEl.hidden = !history;
    if (history && version) {
      const index = selectedSpecimen().versions.findIndex(v => v.id === version.id) + 1;
      const total = selectedSpecimen().versions.length;
      readonlyTextEl.textContent = `历史版本 v${index}/${total}（${version.status === "superseded" ? "已被替代" : "当前"} · ${fmtTime(version.createdAt)}），仅供查阅，不会被地图与导出使用。`;
    }

    revisionBoxEl.hidden = history || !signedForCurrentChoice;
    reasonLabelEl.textContent = editing ? "修订原因（必填）" : "补录原因（必填）";
    submitBtn.textContent = history
      ? "历史版本只读"
      : (signedForCurrentChoice ? (editing ? "保存为修订版本" : "补录标本") : "保存标记");
  }

  function fillForm(version) {
    formEl.reset();
    formErrorEl.textContent = "";
    formEl.elements.specimenId.value = selected.specimenId || "";
    for (const key of ["code", "type", "dive", "depth", "orientation", "condition", "note"]) {
      if (formEl.elements[key]) formEl.elements[key].value = version[key] ?? "";
    }
    revisionReasonEl.value = "";
  }

  function startNew() {
    selected = { specimenId: null, versionId: null };
    formEl.reset();
    formErrorEl.textContent = "";
    formEl.elements.specimenId.value = "";
    const n = state.specimens.length + 1;
    formEl.elements.code.value = "M-" + String(n).padStart(3, "0");
    formEl.elements.dive.value = diveSelectEl.value;
    revisionReasonEl.value = "";
    syncFormMode();
    renderMap();
    renderList();
  }

  function editLatest(specimenId) {
    const s = state.specimens.find(x => x.id === specimenId);
    if (!s) return;
    selected = { specimenId: s.id, versionId: Domain.latest(s).id };
    pendingCoords = null;
    fillForm(Domain.latest(s));
    syncFormMode();
    renderMap();
    renderList();
  }

  function viewVersion(specimenId, versionId) {
    const s = state.specimens.find(x => x.id === specimenId);
    if (!s) return;
    selected = { specimenId: s.id, versionId };
    pendingCoords = null;
    const v = s.versions.find(x => x.id === versionId);
    fillForm(v);
    syncFormMode();
    renderMap();
    renderList();
  }

  // ---- 地图：仅显示最新版本 ----
  function renderMap() {
    mapEl.querySelectorAll(".marker").forEach(el => el.remove());
    let rows = Domain.activeSpecimens(state);
    if (filterEl.value) rows = rows.filter(m => m.type === filterEl.value);
    rows.forEach(mark => {
      const el = document.createElement("button");
      el.className = "marker " + mark.type
        + (mark.specimenId === selected.specimenId && !isViewingHistory() ? " selected" : "")
        + (mark.revised ? " revised" : "");
      el.style.left = mark.x + "%";
      el.style.top = mark.y + "%";
      el.title = `${mark.code}（最新版本${mark.revised ? "，含 " + mark.versionCount + " 个版本" : ""}）`;
      el.textContent = mark.code.slice(0, 2);
      el.onclick = event => { event.stopPropagation(); editLatest(mark.specimenId); };
      mapEl.appendChild(el);
    });
  }

  // ---- 列表：仅最新版本；含修订角标 ----
  function renderList() {
    listTitleEl.textContent = "标记列表（最新版本）";
    listEl.className = "list";
    let rows = Domain.activeSpecimens(state);
    if (filterEl.value) rows = rows.filter(m => m.type === filterEl.value);
    if (!rows.length) {
      listEl.innerHTML = '<div class="muted">当前筛选下没有标本。</div>';
      return;
    }
    listEl.innerHTML = rows.map(m =>
      `<div class="item ${m.specimenId === selected.specimenId && !isViewingHistory() ? "active" : ""}" data-id="${m.specimenId}">
        <b>${esc(m.code)}</b> <span class="pill">${typeNames[m.type]}</span>
        ${m.revised ? '<span class="pill warn">已修订 v' + m.versionCount + '</span>' : ''}
        <div class="muted">${esc(m.dive)} · ${esc(m.depth)} · ${esc(m.orientation)}</div>
        <div>${esc(m.condition)}</div>
        ${m.revised ? '<div class="muted">最近修订：' + esc(m.revisionReason || "（未填写）") + " · " + fmtTime(m.createdAt) + '</div>' : ''}
      </div>`
    ).join("");
    listEl.querySelectorAll("[data-id]").forEach(el => {
      el.onclick = () => editLatest(el.dataset.id);
    });
  }

  // ---- 历史时间线：全部版本与潜次事件 ----
  function renderTimeline() {
    listTitleEl.textContent = "历史时间线（含全部版本）";
    listEl.className = "timeline";
    const groups = Domain.historyTimeline(state);
    const typeFilter = filterEl.value;
    listEl.innerHTML = groups.map(group => {
      const head = `<div class="dive-head"><b>${esc(group.name)}</b>
        ${group.signed ? '<span class="pill ok">已签核</span>' : '<span class="pill warn">未签核</span>'}
        ${group.removed ? '<span class="pill dead">已移除</span>' : ""}</div>`;
      const body = group.events.map(e => {
        if (e.kind === "signoff") {
          return `<div class="tl-event signoff">✅ <b>潜次签核</b> <span class="time">${fmtTime(e.at)}</span><div class="muted">审核员：${esc(e.reviewer || "—")}；此后更正将新建修订版本</div></div>`;
        }
        if (e.kind === "remove") {
          return `<div class="tl-event remove">⛔ <b>潜次移除</b> <span class="time">${fmtTime(e.at)}</span><div class="muted">原因：${esc(e.reason || "（未填写）")}</div></div>`;
        }
        if (typeFilter && e.type !== typeFilter) return "";
        const label = e.kind === "revise"
          ? "<b>修订</b>"
          : (e.kind === "late-add" ? "<b>签核后补录</b>" : "<b>登记标本</b>");
        const badge = e.superseded ? '<span class="pill dead">已被替代</span>'
          : (e.kind === "revise" ? '<span class="pill warn">当前修订</span>' : '<span class="pill">当前版本</span>');
        const reason = e.revisionReason
          ? `<div class="muted">原因：${esc(e.revisionReason)}</div>` : "";
        return `<div class="tl-event ${e.kind}" data-specimen="${e.specimenId}" data-version="${e.versionId}">
          ${label} <b>${esc(e.code)}</b> <span class="pill">${typeNames[e.type] || ""}</span> ${badge}
          <span class="time">${fmtTime(e.at)}</span>
          <div class="muted">${esc(e.depth)} · 坐标 ${e.x}%, ${e.y}% · ${esc(e.condition)}</div>
          ${reason}
        </div>`;
      }).join("");
      return `<div class="item dive-group ${group.removed ? "removed" : ""}">${head}${body || '<div class="muted">无标本记录</div>'}</div>`;
    }).join("");
    listEl.querySelectorAll(".tl-event[data-specimen]").forEach(el => {
      el.onclick = () => viewVersion(el.dataset.specimen, el.dataset.version);
    });
  }

  // ---- 交互绑定 ----
  mapEl.addEventListener("click", event => {
    if (isViewingHistory()) return; // 历史查看模式下不接受新坐标
    const rect = mapEl.getBoundingClientRect();
    const coords = {
      x: Number(((event.clientX - rect.left) / rect.width * 100).toFixed(2)),
      y: Number(((event.clientY - rect.top) / rect.height * 100).toFixed(2))
    };
    if (!selected.specimenId) startNew();
    pendingCoords = coords;
  });

  formEl.addEventListener("submit", event => {
    event.preventDefault();
    formErrorEl.textContent = "";
    const input = Object.fromEntries(new FormData(formEl).entries());
    input.revisionReason = revisionReasonEl.value;
    let coords;
    const specimen = selectedSpecimen();
    if (pendingCoords) coords = pendingCoords;
    else if (specimen && selected.versionId === Domain.latest(specimen).id) {
      coords = { x: Domain.latest(specimen).x, y: Domain.latest(specimen).y };
    } else {
      coords = { x: 50, y: 50 };
    }
    const result = Domain.saveSpecimen(state, input, coords);
    if (!result.ok) {
      formErrorEl.textContent = result.error;
      return;
    }
    persist();
    // 保存后定位到刚保存的标本最新版本。
    const target = specimen
      || state.specimens.find(s => Domain.latest(s).code === input.code.trim());
    if (target) {
      selected = { specimenId: target.id, versionId: Domain.latest(target).id };
      fillForm(Domain.latest(target));
    } else {
      startNew();
    }
    pendingCoords = null;
    renderAll();
  });

  deleteBtn.onclick = () => {
    if (!selected.specimenId) return;
    const result = Domain.deleteSpecimen(state, selected.specimenId);
    if (!result.ok) {
      formErrorEl.textContent = result.error;
      return;
    }
    persist();
    selected = { specimenId: null, versionId: null };
    pendingCoords = null;
    startNew();
    renderAll();
  };

  document.querySelector("#resumeBtn").onclick = () => {
    const s = selectedSpecimen();
    if (s) editLatest(s.id);
    else startNew();
  };

  // 切换表单内潜次选择时，需即时切换“修订原因”框。
  formEl.elements.dive.addEventListener("change", () => {
    syncFormMode();
  });

  diveSelectEl.addEventListener("change", () => {
    reviewerEl.value = "";
    diveErrorEl.textContent = "";
    startNew();
    renderDiveStatus();
  });

  document.querySelector("#signBtn").onclick = () => {
    const result = Domain.signOffDive(state, diveSelectEl.value, reviewerEl.value);
    diveErrorEl.textContent = result.ok ? "" : result.error;
    if (!result.ok) return;
    persist();
    renderAll();
  };

  document.querySelector("#removeDiveBtn").onclick = () => {
    const name = diveSelectEl.value;
    const dive = Domain.diveByName(state, name);
    if (!dive) return;
    // 规则：仅“含已签核标本”的潜次必须填写移除原因；其余确认即可。
    const needsReason = Domain.isSigned(dive)
      && Domain.activeSpecimens(state).some(s => s.dive === name);
    const hasAnySpecimen = state.specimens.some(s => Domain.latest(s).dive === name);
    let reason = "";
    if (needsReason) {
      reason = window.prompt(`潜次 ${name} 含已签核标本，移除请填写原因（将记入历史时间线）：`, "") ?? "";
      if (!reason.trim()) {
        diveErrorEl.textContent = "含已签核标本时移除必须填写原因";
        return;
      }
    } else if (hasAnySpecimen) {
      if (!window.confirm(`潜次 ${name} 尚未签核，移除后其标本将仅在历史时间线保留，确认继续？`)) return;
    } else if (!window.confirm(`确认移除空潜次 ${name}？`)) {
      return;
    }
    const result = Domain.removeDive(state, name, reason);
    diveErrorEl.textContent = result.ok ? "" : result.error;
    if (!result.ok) return;
    persist();
    startNew();
    renderAll();
  };

  document.querySelector("#addDiveBtn").onclick = () => {
    const name = window.prompt("新潜次名称，例如 DIVE-03：", "");
    if (name === null) return;
    const result = Domain.addDive(state, name);
    diveErrorEl.textContent = result.ok ? "" : result.error;
    if (!result.ok) return;
    persist();
    diveSelectEl.value = name.trim();
    startNew();
    renderAll();
  };

  document.querySelector("#exportBtn").onclick = () => {
    const payload = Domain.exportData(state);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dive-specimens-latest.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  filterEl.onchange = renderAll;
  viewEl.onchange = renderAll;

  renderAll();
})();
