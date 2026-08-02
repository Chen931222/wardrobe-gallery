// tools/test-outers.mjs — 驗證「薄外套(棒球球衣)」的分層規則。
//
// 背景:needOuter() 只在 24° 以下或下雨時才把外套放進候選池,台中夏天永遠碰不到。
// 但球衣是敞開穿的造型層,熱天照樣成立。改動後要同時守住三件事:
//   1. 熱天球衣挑得到,但**不是每次都挑**(不能天天被硬塞一件)
//   2. 熱天絕不挑厚外套(大衣、皮衣)
//   3. 冷天照樣一定有外套,而且不會拿薄球衣充數
import { readFile } from "node:fs/promises";
import { recommendOutfit } from "../src/recommend.js";

const items = JSON.parse(await readFile("data/library.json", "utf8"));
const RUNS = 60;
const CASES = [
  { label: "盛夏晴天 34°", feelsLike: 34, temp: 32, rainProb: 10, hot: true },
  { label: "夏末    28°", feelsLike: 28, temp: 27, rainProb: 10, hot: true },
  { label: "春秋    22°", feelsLike: 22, temp: 22, rainProb: 20, hot: false },
  { label: "入冬    16°", feelsLike: 16, temp: 16, rainProb: 20, hot: false },
  { label: "寒流    10°", feelsLike: 10, temp: 10, rainProb: 20, hot: false },
];

// warmth 2 的風衣/薄夾克是合理的過渡季外套,不歸在「薄球衣」也不歸在「厚外套」
const thin = new Set(items.filter((i) => i.part === "wholebody_up" && i.warmth <= 1).map((i) => i.name));
const warm = new Set(items.filter((i) => i.part === "wholebody_up" && i.warmth >= 2).map((i) => i.name));
console.log(`薄外套(敞開穿)${thin.size} 件、有保暖力的外套 ${warm.size} 件\n`);

let hotWarmCount = 0, hotAlwaysOuter = 0, hotNeverOuter = 0, coldNoOuter = 0, coldThinPicks = 0;

for (const weather of CASES) {
  const tally = new Map();
  let withOuter = 0, thinPicks = 0, warmPicks = 0;
  for (let n = 0; n < RUNS; n++) {
    const outer = recommendOutfit(items, weather, {}).outfit.wholebody_up;
    if (!outer) continue;
    withOuter++;
    if (thin.has(outer.name)) thinPicks++;
    if (warm.has(outer.name)) warmPicks++;
    tally.set(outer.name, (tally.get(outer.name) || 0) + 1);
  }
  const top = [...tally].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => `${n}×${c}`).join("、");
  console.log(`【${weather.label}】穿外套 ${withOuter}/${RUNS}(薄 ${thinPicks}、有保暖力 ${warmPicks})`);
  console.log(`   ${top || "(都沒穿外套)"}`);

  if (weather.hot) {
    hotWarmCount += warmPicks;                      // 熱天不該出現有保暖力的外套
    if (withOuter === RUNS) hotAlwaysOuter++;       // 也不該每次都硬塞
    if (withOuter === 0) hotNeverOuter++;           // 但總得挑得到
  } else {
    if (withOuter < RUNS) coldNoOuter++;            // 冷天一定要有外套
    coldThinPicks += thinPicks;                     // 且不能拿薄球衣充數
  }
}

const checks = [
  ["熱天挑到有保暖力的外套", hotWarmCount, 0],
  ["熱天每次都被塞外套", hotAlwaysOuter, 0],
  ["熱天完全挑不到薄外套", hotNeverOuter, 0],
  ["冷天漏穿外套", coldNoOuter, 0],
  ["冷天拿薄球衣充數", coldThinPicks, 0],
];
console.log("");
let failed = 0;
for (const [label, got, want] of checks) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${label}:${got}(應為 ${want})`);
}
process.exit(failed ? 1 : 0);
