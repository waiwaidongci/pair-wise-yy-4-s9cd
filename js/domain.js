// 规则判断层：所有业务规则集中于此，不接触 DOM。
// 核心规则：
//   1. 标本所属潜次签核前：编辑直接覆盖当前版本（照常编辑）。
//   2. 潜次签核后更正：旧版本保留并标记 superseded，另建 current 修订版本，必须填写原因。
//   3. 签核后补录的新标本同样需要原因。
//   4. 地图与导出只投影每个标本的最新版本；被移除潜次下的标本仅在历史时间线中保留。
//   5. 移除含已签核标本的潜次必须填写原因。
const Domain = (() => {
  const FIELDS = ["code", "type", "dive", "x", "y", "depth", "orientation", "condition", "note"];

  const fail = error => ({ ok: false, error });
  const pass = () => ({ ok: true, error: null });

  function diveByName(state, name) {
    return state.dives.find(d => d.name === name) || null;
  }
  function diveById(state, id) {
    return state.dives.find(d => d.id === id) || null;
  }
  const latest = specimen => specimen.versions[specimen.versions.length - 1];
  const isSigned = dive => !!dive && !!dive.signedOffAt;
  const isRemoved = dive => !!dive && dive.removed;

  // 最新版本投影：每个标本一行，附带版本计数与“已被修订过”标记。
  function activeSpecimens(state) {
    const rows = [];
    for (const s of state.specimens) {
      const v = latest(s);
      const dive = diveByName(state, v.dive);
      if (isRemoved(dive)) continue;
      rows.push({
        specimenId: s.id,
        versionId: v.id,
        revised: s.versions.length > 1,
        versionCount: s.versions.length,
        ...v
      });
    }
    return rows;
  }

  function hasSignedSpecimens(state, dive) {
    return state.specimens.some(s => {
      const v = latest(s);
      return v.dive === dive.name && isSigned(diveByName(state, v.dive));
    });
  }

  function addDive(state, name) {
    name = (name || "").trim();
    if (!name) return fail("请输入潜次名称，例如 DIVE-03");
    if (diveByName(state, name)) return fail("潜次 " + name + " 已存在");
    state.dives.push({
      id: crypto.randomUUID(), name,
      signedOffAt: null, reviewer: null,
      removed: false, removeReason: null
    });
    return pass();
  }

  function signOffDive(state, name, reviewer) {
    const dive = diveByName(state, name);
    if (!dive) return fail("请先选择潜次");
    if (isRemoved(dive)) return fail("潜次已移除，不能签核");
    if (isSigned(dive)) return fail("该潜次已签核，之后的更正将作为修订保留");
    dive.signedOffAt = new Date().toISOString();
    dive.reviewer = (reviewer || "").trim() || null;
    return pass();
  }

  function removeDive(state, name, reason) {
    const dive = diveByName(state, name);
    if (!dive) return fail("请先选择潜次");
    if (isRemoved(dive)) return fail("该潜次已移除");
    reason = (reason || "").trim();
    if (hasSignedSpecimens(state, dive) && !reason) {
      return fail("该潜次包含已签核标本，移除必须填写原因，用于历史追溯");
    }
    dive.removed = true;
    dive.removeReason = reason || null;
    dive.removedAt = new Date().toISOString();
    return pass();
  }

  // 保存标本：根据其（编辑后所属）潜次是否已签核，决定覆盖还是新建修订。
  function saveSpecimen(state, input, coords) {
    const data = {};
    for (const key of FIELDS) {
      if (key === "x" || key === "y") continue;
      data[key] = (input[key] ?? "").toString().trim();
    }
    data.x = coords.x;
    data.y = coords.y;
    if (!data.code) return fail("请填写编号");
    if (!data.dive) return fail("请选择所属潜次");
    if (!data.depth) return fail("请填写深度");

    const targetDive = diveByName(state, data.dive);
    if (!targetDive) return fail("所属潜次不存在");
    if (isRemoved(targetDive)) return fail("所属潜次已移除，不能保存标本");

    const reason = (input.revisionReason || "").trim();
    const specimen = input.specimenId
      ? state.specimens.find(s => s.id === input.specimenId)
      : null;
    if (input.specimenId && !specimen) return fail("未找到原标本记录");

    const needsRevision = isSigned(targetDive);
    if (needsRevision && !reason) {
      return fail(specimen
        ? "该潜次已签核，更正会新建修订版本，请填写修订原因"
        : "该潜次已签核，补录标本请填写补录原因");
    }

    const now = new Date().toISOString();
    if (!needsRevision && specimen) {
      // 签核前：照常编辑，直接覆盖当前版本。
      Object.assign(latest(specimen), data);
      return pass();
    }

    if (specimen) {
      // 签核后更正：旧版本冻结并标记已被替代，另起当前修订版本。
      const old = latest(specimen);
      old.status = "superseded";
      old.supersededAt = now;
      specimen.versions.push({
        id: crypto.randomUUID(),
        ...data,
        createdAt: now,
        status: "current",
        revisionReason: reason
      });
    } else {
      // 新标本；若落在已签核潜次则为签核后补录。
      state.specimens.push({
        id: crypto.randomUUID(),
        versions: [{
          id: crypto.randomUUID(),
          ...data,
          createdAt: now,
          status: "current",
          revisionReason: needsRevision ? reason : null
        }]
      });
    }
    return pass();
  }

  // 删除单个标本：仅允许在所属潜次签核前；签核后记录只能修订，不能抹除。
  function deleteSpecimen(state, specimenId) {
    const specimen = state.specimens.find(s => s.id === specimenId);
    if (!specimen) return fail("未找到标本记录");
    const dive = diveByName(state, latest(specimen).dive);
    if (isSigned(dive)) return fail("潜次已签核，标本不能删除；如需更正请保存为修订版本");
    state.specimens = state.specimens.filter(s => s.id !== specimenId);
    return pass();
  }

  // 历史时间线：按潜次分组，保留全部版本、签核与移除记录。
  function historyTimeline(state) {
    const groups = state.dives.map(dive => {
      const events = [];
      for (const s of state.specimens) {
        s.versions.forEach((v, index) => {
          events.push({
            kind: index === 0 ? (v.revisionReason ? "late-add" : "create") : "revise",
            at: v.createdAt,
            specimenId: s.id,
            versionId: v.id,
            superseded: v.status === "superseded",
            code: v.code, type: v.type, dive: v.dive,
            x: v.x, y: v.y, depth: v.depth, orientation: v.orientation,
            condition: v.condition, note: v.note,
            revisionReason: v.revisionReason
          });
        });
      }
      const groupEvents = events.filter(e => e.dive === dive.name);
      if (dive.signedOffAt) {
        groupEvents.push({
          kind: "signoff", at: dive.signedOffAt,
          reviewer: dive.reviewer, code: null
        });
      }
      groupEvents.sort((a, b) => new Date(a.at) - new Date(b.at));
      if (dive.removed) {
        groupEvents.push({
          kind: "remove", at: dive.removedAt || dive.signedOffAt || "",
          reason: dive.removeReason, code: null
        });
      }
      return {
        name: dive.name,
        signed: isSigned(dive),
        reviewer: dive.reviewer,
        removed: dive.removed,
        events: groupEvents
      };
    });
    groups.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    // 已移除潜次沉到时间线末尾，但记录完整保留。
    return groups.sort((a, b) => Number(a.removed) - Number(b.removed));
  }

  // 导出：每个标本仅导出最新版本，附版本追溯信息。
  function exportData(state) {
    return {
      meta: {
        exportedAt: new Date().toISOString(),
        scope: "每个标本的最新版本；历史版本见应用内历史时间线",
        dives: state.dives.map(d => ({
          name: d.name, signedOffAt: d.signedOffAt,
          reviewer: d.reviewer, removed: d.removed, removeReason: d.removeReason
        }))
      },
      specimens: activeSpecimens(state).map(row => ({
        code: row.code,
        type: row.type,
        dive: row.dive,
        x: row.x,
        y: row.y,
        depth: row.depth,
        orientation: row.orientation,
        condition: row.condition,
        note: row.note,
        version: row.versionCount,
        revised: row.revised,
        revisionReason: row.revisionReason,
        specimenId: row.specimenId,
        versionId: row.versionId
      }))
    };
  }

  return {
    diveById, diveByName, latest, isSigned, isRemoved,
    activeSpecimens, addDive, signOffDive, removeDive,
    saveSpecimen, deleteSpecimen, historyTimeline, exportData
  };
})();
