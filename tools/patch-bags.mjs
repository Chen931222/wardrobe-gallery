// tools/patch-bags.mjs — 手動指定包款的推薦屬性(同 patch-shoes 的理由)。
//
// warmth 對包沒有意義,但推薦引擎的 byPart 會濾掉 warmth === undefined 的單品,
// 所以統一給 1(不增加保暖)。真正有用的是 rainOk 和 occasions。
import { readFile, writeFile } from "node:fs/promises";

const BAGS = {
  "黑灰水洗丹寧半月單肩包":            { warmth: 1, occasions: ["school", "out"],          rainOk: false },  // 棉丹寧會吸水
  "黑色尼龍皮革拼接單肩腰包":          { warmth: 1, occasions: ["school", "out", "sport"], rainOk: true },
  "黑色尼龍電腦後背包(Samsonite)":    { warmth: 1, occasions: ["school", "out"],          rainOk: true },
  "黑色皮革拼接經典印花後背包(COACH)": { warmth: 1, occasions: ["school", "out"],          rainOk: false },  // 真皮怕水
  "米白尼龍半月斜背包":                { warmth: 1, occasions: ["school", "out"],          rainOk: true },
};

const lib = JSON.parse(await readFile("data/library.json", "utf8"));
let patched = 0;
const missing = new Set(Object.keys(BAGS));

for (const item of lib) {
  const spec = BAGS[item.name];
  if (!spec) continue;
  Object.assign(item, spec);
  missing.delete(item.name);
  patched += 1;
  console.log(` ${spec.rainOk ? "  " : "雨x"} [${spec.occasions.map((o) => o[0]).join("")}] ${item.name}`);
}

await writeFile("data/library.json", JSON.stringify(lib, null, 2));
console.log(`\n補齊 ${patched} 個包`);
if (missing.size) console.warn("對不到名字:", [...missing].join("、"));
