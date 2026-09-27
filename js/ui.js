/* ============================================================
 * 展示层（ui.js）
 * 只负责 DOM 渲染与交互，把用户操作转交给 domain（规则层），
 * 持久化交给 store（数据存取层）。本文件不直接写业务规则。
 * ============================================================ */
(function () {
  "use strict";

  const store = window.UWA.store;
  const domain = window.UWA.domain;

  const TYPE_NAMES = { ceramic: "陶片", wood: "木构件", metal: "金属件", unknown: "未知物" };
  const NEW_DIVE = "__new__";

  /* ---------- DOM ---------- */
  const map = document.querySelector("#map");
  const form = document.querySelector("#form");
  const list = document.querySelector("#list");
  const filter = document.querySelector("#filter");
  const view = document.querySelector("#view");
  const listTitle = document.querySelector("#listTitle");
  const diveSelect = document.querySelector("#diveSelect");
  const newDiveRow = document.querySelector("#newDiveRow");
  const newDiveInput = document.querySelector("#newDiveInput");
  const reasonRow = document.querySelector("#reasonRow");
  const reasonInput = document.querySelector("#revisionReason");
  const sealedBanner = document.querySelector("#sealedBanner");
  const submitBtn = document.querySelector("#submitBtn");
  const deleteBtn = document.querySelector("#deleteBtn");
  const exportBtn = document.querySelector("#exportBtn");
  const diveList = document.querySelector("#diveList");
  const toastEl = document.querySelector("#toast");
  const modalOverlay = document.querySelector("#modalOverlay");
  const modalTitle = document.querySelector("#modalTitle");
  const modalHint = document.querySelector("#modalHint");
  const modalReason = document.querySelector("#modalReason");
  const modalError = document.querySelector("#modalError");

  let state = store.load();
  let pending = null; // 地图上待保存的坐标 {x, y}
  let modalSubmit = null;

  /* ---------- 小工具 ---------- */

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
  }

  let toastTimer = null;
  function toast(message, isError) {
    toastEl.textContent = message;
    toastEl.className = "toast show" + (isError ? " error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.className = "toast"), 2600);
  }

  function persist() {
    store.save(state);
  }

  /* ---------- 弹窗（移除原因） ---------- */

  function openModal(title, hint, onSubmit) {
    modalTitle.textContent = title;
    modalHint.textContent = hint;
    modalReason.value = "";
    modalError.textContent = "";
    modalSubmit = onSubmit;
    modalOverlay.classList.add("show");
    modalReason.focus();
  }

  function closeModal() {
    modalOverlay.classList.remove("show");
    modalSubmit = null;
  }

  document.querySelector("#modalCancel").onclick = closeModal;
  modalOverlay.addEventListener("click", (event) => {
    if (event.target === modalOverlay) closeModal();
  });
  document.querySelector("#modalOk").onclick = () => {
    const reason = modalReason.value.trim();
    if (!reason) {
      modalError.textContent = "请填写原因。";
      return;
    }
    if (modalSubmit) modalSubmit(reason);
  };

  /* ---------- 表单模式 ---------- */

  function currentSpecimenId() {
    return form.id.value || null;
  }

  function renderDiveOptions(selected) {
    const dives = domain.listDives(state);
    diveSelect.innerHTML =
      dives
        .map((d) => {
          const label = d.code + (d.signedOffAt ? "（已签核）" : "");
          return '<option value="' + esc(d.code) + '">' + esc(label) + "</option>";
        })
        .join("") +
      '<option value="' + NEW_DIVE + '">＋新潜次…</option>';
    if (selected && dives.some((d) => d.code === selected)) diveSelect.value = selected;
    else if (selected === NEW_DIVE) diveSelect.value = NEW_DIVE;
    syncNewDiveRow();
  }

  function syncNewDiveRow() {
    newDiveRow.style.display = diveSelect.value === NEW_DIVE ? "block" : "none";
  }

  function renderFormMode() {
    const id = currentSpecimenId();
    const locked = id ? domain.isSpecimenLocked(state, id) : false;
    sealedBanner.style.display = locked ? "block" : "none";
    reasonRow.style.display = locked ? "block" : "none";
    form.code.disabled = locked;
    diveSelect.disabled = locked;
    submitBtn.textContent = locked ? "提交修订" : "保存标记";
  }

  function resetForm() {
    form.reset();
    form.id.value = "";
    renderDiveOptions(firstUnsignedDive());
    newDiveInput.value = "";
    renderFormMode();
  }

  function firstUnsignedDive() {
    const dive = domain.listDives(state).find((d) => !d.signedOffAt);
    return dive ? dive.code : null;
  }

  function edit(specimenId) {
    const version = domain.latestVersion(state, specimenId);
    if (!version) return;
    form.id.value = specimenId;
    form.code.value = version.code;
    form.type.value = version.type;
    renderDiveOptions(version.dive);
    form.depth.value = version.depth;
    form.orientation.value = version.orientation;
    form.condition.value = version.condition;
    form.note.value = version.note;
    reasonInput.value = "";
    pending = { x: version.x, y: version.y };
    renderAll();
  }

  /* ---------- 渲染：地图 ---------- */

  function renderMap(versions) {
    map.querySelectorAll(".marker").forEach((el) => el.remove());
    versions.forEach((v) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "marker " + v.type + (v.specimenId === currentSpecimenId() ? " selected" : "");
      el.style.left = v.x + "%";
      el.style.top = v.y + "%";
      el.title = v.code + " · " + (TYPE_NAMES[v.type] || v.type);
      el.textContent = v.code.slice(0, 2);
      el.onclick = (event) => {
        event.stopPropagation();
        edit(v.specimenId);
      };
      map.appendChild(el);
    });
  }

  /* ---------- 渲染：潜次面板 ---------- */

  function renderDives() {
    const versions = domain.listCurrentVersions(state);
    const dives = domain.listDives(state);
    diveList.innerHTML = dives
      .map((d) => {
        const count = versions.filter((v) => v.dive === d.code).length;
        const status = d.signedOffAt
          ? '<span class="chip signed">已签核</span><span class="muted">' +
            esc(fmtTime(d.signedOffAt)) + " · " + esc(d.signedOffBy || "") + "</span>"
          : '<span class="chip unsigned">未签核</span>';
        const action = d.signedOffAt
          ? ""
          : '<button type="button" class="secondary" data-signoff="' + esc(d.code) + '">签核定稿</button>';
        return (
          '<div class="dive-row"><div><b>' + esc(d.code) + "</b> " + status +
          '<div class="muted">现存标本 ' + count + " 件</div></div>" + action + "</div>"
        );
      })
      .join("");
    diveList.querySelectorAll("[data-signoff]").forEach((btn) => {
      btn.onclick = () => {
        const code = btn.dataset.signoff;
        if (!window.confirm("签核后潜次 " + code + " 的标本将定稿：此后更正会生成修订版本，移除需填写原因。确认签核？")) return;
        const result = domain.signOffDive(state, code, "现场审核员");
        if (!result.ok) return toast(result.error, true);
        persist();
        renderAll();
        toast("潜次 " + code + " 已签核定稿。");
      };
    });
  }

  /* ---------- 渲染：列表 / 时间线 ---------- */

  function applyFilter(versions) {
    return filter.value ? versions.filter((v) => v.type === filter.value) : versions;
  }

  function renderList() {
    listTitle.textContent = "标本列表（最新版本）";
    list.className = "list";
    const versions = applyFilter(domain.listCurrentVersions(state));
    if (!versions.length) {
      list.innerHTML = '<div class="muted">暂无标本。</div>';
      return;
    }
    list.innerHTML = versions
      .map((v) => {
        const locked = domain.isSpecimenLocked(state, v.specimenId);
        const tags =
          '<span class="pill">' + esc(TYPE_NAMES[v.type] || v.type) + "</span>" +
          (locked ? '<span class="tag sealed">已签核</span>' : "") +
          (v.revision > 1 ? '<span class="tag rev">第' + v.revision + "版</span>" : "");
        return (
          '<div class="item' + (v.specimenId === currentSpecimenId() ? " active" : "") +
          '" data-id="' + esc(v.specimenId) + '"><b>' + esc(v.code) + "</b> " + tags +
          '<div class="muted">' + esc(v.dive) + " · " + esc(v.depth) + " · " + esc(v.orientation) + "</div>" +
          "<div>" + esc(v.condition) + "</div></div>"
        );
      })
      .join("");
    list.querySelectorAll("[data-id]").forEach((el) => (el.onclick = () => edit(el.dataset.id)));
  }

  function versionLine(entry) {
    const v = entry.version;
    const tag = entry.isCurrent ? '<span class="tag current">当前版本</span>' : '<span class="tag superseded">已被替代</span>';
    const reason = v.reason ? '<div class="muted">修订原因：' + esc(v.reason) + "</div>" : "";
    return (
      '<div class="version' + (entry.superseded ? " old" : "") + '"><div><b>第' + v.revision + "版</b> " + tag +
      '<span class="muted"> ' + esc(fmtTime(v.createdAt)) + "</span></div>" +
      '<div class="muted">' + esc(v.condition || "—") + " · 坐标(" + v.x + "%, " + v.y + "%) · " + esc(v.depth || "—") + "</div>" +
      reason + "</div>"
    );
  }

  function renderTimeline() {
    listTitle.textContent = "潜次时间线（含历史版本）";
    list.className = "timeline";
    // 时间线包含已移除的标本：它们仍是历史的一部分
    const all = Object.values(state.specimens)
      .map((s) => ({ specimen: s, version: state.versions[s.currentVersionId] }))
      .filter((entry) => entry.version)
      .filter((entry) => !filter.value || entry.version.type === filter.value)
      .sort((a, b) => a.version.createdAt.localeCompare(b.version.createdAt));
    if (!all.length) {
      list.innerHTML = '<div class="muted">暂无记录。</div>';
      return;
    }
    const groups = {};
    all.forEach((entry) => {
      (groups[entry.version.dive] ||= []).push(entry);
    });
    list.innerHTML = Object.keys(groups)
      .sort()
      .map((diveCode) => {
        const dive = domain.getDive(state, diveCode);
        const chip = dive && dive.signedOffAt
          ? '<span class="chip signed">已签核 ' + esc(fmtTime(dive.signedOffAt)) + "</span>"
          : '<span class="chip unsigned">未签核</span>';
        const items = groups[diveCode]
          .map((entry) => {
            const s = entry.specimen;
            const v = entry.version;
            const removed = s.removedAt
              ? '<div class="removed-note">已于 ' + esc(fmtTime(s.removedAt)) + " 移除" +
                (s.removalReason ? "：" + esc(s.removalReason) : "") + "</div>"
              : "";
            const history = domain
              .versionHistory(state, s.id)
              .map(versionLine)
              .join("");
            return (
              '<details class="spec"><summary><b>' + esc(v.code) + "</b> " +
              '<span class="pill">' + esc(TYPE_NAMES[v.type] || v.type) + "</span>" +
              (s.removedAt ? '<span class="tag removed">已移除</span>' : "") +
              '<span class="muted"> ' + esc(fmtTime(v.createdAt)) + "</span></summary>" +
              removed + '<div class="versions">' + history + "</div></details>"
            );
          })
          .join("");
        return '<div class="item"><b>' + esc(diveCode) + "</b> " + chip + items + "</div>";
      })
      .join("");
  }

  /* ---------- 总渲染 ---------- */

  function renderAll() {
    const versions = applyFilter(domain.listCurrentVersions(state));
    renderMap(versions);
    renderDives();
    if (view.value === "timeline") renderTimeline();
    else renderList();
    renderFormMode();
  }

  /* ---------- 事件 ---------- */

  map.addEventListener("click", (event) => {
    const rect = map.getBoundingClientRect();
    pending = {
      x: Number((((event.clientX - rect.left) / rect.width) * 100).toFixed(2)),
      y: Number((((event.clientY - rect.top) / rect.height) * 100).toFixed(2)),
    };
    resetForm();
    form.code.value = "M-" + String(domain.listCurrentVersions(state).length + 1).padStart(3, "0");
    renderAll();
  });

  diveSelect.onchange = syncNewDiveRow;

  form.onsubmit = (event) => {
    event.preventDefault();
    if (!pending) pending = { x: 50, y: 50 };
    const diveValue = diveSelect.value === NEW_DIVE ? newDiveInput.value : diveSelect.value;
    const input = {
      specimenId: currentSpecimenId() || undefined,
      code: form.code.value,
      type: form.type.value,
      dive: diveValue,
      x: pending.x,
      y: pending.y,
      depth: form.depth.value,
      orientation: form.orientation.value,
      condition: form.condition.value,
      note: form.note.value,
      revisionReason: reasonInput.value,
    };
    const result = domain.saveSpecimen(state, input);
    if (!result.ok) return toast(result.error, true);
    persist();
    form.id.value = result.version.specimenId;
    reasonInput.value = "";
    renderAll();
    if (result.mode === "revision") toast("已生成第 " + result.version.revision + " 版修订，旧版本保留在历史中。");
    else if (result.mode === "created") toast("标本 " + result.version.code + " 已登记。");
    else toast("标本 " + result.version.code + " 已更新。");
  };

  deleteBtn.onclick = () => {
    const id = currentSpecimenId();
    if (!id) return toast("请先在列表或地图上选择标本。", true);
    const version = domain.latestVersion(state, id);
    if (!version) return;
    if (domain.isSpecimenLocked(state, id)) {
      openModal("移除已签核标本", "标本 " + version.code + " 所属潜次已签核定稿，移除必须填写原因，记录会保留在时间线中。", (reason) => {
        const result = domain.removeSpecimen(state, id, reason);
        if (!result.ok) {
          modalError.textContent = result.error;
          return;
        }
        closeModal();
        persist();
        resetForm();
        pending = null;
        renderAll();
        toast("标本 " + version.code + " 已移除，原因已记录。");
      });
      return;
    }
    if (!window.confirm("确认删除标本 " + version.code + "？（未签核，可直接删除）")) return;
    const result = domain.removeSpecimen(state, id, "");
    if (!result.ok) return toast(result.error, true);
    persist();
    resetForm();
    pending = null;
    renderAll();
    toast("标本 " + version.code + " 已删除。");
  };

  exportBtn.onclick = () => {
    const data = domain.buildExport(state);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dive-specimens-latest.json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("已导出 " + data.specimens.length + " 件标本的最新版本。");
  };

  filter.onchange = renderAll;
  view.onchange = renderAll;

  /* ---------- 初始化 ---------- */

  for (let i = 0; i < 7; i++) {
    const rib = document.createElement("div");
    rib.className = "rib";
    rib.style.left = 28 + i * 7 + "%";
    map.appendChild(rib);
  }
  resetForm();
  renderAll();
})();
