/* ============================================================
 * 数据存取层（data-store.js）
 * 只负责：状态容器的创建、localStorage 读写、id/时间戳生成。
 * 不包含任何业务规则（签核、版本、移除原因等规则见 domain.js）。
 * ============================================================ */
(function (global) {
  "use strict";

  const STORAGE_KEY = "uwaStateV1";

  function uid() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function now() {
    return new Date().toISOString();
  }

  /* ---------- 初始示例数据 ---------- */

  function makeVersion(specimenId, overrides) {
    return Object.assign(
      {
        id: uid(),
        specimenId,
        revision: 1,
        code: "",
        type: "unknown",
        dive: "",
        x: 50,
        y: 50,
        depth: "",
        orientation: "",
        condition: "",
        note: "",
        reason: "",
        supersedes: null,
        createdAt: now(),
      },
      overrides
    );
  }

  function seedState() {
    const dive1 = "DIVE-01";
    const dive2 = "DIVE-02";

    const spA = uid();
    const aV1 = makeVersion(spA, {
      revision: 1,
      code: "A-017",
      type: "ceramic",
      dive: dive1,
      x: 42,
      y: 46,
      depth: "17.8m",
      orientation: "东",
      condition: "边缘残缺",
      note: "靠近船肋",
      createdAt: "2026-09-20T02:10:00.000Z",
    });
    const aV2 = makeVersion(spA, {
      revision: 2,
      code: "A-017",
      type: "ceramic",
      dive: dive1,
      x: 43.5,
      y: 46,
      depth: "17.8m",
      orientation: "东",
      condition: "边缘残缺",
      note: "靠近船肋",
      reason: "坐标复测修正",
      supersedes: aV1.id,
      createdAt: "2026-09-20T06:40:00.000Z",
    });

    const spB = uid();
    const bV1 = makeVersion(spB, {
      revision: 1,
      code: "W-003",
      type: "wood",
      dive: dive1,
      x: 58,
      y: 39,
      depth: "18.2m",
      orientation: "西北",
      condition: "稳定",
      note: "疑似横梁",
      createdAt: "2026-09-21T03:05:00.000Z",
    });

    const spC = uid();
    const cV1 = makeVersion(spC, {
      revision: 1,
      code: "M-011",
      type: "metal",
      dive: dive2,
      x: 66,
      y: 52,
      depth: "19.0m",
      orientation: "南",
      condition: "表面锈蚀",
      note: "船锚残件",
      createdAt: "2026-09-24T07:30:00.000Z",
    });

    return {
      dives: {
        [dive1]: { code: dive1, signedOffAt: "2026-09-22T09:00:00.000Z", signedOffBy: "现场审核员" },
        [dive2]: { code: dive2, signedOffAt: null, signedOffBy: null },
      },
      specimens: {
        [spA]: { id: spA, currentVersionId: aV2.id, removedAt: null, removalReason: "" },
        [spB]: { id: spB, currentVersionId: bV1.id, removedAt: null, removalReason: "" },
        [spC]: { id: spC, currentVersionId: cV1.id, removedAt: null, removalReason: "" },
      },
      versions: {
        [aV1.id]: aV1,
        [aV2.id]: aV2,
        [bV1.id]: bV1,
        [cV1.id]: cV1,
      },
    };
  }

  /* ---------- 读取 / 写入 ---------- */

  function load() {
    try {
      const raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const state = JSON.parse(raw);
        if (state && state.dives && state.specimens && state.versions) return state;
      }
    } catch (err) {
      console.warn("读取本地数据失败，使用初始数据。", err);
    }
    const fresh = seedState();
    save(fresh);
    return fresh;
  }

  function save(state) {
    if (!global.localStorage) return;
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  global.UWA = global.UWA || {};
  global.UWA.store = { STORAGE_KEY, uid, now, load, save };
})(typeof window !== "undefined" ? window : globalThis);
