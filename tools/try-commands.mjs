// [本 fork 新增] 文字指令的回歸檢查(2026-10-18):用真衣櫃跑一批句子,看解析結果(kind、採用的條件、不要的、沒用上的字),
// 再讓引擎挑一套看有沒有照做。改 recommend.js 的解析之後跑一次:node tools/try-commands.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = { dispatchEvent: () => {}, addEventListener: () => {} };

const root = process.argv[2] || fileURLToPath(new URL("..", import.meta.url));
const { parseRequest, recommendOutfit, adjustIntent } = await import(pathToFileURL(`${root}/src/recommend.js`).href);
const library = JSON.parse(readFileSync(`${root}/data/library.json`, "utf8"));
const items = library.map((item) => ({ ...item, warmth: item.warmth ?? 1 }));

const sentences = [
  "上課,舒服一點",
  "再正式一點",
  "今天去上課,不要外套",
  "今天去上課，不要外套",
  "不要外套去上課",
  "上課不要外套跟短褲",
  "約會穿白襯衫,不要球衣",
  "面試,不要上衣",
  "下雨天上課,不用帶包",
  "去KTV唱歌",
  "上完課去約會",
  "看棒球",
  "上課",
  "不要外套",
  "脫掉外套",
  "不要這件上衣",
  "不要換上衣",
  "全黑,不要短褲",
  "今天去上課，不要外套，想要舒服一點",
  "明天去學校考試穿帥一點不要拖鞋",
  "上課，那個超級無敵的",
  // 2026-10-18 驗收抓到的:沒講場合只脫那件、逗號後面的不是不要、只排同一格、顏色款式、品類在前、天氣不算場合
  "不要外套看看",
  "上課不要外套,包包要能裝電腦",
  "上課不要牛仔褲",
  "上課不要黑色外套",
  "上課,外套就不用了",
  "不帶包包也不要外套",
  "約會,不要黑色",
  "上班後去健身",
  "面試完去吃飯",
  "上課,再正式一點",
  "顏色隨便",
];

const cool = { temp: 17, feelsLike: 16, desc: "多雲", rainProb: 10, tMax: 20, tMin: 15 };
for (const text of sentences) {
  const req = parseRequest(text);
  const adj = req.kind === "adjust" ? adjustIntent(req.base || null, req) : null;
  const intent = adj ? adj.intent : req.intent;
  if (adj) req.notes = [...(req.notes || []), ...adj.notes];
  let picked = "";
  if (req.kind === "outfit" || req.kind === "adjust") {
    const result = recommendOutfit(items, cool, {}, intent, {}, null, null);
    const o = result.outfit || {};
    const has = (slot) => (o[slot] ? o[slot].name : "—");
    picked = `\n    外套:${has("wholebody_up")}|上衣:${has("upperbody")}|下身:${has("lowerbody")}|鞋:${has("shoes")}|包:${has("bag")}`
      + `\n    理由:${[...(req.notes || []), ...(result.reasons || [])].join(" / ")}`;
  }
  const ex = (intent?.exclude || []).map((e) => `${e.word}${e.whole ? "(整格)" : "(避開)"}`).join("、");
  console.log(`「${text}」→ ${req.kind}${req.slot ? `:${req.slot}` : ""}｜聽懂:${intent?.understood ?? "—"}｜不要:${ex || "—"}${picked}`);
}

// 接著說「再正式一點」:排除條件要留著
const first = parseRequest("今天去上課,不要外套");
const next = parseRequest("再正式一點");
const { intent: adjusted } = adjustIntent(first.intent, next);
console.log(`\n接著「再正式一點」→ 聽懂:${adjusted.understood}`);
// 外套一件都不能出現:跑 200 次
let outerCount = 0, shortsWhenNoShorts = 0;
const noShorts = parseRequest("上課不要外套跟短褲").intent;
for (let i = 0; i < 200; i++) {
  if (recommendOutfit(items, cool, {}, first.intent, {}, null, null).outfit.wholebody_up) outerCount++;
  const bottom = recommendOutfit(items, cool, {}, noShorts, {}, null, null).outfit.lowerbody;
  if (/短褲|shorts/i.test(`${bottom?.name} ${(bottom?.tags || []).join(" ")}`)) shortsWhenNoShorts++;
}
console.log(`200 次「上課,不要外套」出現外套:${outerCount} 次;「不要外套跟短褲」出現短褲:${shortsWhenNoShorts} 次`);
