/* 规则层测试：node test/domain.test.js */
"use strict";

require("../js/data-store.js");
require("../js/domain.js");

const { store, domain } = globalThis.UWA;

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log("ok - " + name);
  } catch (err) {
    console.error("FAIL - " + name + "\n  " + err.message);
    process.exitCode = 1;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}
function freshState() {
  return { dives: {}, specimens: {}, versions: {} };
}
function addSpecimen(state, input) {
  const result = domain.saveSpecimen(state, input);
  assert(result.ok, "saveSpecimen failed: " + result.error);
  return result.version;
}

/* 1. 签核前：照常编辑，直接覆盖原记录，不产生新版本 */
check("签核前编辑直接覆盖，不产生修订", () => {
  const s = freshState();
  const v1 = addSpecimen(s, { code: "A-001", type: "ceramic", dive: "DIVE-01", x: 10, y: 10, condition: "完好" });
  const r = domain.saveSpecimen(s, { specimenId: v1.specimenId, condition: "边缘残缺", x: 12, y: 9 });
  assert(r.ok && r.mode === "updated", "应为 updated 模式");
  const versions = domain.versionHistory(s, v1.specimenId);
  assert(versions.length === 1, "不应产生新版本，实际 " + versions.length);
  assert(versions[0].version.condition === "边缘残缺", "应覆盖保存状态");
  assert(versions[0].version.x === 12, "应覆盖坐标");
});

/* 2. 签核后：更正必须填修订原因，生成新修订，旧版本标记已被替代 */
check("签核后更正生成修订，旧版本保留并标记已被替代", () => {
  const s = freshState();
  const v1 = addSpecimen(s, { code: "A-002", type: "wood", dive: "DIVE-01", x: 20, y: 20, condition: "稳定" });
  assert(domain.signOffDive(s, "DIVE-01", "审核员").ok, "签核应成功");

  const noReason = domain.saveSpecimen(s, { specimenId: v1.specimenId, condition: "部分腐烂" });
  assert(!noReason.ok, "未填修订原因应被拒绝");

  const r = domain.saveSpecimen(s, { specimenId: v1.specimenId, condition: "部分腐烂", x: 21.5, revisionReason: "保存状态复测更正" });
  assert(r.ok && r.mode === "revision", "应为 revision 模式");
  assert(r.version.revision === 2, "应为第 2 版");
  assert(r.version.code === "A-002" && r.version.dive === "DIVE-01", "编号与潜次保持定稿值");

  const history = domain.versionHistory(s, v1.specimenId);
  assert(history.length === 2, "应保留两个版本");
  const [latest, old] = history;
  assert(latest.isCurrent && latest.version.reason === "保存状态复测更正", "最新版应带修订原因");
  assert(old.superseded && old.version.condition === "稳定", "旧版本应标记已被替代且内容不变");
});

/* 3. 已签核潜次：不能新增标本，也不能把标本移入 */
check("已签核潜次拒绝新增与移入", () => {
  const s = freshState();
  addSpecimen(s, { code: "A-003", type: "metal", dive: "DIVE-01", x: 1, y: 1 });
  domain.signOffDive(s, "DIVE-01", "审核员");
  assert(!domain.saveSpecimen(s, { code: "A-004", type: "metal", dive: "DIVE-01", x: 2, y: 2 }).ok, "签核后新增应被拒绝");
  const other = addSpecimen(s, { code: "B-001", type: "wood", dive: "DIVE-02", x: 3, y: 3 });
  assert(!domain.saveSpecimen(s, { specimenId: other.specimenId, dive: "DIVE-01" }).ok, "移入已签核潜次应被拒绝");
});

/* 4. 空潜次不能签核；重复签核被拒绝 */
check("空潜次不能签核，重复签核被拒绝", () => {
  const s = freshState();
  domain.ensureDive(s, "DIVE-09");
  assert(!domain.signOffDive(s, "DIVE-09", "审核员").ok, "空潜次签核应被拒绝");
  addSpecimen(s, { code: "A-005", type: "unknown", dive: "DIVE-09", x: 5, y: 5 });
  assert(domain.signOffDive(s, "DIVE-09", "审核员").ok, "有标本后应可签核");
  assert(!domain.signOffDive(s, "DIVE-09", "审核员").ok, "重复签核应被拒绝");
});

/* 5. 已签核潜次的标本：移除必须说明原因；未签核的可直接移除 */
check("已签核标本移除必须填原因", () => {
  const s = freshState();
  const locked = addSpecimen(s, { code: "A-006", type: "ceramic", dive: "DIVE-01", x: 6, y: 6 });
  const open = addSpecimen(s, { code: "B-002", type: "wood", dive: "DIVE-02", x: 7, y: 7 });
  domain.signOffDive(s, "DIVE-01", "审核员");

  assert(!domain.removeSpecimen(s, locked.specimenId, "").ok, "已签核标本无原因移除应被拒绝");
  assert(!domain.removeSpecimen(s, locked.specimenId, "   ").ok, "空白原因应被拒绝");
  const r = domain.removeSpecimen(s, locked.specimenId, "现场复核为扰动堆积");
  assert(r.ok && r.specimen.removalReason === "现场复核为扰动堆积", "应记录移除原因");
  assert(domain.removeSpecimen(s, open.specimenId, "").ok, "未签核标本可直接移除");
});

/* 6. 地图/导出只取最新版本；已移除标本不出现；历史仍可查 */
check("导出只含最新版本，已移除标本不出现", () => {
  const s = freshState();
  const v1 = addSpecimen(s, { code: "A-007", type: "ceramic", dive: "DIVE-01", x: 10, y: 10, condition: "完好" });
  domain.signOffDive(s, "DIVE-01", "审核员");
  domain.saveSpecimen(s, { specimenId: v1.specimenId, condition: "边缘残缺", revisionReason: "状态更正" });
  const gone = addSpecimen(s, { code: "B-003", type: "wood", dive: "DIVE-02", x: 30, y: 30 });
  domain.removeSpecimen(s, gone.specimenId, "");

  const current = domain.listCurrentVersions(s);
  assert(current.length === 1, "现存标本应只有 1 件，实际 " + current.length);
  assert(current[0].condition === "边缘残缺" && current[0].revision === 2, "地图数据应取最新版本");

  const exported = domain.buildExport(s);
  assert(exported.specimens.length === 1, "导出应只含 1 件");
  assert(exported.specimens[0].revisionReason === "状态更正", "导出应带修订原因");
  assert(!exported.specimens.some((sp) => sp.code === "B-003"), "已移除标本不应导出");

  const history = domain.versionHistory(s, v1.specimenId);
  assert(history.length === 2 && history[1].superseded, "历史时间线应仍能查到旧版本");
});

console.log("\n" + passed + " 项规则测试通过。");
