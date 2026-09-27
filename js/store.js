// 数据存取层：只负责读写本地持久化、种子数据与旧版数据迁移。
// 数据结构：
//   dives     潜次记录（签核信息、移除原因）
//   specimens 标本，每个标本按 versions 保留全部版本；地图/导出只取最新版本
//   版本状态：current=当前有效，superseded=已被后续修订替代
const Store = (() => {
  const STORAGE_KEY = "zfl30State.v2";
  const LEGACY_KEY = "zfl30Marks";

  function seed() {
    const now = Date.now();
    const iso = t => new Date(t).toISOString();
    const dive1 = "DIVE-01";
    const dive2 = "DIVE-02";
    return {
      dives: [
        { id: crypto.randomUUID(), name: dive1, signedOffAt: null, reviewer: null, removed: false, removeReason: null },
        { id: crypto.randomUUID(), name: dive2, signedOffAt: null, reviewer: null, removed: false, removeReason: null }
      ],
      specimens: [
        {
          id: crypto.randomUUID(),
          versions: [{
            id: crypto.randomUUID(),
            code: "A-017", type: "ceramic", dive: dive1,
            x: 42, y: 46, depth: "17.8m", orientation: "东",
            condition: "边缘残缺", note: "靠近船肋",
            createdAt: iso(now - 3600_000),
            status: "current", revisionReason: null
          }]
        },
        {
          id: crypto.randomUUID(),
          versions: [{
            id: crypto.randomUUID(),
            code: "W-003", type: "wood", dive: dive2,
            x: 58, y: 39, depth: "18.2m", orientation: "西北",
            condition: "稳定", note: "疑似横梁",
            createdAt: iso(now - 1800_000),
            status: "current", revisionReason: null
          }]
        }
      ]
    };
  }

  // 将旧版扁平 marks 数组迁移为版本树：每个旧记录成为首个（当前）版本。
  function migrateLegacy(legacy) {
    const state = { dives: [], specimens: [] };
    const diveByName = new Map();
    for (const mark of legacy) {
      if (!diveByName.has(mark.dive)) {
        const dive = {
          id: crypto.randomUUID(), name: mark.dive,
          signedOffAt: null, reviewer: null,
          removed: false, removeReason: null
        };
        diveByName.set(mark.dive, dive);
        state.dives.push(dive);
      }
      state.specimens.push({
        id: mark.id || crypto.randomUUID(),
        versions: [{
          id: crypto.randomUUID(),
          code: mark.code, type: mark.type, dive: mark.dive,
          x: mark.x, y: mark.y, depth: mark.depth,
          orientation: mark.orientation ?? "", condition: mark.condition ?? "",
          note: mark.note ?? "",
          createdAt: new Date().toISOString(),
          status: "current", revisionReason: null
        }]
      });
    }
    return state;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
      if (Array.isArray(legacy) && legacy.length) {
        const migrated = migrateLegacy(legacy);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    } catch (err) {
      console.warn("读取本地数据失败，使用初始数据", err);
    }
    const initial = seed();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }

  function save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  return { load, save };
})();
