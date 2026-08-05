// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
// tools/patch-shoes.mjs — 手動指定鞋款的推薦屬性。
//
// enrich-metadata 的通用規則對鞋子只有一條「warmth 2 / school+out」,把拖鞋和真皮鞋
// 當成同一件事。鞋子的差異剛好是推薦最需要的:能不能跑步、下雨能不能穿、正不正式。
// 所以這七雙逐一寫死,不走推導。
import { readFile, writeFile } from "node:fs/promises";

// warmth: 1 涼(拖鞋/網布) 2 一般 3 包覆厚實
// rainOk: 麂皮、真皮、米白帆布下雨都不該穿;橡膠拖鞋反而最適合
const SHOES = {
  "黑色真皮厚底休閒鞋(TOD'S)":            { warmth: 2, occasions: ["school", "out"],          rainOk: false },
  "紅色網布輕量慢跑鞋(Nike)":             { warmth: 1, occasions: ["school", "out", "sport"], rainOk: true },
  "米白麂皮拼接復古慢跑鞋(Nike)":         { warmth: 2, occasions: ["school", "out"],          rainOk: false },
  "酒紅麂皮三線休閒鞋(adidas)":           { warmth: 2, occasions: ["school", "out"],          rainOk: false },
  "灰紫機能復古慢跑鞋(New Balance 1000)": { warmth: 2, occasions: ["school", "out", "sport"], rainOk: true },
  "米白帆布側拉鍊高筒鞋":                  { warmth: 2, occasions: ["school", "out"],          rainOk: false },
  "黑色運動拖鞋(UA Project Rock)":        { warmth: 1, occasions: ["out", "sport"],           rainOk: true },
};

const lib = JSON.parse(await readFile("data/library.json", "utf8"));
let patched = 0;
const missing = new Set(Object.keys(SHOES));

for (const item of lib) {
  const spec = SHOES[item.name];
  if (!spec) continue;
  Object.assign(item, spec);
  missing.delete(item.name);
  patched += 1;
  console.log(` w${spec.warmth} ${spec.rainOk ? "  " : "雨x"} [${spec.occasions.map((o) => o[0]).join("")}] ${item.name}`);
}

await writeFile("data/library.json", JSON.stringify(lib, null, 2));
console.log(`\n補齊 ${patched} 雙鞋`);
if (missing.size) console.warn("對不到名字(檢查有沒有改名):", [...missing].join("、"));
