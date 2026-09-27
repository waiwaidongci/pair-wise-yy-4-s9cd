/* ============================================================
 * 规则层（domain.js）
 * 只负责业务规则与状态变更，不触碰 DOM / localStorage：
 *  - 潜次签核：签核后标本定稿
 *  - 标本版本：签核前直接覆盖；签核后更正生成新修订，旧版本标记“已被替代”
 *  - 移除：已签核潜次的标本必须填写移除原因
 *  - 查询：地图/导出取最新版本，时间线取完整历史
 * 所有变更函数返回 { ok, error?, ... }，由调用方（ui.js）决定如何提示。
 * ============================================================ */
(function (global) {
  "use strict";

  const store = global.UWA.store;

  const EDITABLE_FIELDS = ["code", "type", "dive", "x", "y", "depth", "orientation", "condition", "note"];

  function fail(error) {
    return { ok: false, error };
  }

  function normalizeDiveCode(code) {
    return String(code || "").trim().toUpperCase();
  }

  /* ---------- 查询（selectors） ---------- */

  function getDive(state, code) {
    return state.dives[normalizeDiveCode(code)] || null;
  }

  function listDives(state) {
    return Object.values(state.dives).sort((a, b) => a.code.localeCompare(b.code));
  }

  function isDiveSigned(state, code) {
    const dive = getDive(state, code);
    return !!(dive && dive.signedOffAt);
  }

  function isSpecimenLocked(state, specimenId) {
    const specimen = state.specimens[specimenId];
    if (!specimen) return false;
    const version = state.versions[specimen.currentVersionId];
    return !!version && isDiveSigned(state, version.dive);
  }

  function latestVersion(state, specimenId) {
    const specimen = state.specimens[specimenId];
    return specimen ? state.versions[specimen.currentVersionId] || null : null;
  }

  /* 地图 / 导出用：每个标本的最新版本，已移除的不出现 */
  function listCurrentVersions(state) {
    return Object.values(state.specimens)
      .filter((s) => !s.removedAt)
      .map((s) => state.versions[s.currentVersionId])
      .filter(Boolean)
      .sort((a, b) => a.code.localeCompare(b.code) || a.createdAt.localeCompare(b.createdAt));
  }

  /* 历史时间线用：每个标本的全部版本，新→旧，附“已被替代”标记 */
  function versionHistory(state, specimenId) {
    const specimen = state.specimens[specimenId];
    if (!specimen) return [];
    return Object.values(state.versions)
      .filter((v) => v.specimenId === specimenId)
      .sort((a, b) => b.revision - a.revision)
      .map((v) => ({
        version: v,
        isCurrent: v.id === specimen.currentVersionId,
        superseded: v.id !== specimen.currentVersionId,
      }));
  }

  function findSpecimenByCode(state, code) {
    const wanted = String(code || "").trim();
    return (
      Object.values(state.specimens).find((s) => {
        const v = state.versions[s.currentVersionId];
        return v && v.code === wanted;
      }) || null
    );
  }

  /* ---------- 潜次 ---------- */

  function ensureDive(state, code) {
    const normalized = normalizeDiveCode(code);
    if (!normalized) return fail("潜次编号不能为空。");
    if (!state.dives[normalized]) {
      state.dives[normalized] = { code: normalized, signedOffAt: null, signedOffBy: null };
    }
    return { ok: true, dive: state.dives[normalized] };
  }

  function signOffDive(state, code, signedBy) {
    const dive = getDive(state, code);
    if (!dive) return fail("潜次不存在：" + normalizeDiveCode(code));
    if (dive.signedOffAt) return fail("潜次 " + dive.code + " 已签核，无需重复操作。");
    const count = listCurrentVersions(state).filter((v) => v.dive === dive.code).length;
    if (count === 0) return fail("潜次 " + dive.code + " 下没有标本，不能签核。");
    dive.signedOffAt = store.now();
    dive.signedOffBy = String(signedBy || "").trim() || "现场审核员";
    return { ok: true, dive };
  }

  /* ---------- 标本 ---------- */

  function pickEditable(input) {
    const data = {};
    for (const key of EDITABLE_FIELDS) {
      if (input[key] !== undefined) data[key] = input[key];
    }
    return data;
  }

  /**
   * 保存标本（新增或更正）。
   * input: { specimenId?, code, type, dive, x, y, depth, orientation, condition, note, revisionReason? }
   *  - 未签核潜次：直接覆盖当前版本（定稿前照常编辑）
   *  - 已签核潜次：必须填 revisionReason，生成新修订，旧版本保留并标记“已被替代”
   */
  function saveSpecimen(state, input) {
    const data = pickEditable(input);
    const revisionReason = String(input.revisionReason || "").trim();

    if (input.specimenId && state.specimens[input.specimenId]) {
      const specimen = state.specimens[input.specimenId];
      if (specimen.removedAt) return fail("该标本已被移除，不能编辑。");
      const current = state.versions[specimen.currentVersionId];

      if (isDiveSigned(state, current.dive)) {
        // 已签核：只能更正内容，编号与潜次保持定稿时的值
        if (!revisionReason) return fail("该标本所属潜次已签核，更正必须填写修订原因。");
        const version = {
          id: store.uid(),
          specimenId: specimen.id,
          revision: current.revision + 1,
          code: current.code,
          type: data.type !== undefined ? data.type : current.type,
          dive: current.dive,
          x: data.x !== undefined ? data.x : current.x,
          y: data.y !== undefined ? data.y : current.y,
          depth: data.depth !== undefined ? data.depth : current.depth,
          orientation: data.orientation !== undefined ? data.orientation : current.orientation,
          condition: data.condition !== undefined ? data.condition : current.condition,
          note: data.note !== undefined ? data.note : current.note,
          reason: revisionReason,
          supersedes: current.id,
          createdAt: store.now(),
        };
        state.versions[version.id] = version;
        specimen.currentVersionId = version.id;
        return { ok: true, mode: "revision", version };
      }

      // 未签核：直接覆盖原记录
      const targetDive = normalizeDiveCode(data.dive !== undefined ? data.dive : current.dive);
      if (isDiveSigned(state, targetDive)) {
        return fail("潜次 " + targetDive + " 已签核，不能把标本移入。");
      }
      const ensured = ensureDive(state, targetDive);
      if (!ensured.ok) return ensured;
      Object.assign(current, data, { dive: targetDive });
      return { ok: true, mode: "updated", version: current };
    }

    // 新增标本
    if (!String(data.code || "").trim()) return fail("标本编号不能为空。");
    const diveCode = normalizeDiveCode(data.dive);
    if (!diveCode) return fail("潜次编号不能为空。");
    if (isDiveSigned(state, diveCode)) {
      return fail("潜次 " + diveCode + " 已签核，不能新增标本，请改用未签核的潜次。");
    }
    if (findSpecimenByCode(state, data.code)) {
      return fail("编号 " + data.code + " 已存在，请更换编号。");
    }
    const ensured = ensureDive(state, diveCode);
    if (!ensured.ok) return ensured;
    const specimen = { id: store.uid(), currentVersionId: null, removedAt: null, removalReason: "" };
    const version = {
      id: store.uid(),
      specimenId: specimen.id,
      revision: 1,
      code: String(data.code).trim(),
      type: data.type || "unknown",
      dive: diveCode,
      x: Number(data.x) || 0,
      y: Number(data.y) || 0,
      depth: data.depth || "",
      orientation: data.orientation || "",
      condition: data.condition || "",
      note: data.note || "",
      reason: "",
      supersedes: null,
      createdAt: store.now(),
    };
    specimen.currentVersionId = version.id;
    state.specimens[specimen.id] = specimen;
    state.versions[version.id] = version;
    return { ok: true, mode: "created", version };
  }

  /**
   * 移除标本。已签核潜次的标本必须填写移除原因；
   * 记录保留（不再出现在地图/导出），时间线中可查到移除信息。
   */
  function removeSpecimen(state, specimenId, reason) {
    const specimen = state.specimens[specimenId];
    if (!specimen) return fail("标本不存在。");
    if (specimen.removedAt) return fail("该标本已被移除。");
    const trimmed = String(reason || "").trim();
    if (isSpecimenLocked(state, specimenId) && !trimmed) {
      return fail("该标本所属潜次已签核，移除必须填写原因。");
    }
    specimen.removedAt = store.now();
    specimen.removalReason = trimmed;
    return { ok: true, specimen };
  }

  /* ---------- 导出：只含每个标本的最新版本 ---------- */

  function buildExport(state) {
    return {
      exportedAt: store.now(),
      dives: listDives(state),
      specimens: listCurrentVersions(state).map((v) => ({
        code: v.code,
        type: v.type,
        dive: v.dive,
        x: v.x,
        y: v.y,
        depth: v.depth,
        orientation: v.orientation,
        condition: v.condition,
        note: v.note,
        revision: v.revision,
        revisionReason: v.reason,
        updatedAt: v.createdAt,
      })),
    };
  }

  global.UWA.domain = {
    EDITABLE_FIELDS,
    getDive,
    listDives,
    isDiveSigned,
    isSpecimenLocked,
    latestVersion,
    listCurrentVersions,
    versionHistory,
    findSpecimenByCode,
    ensureDive,
    signOffDive,
    saveSpecimen,
    removeSpecimen,
    buildExport,
  };
})(typeof window !== "undefined" ? window : globalThis);
