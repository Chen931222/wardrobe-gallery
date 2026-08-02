// tools/test-shoes.mjs — 驗證推薦引擎會挑鞋,而且下雨天不挑麂皮/帆布。
import { readFile } from "node:fs/promises";
import { recommendOutfit } from "../src/recommend.js";

const items = JSON.parse(await readFile("data/library.json", "utf8"));
const CASES = [
  { label: "盛夏晴天  34°/降雨 10%", feelsLike: 34, temp: 32, rainProb: 10 },
  { label: "夏天午後雷陣雨 33°/90%", feelsLike: 33, temp: 31, rainProb: 90 },
  { label: "春秋舒適  24°/降雨 20%", feelsLike: 24, temp: 24, rainProb: 20 },
  { label: "入冬微涼  16°/降雨 60%", feelsLike: 16, temp: 16, rainProb: 60 },
  { label: "寒流      10°/降雨 30%", feelsLike: 10, temp: 10, rainProb: 30 },
];

const WET = new Set(items.filter((i) => i.part === "shoes" && i.rainOk === false).map((i) => i.name));
const WETBAG = new Set(items.filter((i) => i.part === "bag" && i.rainOk === false).map((i) => i.name));
const isSlide = (shoe) => (shoe.tags || []).includes("slides");
let noShoes = 0, wetInRain = 0, slidesInCold = 0, socksWithSlides = 0, noBag = 0, wetBagInRain = 0;

for (const weather of CASES) {
  console.log(`\n【${weather.label}】`);
  const seen = new Map();
  // 跑 40 次:引擎有隨機成分,單跑一次看不出它會不會偶爾漏挑鞋
  for (let n = 0; n < 40; n++) {
    const r = recommendOutfit(items, weather, {});
    if (r.error) { console.log("  錯誤:", r.error); break; }
    const shoe = r.outfit.shoes;
    if (!shoe) { noShoes++; continue; }
    if (weather.rainProb >= 50 && WET.has(shoe.name)) wetInRain++;
    if (weather.feelsLike < 24 && isSlide(shoe)) slidesInCold++;
    if (isSlide(shoe) && r.outfit.socks) socksWithSlides++;
    const bag = r.outfit.bag;
    if (!bag) noBag++;
    else if (weather.rainProb >= 50 && WETBAG.has(bag.name)) wetBagInRain++;
    seen.set(shoe.name, (seen.get(shoe.name) || 0) + 1);
    if (n === 0) {
      const parts = ["wholebody_up", "upperbody", "lowerbody", "shoes", "socks", "bag"]
        .filter((p) => r.outfit[p]).map((p) => `${p}=${r.outfit[p].name}`);
      console.log("  範例:", parts.join("\n        "));
      console.log("  理由:", r.reasons.join(" / "));
    }
  }
  console.log("  40 次挑到的鞋:", [...seen.entries()].map(([k, v]) => `${k}×${v}`).join("、"));
}

const checks = [
  ["漏挑鞋", noShoes],
  ["下雨天挑到怕水鞋", wetInRain],
  ["24° 以下挑到拖鞋", slidesInCold],
  ["穿拖鞋還配襪子", socksWithSlides],
  ["漏挑包", noBag],
  ["下雨天挑到怕水的包", wetBagInRain],
];
console.log("");
for (const [label, count] of checks) console.log(`${count === 0 ? "✓" : "✗"} ${label}:${count}(應為 0)`);
process.exit(checks.every(([, count]) => count === 0) ? 0 : 1);
