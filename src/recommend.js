// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
/* recommend.js — 每日穿搭推薦引擎(純函式,不碰 DOM)。
 *
 * 規則移植自 outfit-today 專案的 engine.js,改吃 wardrobe-ai 的資料格式:
 * 每件衣物需有 warmth(1~5)、rainOk、color(hex);由 tools/enrich-metadata.mjs 補齊。
 *
 * 評分 = 保暖貼合 + 配色和諧 + 最近穿過降權 + 一點隨機(讓「再推薦一次」有變化)。
 * 穿著紀錄存 localStorage,和微調紀錄一樣跟著瀏覽器走。 */

import { readCity } from "./city.js";
import { pairScore } from "./taste.js";

const WEARLOG_KEY = "open-wardrobe-wearlog-v1";

const WMO_DESC = {
  0: "晴朗", 1: "大致晴朗", 2: "多雲", 3: "陰天", 45: "起霧", 48: "起霧",
  51: "毛毛雨", 53: "毛毛雨", 55: "毛毛雨", 61: "小雨", 63: "中雨", 65: "大雨",
  80: "陣雨", 81: "陣雨", 82: "強陣雨", 95: "雷雨", 96: "雷雨", 99: "雷雨",
};

// 同一個城市半小時內只抓一次:入口、搭配頁、歡迎畫面各自要天氣,不用各打一次
const weatherCache = new Map();
const WEATHER_TTL = 30 * 60 * 1000;

/** 抓今天的天氣(預設是使用者選的城市)。回傳物件帶 city(城市名),畫面上直接拿來顯示。 */
export function fetchWeather(city = readCity()) {
  const hit = weatherCache.get(city.key);
  if (hit && Date.now() - hit.at < WEATHER_TTL) return hit.promise;
  const promise = loadWeather(city);
  weatherCache.set(city.key, { at: Date.now(), promise });
  promise.catch(() => weatherCache.delete(city.key));   // 失敗的不留,下次再試
  return promise;
}

async function loadWeather(city) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}`
    + `&current=temperature_2m,apparent_temperature,weather_code`
    + `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max`
    + `&timezone=Asia%2FTaipei&forecast_days=1`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`weather http ${response.status}`);
  const data = await response.json();
  return {
    city: city.label,
    temp: Math.round(data.current.temperature_2m),
    feelsLike: Math.round(data.current.apparent_temperature),
    desc: WMO_DESC[data.current.weather_code] || "",
    rainProb: data.daily.precipitation_probability_max[0] ?? 0,
    tMax: Math.round(data.daily.temperature_2m_max[0]),
    tMin: Math.round(data.daily.temperature_2m_min[0]),
  };
}

/* ---------- 穿著紀錄(洗衣籃) ---------- */

export function readWearLog() {
  try {
    const value = JSON.parse(localStorage.getItem(WEARLOG_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/** 記下今天穿了這幾件。回傳新的紀錄,和記之前每件的日期(取消用,沒記過的是 null)。 */
export function recordWear(items) {
  const log = readWearLog();
  const today = new Date().toLocaleDateString("sv");
  const before = {};
  for (const item of items) { before[item.id] = log[item.id] ?? null; log[item.id] = today; }
  localStorage.setItem(WEARLOG_KEY, JSON.stringify(log));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("wardrobe-local-change"));   // 開了同步的話,5 秒後推上去
  return { log, before };
}

/** 取消剛剛那一下「今天穿這套」:每件換回記之前的日期。不能直接刪掉,不然會連更早的紀錄一起清掉(審查 F29)。
 *  只動今天記的那幾件;中間別台改過的日期不碰。 */
export function unrecordWear(before) {
  const log = readWearLog();
  const today = new Date().toLocaleDateString("sv");
  for (const [id, date] of Object.entries(before || {})) {
    if (log[id] !== today) continue;
    if (date) log[id] = date; else delete log[id];
  }
  localStorage.setItem(WEARLOG_KEY, JSON.stringify(log));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("wardrobe-local-change"));
  return log;
}

function recencyPenalty(item, wearLog) {
  const last = wearLog[item.id];
  if (!last) return 0;
  const days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
  let penalty = 0;
  if (days <= 1) penalty = -6;
  else if (days <= 3) penalty = -3;
  else if (days <= 6) penalty = -1;
  // 鞋子連穿幾天很正常,而且只有幾雙,懲罰打三折免得每天被迫換鞋
  if (item.part === "shoes") penalty *= 0.3;
  return penalty;
}

/** 這條下身繫得了皮帶嗎:鬆緊帶、抽繩、運動褲、棉褲沒有褲頭,不配皮帶。 */
const takesBelt = (bottom) => Boolean(bottom) && !/抽繩|鬆緊|drawstring|elastic|sweat|運動|棉褲|jogger|束口|legging/.test(itemText(bottom));

/** 太陽眼鏡:只在不太會下雨的日子配;一般眼鏡照戴。 */
const isSunglasses = (item) => /太陽|墨鏡|sunglass|sun-glass/i.test(`${item?.name || ""} ${(item?.tags || []).join(" ")}`);
const SUNNY_RAIN_MAX = 40;

/* ---------- 溫度規則(台灣常見穿法) ---------- */

function targetWarmth(feelsLike) {
  if (feelsLike >= 30) return 1;
  if (feelsLike >= 26) return 1.5;
  if (feelsLike >= 22) return 2.5;
  if (feelsLike >= 18) return 3.5;
  if (feelsLike >= 14) return 5;
  return 6.5;
}

function needOuter(feelsLike, rainProb) {
  return feelsLike < 24 || (rainProb >= 60 && feelsLike < 28);
}

/** 使用者說的冷熱(warmthDelta)→ 標籤與理由共用的一句話,兩邊不再一個寫冷、一個寫涼。 */
function warmthPhrase(delta) {
  if (delta <= -9) return "當寒流來穿";
  if (delta <= -6) return "當冷天穿";
  if (delta < 0) return "當涼天穿";
  if (delta >= 6) return "當大熱天穿";
  if (delta > 0) return "當熱天穿";
  return null;
}

/* 說了冷熱之後照幾度挑。只做「體感 ± delta」的話,36° 說「冷」還是 30°,照樣短褲拖鞋(2026-10-02 審查 F28);
   所以再給一個上限/下限:說冷就不會高過 25+delta(冷 → 19°,短褲和拖鞋自然被扣掉),說熱就不會低過 21+delta。 */
function adjustedFeelsLike(feelsLike, delta) {
  if (delta < 0) return Math.min(feelsLike + delta, 25 + delta);
  if (delta > 0) return Math.max(feelsLike + delta, 21 + delta);
  return feelsLike;
}

/* ---------- 配色:從 hex 判中性色 / 色相家族 ---------- */

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return { h: 0, s: 0, l: 0.5 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

export function isNeutral(hex) {
  const { s, l } = hexToHsl(hex);
  return s < 0.22 || l < 0.18 || l > 0.9;
}

/* 配色時當「底色」的:黑白灰之外,很深的(深藍、深咖、墨綠)、很淺的(米白、奶油)、牛仔丹寧、低彩度的大地色
   (卡其、駝、偏灰的橄欖)也算。這些跟什麼都搭。舊版只認黑白灰:「深藍上衣配米白短褲」「白 T 配牛仔褲」被判成
   顏色打架,米白的鞋也因此幾乎配不上有顏色的衣服(2026-10-05 體檢:23° 時 7 雙鞋只輪得到 2 雙)。 */
const baseColorCache = new WeakMap();   // 每件只算一次:主迴圈幾萬種組合都會問
function isBaseColor(item) {
  if (!item?.color) return true;
  let base = baseColorCache.get(item);
  if (base === undefined) {
    const { h, s, l } = hexToHsl(item.color);
    base = isNeutral(item.color) || l < 0.26 || (l > 0.78 && s < 0.6)
      || /牛仔|丹寧|denim|jeans/.test(`${item.name || ""} ${(item.tags || []).join(" ")}`.toLowerCase())
      || (h >= 20 && h <= 65 && s < 0.42);
    baseColorCache.set(item, base);
  }
  return base;
}

export function colorScore(items) {
  const accents = [];
  for (const item of items) {
    if (!isBaseColor(item)) accents.push(hexToHsl(item.color));
  }
  if (accents.length <= 1) return { score: 2, label: accents.length ? "中性色打底一個主色" : "全中性色" };
  // 兩個以上主色:色相接近(同家族/鄰近 60°)可接受,差太遠扣分;其中一個顏色不飽和(霧霧的)就沒那麼衝
  let worst = 0, vivid = true;
  for (let i = 0; i < accents.length; i++) {
    for (let j = i + 1; j < accents.length; j++) {
      let diff = Math.abs(accents[i].h - accents[j].h) % 360;
      if (diff > 180) diff = 360 - diff;
      if (diff > worst) { worst = diff; vivid = accents[i].s >= 0.4 && accents[j].s >= 0.4; }
    }
  }
  if (worst < 60) return { score: 1, label: "同色系搭配" };
  return vivid ? { score: -3, label: "顏色可能打架" } : { score: -1.5, label: "顏色有點跳" };
}

/* ---------- 風格一致:同一套裡不要一半正式一半運動 ----------
   2026-10-05 體檢(400 次純天氣推薦):34° 有 18% 是拖鞋配襯衫或西裝褲,12° 有 17% 是針織上衣配運動褲。
   分數都是結構性的(≥ 抖動 1.6),不是「偶爾出現」那種偏好。 */
const KIND = {
  dressShirt: (i) => i.part === "upperbody" && (/襯衫/.test(i.name || "") || ["shirt", "button-up", "oxford"].some((tag) => i.tags?.includes(tag))),
  blazer: (i) => /西裝外套|blazer/.test(itemText(i)),
  dressPants: (i) => /西裝褲|西裝長褲|slacks|dress-pants|打褶|pleated/.test(itemText(i)),
  athleticBottom: (i) => i.part === "lowerbody" && /運動|棉褲|sweatpants|sweat-shorts|jogger|束口|球褲/.test(itemText(i)),
  jersey: (i) => /球衣|jersey/.test(itemText(i)),
  hooded: (i) => /帽t|hoodie|連帽/.test(itemText(i)),
  knit: (i) => /針織|毛衣|knit|sweater/.test(itemText(i)),
  shorts: (i) => i.part === "lowerbody" && /短褲|shorts/.test(itemText(i)),
  slides: (i) => i.tags?.includes("slides") || /拖鞋|涼鞋/.test(i.name || ""),
  leatherShoe: (i) => /真皮|皮鞋|leather|loafer|oxford|derby/.test(itemText(i)),
  runner: (i) => /慢跑|running|mesh|網布/.test(itemText(i)),
  patterned: (i) => /條紋|格紋|格子|迷彩|印花|圖案|塗鴉|stripe|pinstripe|plaid|camo|graphic/.test(itemText(i)),
};

/* 每件的種類只算一次:主迴圈是 上衣×下身×外套 幾萬種組合,每組都重跑十幾條正規表示式的話,
   一次推薦要多花幾百毫秒(2026-10-05 實測:4000 次推薦從 20 秒變成跑不完) */
const kindCache = new WeakMap();
function kindsOf(item) {
  let kinds = kindCache.get(item);
  if (!kinds) {
    kinds = {};
    for (const [name, test] of Object.entries(KIND)) kinds[name] = Boolean(test(item));
    kindCache.set(item, kinds);
  }
  return kinds;
}

function styleClash(top, bottom, outer) {
  const t = kindsOf(top), b = kindsOf(bottom), o = outer ? kindsOf(outer) : null;
  let penalty = 0;
  if ((t.dressShirt || o?.blazer) && b.athleticBottom) penalty -= 2.5;
  if (t.knit && b.athleticBottom) penalty -= 1.2;
  if (t.jersey && b.dressPants) penalty -= 2.5;
  if (o) {
    if (o.blazer && b.shorts) penalty -= 3;
    if (o.blazer && t.hooded) penalty -= 2.5;
    if (o.jersey && (t.dressShirt || b.dressPants)) penalty -= 2.5;
    if (o.hooded && t.hooded) penalty -= 2;   // 帽子疊帽子
  }
  if (Number(t.patterned) + Number(b.patterned) + Number(Boolean(o?.patterned)) >= 2) penalty -= 1.8;   // 花的只留一件
  return penalty;
}

function shoeClash(shoe, top, bottom, outer, sportyIntent) {
  const s = kindsOf(shoe), t = kindsOf(top), b = kindsOf(bottom), o = outer ? kindsOf(outer) : null;
  const dressy = t.dressShirt || b.dressPants || o?.blazer;
  let penalty = 0;
  if (s.slides) {
    if (dressy || t.knit) penalty -= 3.5;
    else if (!b.shorts) penalty -= 1.5;   // 拖鞋配長褲
  }
  if (s.leatherShoe && (b.athleticBottom || t.jersey || o?.jersey)) penalty -= 2;
  if (s.runner && !sportyIntent && (b.dressPants || o?.blazer)) penalty -= 1.5;
  return penalty;
}

/* ---------- 色系:「全黑」「黑白」「大地色」「淺色」「藍色系」 ---------- */
const PALETTES = [
  { key: "black", label: "全黑", keys: ["全黑", "一身黑", "全身黑", "all black", "黑到底"], test: (c) => c.l < 0.12 || (c.l < 0.3 && c.s < 0.15) },   // 深藍(亮度低但有彩度)不算黑
  { key: "mono", label: "黑白灰", keys: ["黑白", "無彩色", "極簡", "素一點", "素色", "太花", "太誇張", "太搶眼", "太高調", "太鮮豔"], test: (c) => c.s < 0.16 || c.l < 0.16 || c.l > 0.88 },
  { key: "earth", label: "大地色", keys: ["大地", "奶茶", "卡其色系", "駝色系", "暖色"], test: (c) => (c.h >= 18 && c.h <= 75 && c.s > 0.08 && c.s < 0.62 && c.l > 0.2) || (c.l > 0.78 && c.h >= 25 && c.h <= 70 && c.s > 0.12) },
  { key: "light", label: "淺色系", keys: ["淺色", "亮一點", "明亮", "清爽", "顏色亮", "白色系", "不要那麼黑", "不要全黑"], test: (c) => c.l > 0.62 },
  { key: "dark", label: "深色系", keys: ["深色", "低調", "暗色", "暗一點", "沉穩", "耐髒"], test: (c) => c.l < 0.32 },
  { key: "color", label: "有點顏色", keys: ["有顏色", "繽紛", "鮮豔", "活潑", "跳一點", "不要那麼素", "彩色"], test: (c) => c.s > 0.3 && c.l > 0.25 && c.l < 0.8 },
];
const PALETTE_CLEAR = ["顏色隨便", "顏色都可以", "不限顏色", "顏色不拘", "正常顏色", "不用管顏色"];

function paletteOf(t) {
  if (PALETTE_CLEAR.some((key) => t.includes(key))) return null;
  const fixed = PALETTES.find((palette) => palette.keys.some((key) => t.includes(key)));
  if (fixed) return { key: fixed.key, label: fixed.label };
  // 「藍色系」「一身綠」「整套卡其」:顏色字＋色系
  if (/色系|一身|整套|全身|都穿/.test(t)) {
    const color = detectColor(t);
    if (color) return { key: `color:${color.key}`, label: `${COLOR_NAME[color.key]}色系` };
  }
  return undefined;   // 這句話沒講色系
}

/** 指定的色系 → 判斷「這一件合不合」的函式(看單品,不只看色碼)。 */
function paletteTest(palette) {
  if (!palette) return null;
  const hsl = palette.key.startsWith("color:")
    ? COLOR_WORDS.find((spec) => spec.key === palette.key.slice(6))?.test
    : PALETTES.find((entry) => entry.key === palette.key)?.test;
  if (!hsl) return null;
  const byHex = (item) => Boolean(item?.color) && hsl(hexToHsl(item.color));
  if (palette.key !== "black" && palette.key !== "color:black") return byHex;
  // 品名講明是別的顏色、色碼又暗又灰的(「深藍棉質翻領拉鍊夾克」#292d37、「深橄欖棕西裝外套」),色碼會被當成黑,
  // 「全黑」配出深藍夾克就是這樣來的(2026-10-05)。品名有「黑」、或沒講顏色的,才照色碼
  const otherWords = COLOR_WORDS.filter((spec) => spec.key !== "black").flatMap((spec) => spec.words);
  return (item) => {
    const name = String(item?.name || "");
    if (!/黑|black/i.test(name) && otherWords.some((word) => name.includes(word))) return false;
    return byHex(item);
  };
}

/** 單品合不合指定的色系:合 +1.3、不合 -1.3(蓋得過抖動,整套三四件加起來就很一致);沒指定回 0。
 *  strict(「全黑」「黑白灰」「藍色系」這種講明顏色的)不合扣 3:連按「再推薦」時剛推過的那件最多扣 2.8,
 *  只扣 1.3 擋不住,換一套就跑出深藍、球衣(2026-10-05 體檢:全黑 20° 連按 60 次有 21 次混別色)。 */
function paletteItemScore(item, test, strict = false) {
  if (!test || !item?.color) return 0;
  return test(item) ? 1.3 : strict ? -3 : -1.3;
}
const isStrictPalette = (palette) => Boolean(palette && (palette.key === "black" || palette.key === "mono" || palette.key.startsWith("color:")));

/* ---------- 場合意圖:把一句話(「面試」「下雨天上課」「運動」)轉成挑衣偏好 ----------
 * 純關鍵字規則,零依賴、零成本、決定論 —— 和引擎其他規則同一個世界觀,不呼叫任何 API。
 * occasions 詞彙太薄(只有 school/out/sport),所以正式度靠 name + tags 判。 */

const FORMAL_CUES = ["襯衫", "shirt", "西裝", "suit", "blazer", "西裝褲", "slacks", "chino", "卡其", "皮鞋", "皮革", "leather", "loafer", "oxford", "derby", "大衣", "coat", "羊毛", "wool", "tailored", "條紋襯衫", "polo"];
const SPORTY_CUES = ["運動", "sport", "球衣", "jersey", "sweat", "帽t", "hoodie", "連帽", "track", "jogger", "棉褲", "機能", "mesh", "網布", "running", "慢跑", "排汗", "athletic", "sneaker", "gym", "拖鞋", "slides"];
const CASUAL_CUES = ["denim", "丹寧", "jeans", "牛仔", "distressed", "破損", "baggy", "寬版", "oversize", "tee", "t-shirt", "短褲", "shorts", "canvas", "帆布", "casual", "cotton", "棉"];

// 意圖規則:由「最正式」往「最休閒」排,取第一個命中的當 formality。
// 詞彙表(2026-09-21 補齊:站主打「工作」被回沒聽懂)。長詞先於短詞、正式先於休閒。
const INTENT_FORMALITY = [
  // 最前面:字面上跟後面撞的(「看棒球」不是去運動)。boost = 這個場合特別想看到的單品
  { formality: "casual", label: "看球賽", boost: ["球衣", "jersey"], keys: ["看球", "看棒球", "看籃球", "看比賽", "看職棒", "進場", "球場看", "應援"] },
  { formality: "formal", label: "正式場合", keys: ["面試", "interview", "正式", "正裝", "上台", "報告", "簡報", "發表", "presentation", "婚禮", "wedding", "喜宴", "喜酒", "婚宴", "訂婚", "伴郎", "喪禮", "告別式", "典禮", "畢業", "頒獎", "見家長", "商務", "演講", "開會", "會議", "meeting", "面談", "口試", "答辯", "見客戶", "提案"] },
  { formality: "smart", label: "得體一點", keys: ["約會", "date", "吃飯", "聚餐", "晚餐", "dinner", "餐廳", "下午茶", "咖啡廳", "咖啡店", "見面", "看展", "展覽", "工作", "上班", "打工", "實習", "辦公", "公司", "拜訪", "拍照", "約拍", "證件照", "大頭照", "畢業照", "派對", "party", "演唱會", "音樂會", "酒吧", "夜店", "喝酒", "同學會", "聚會", "聯誼", "相親", "家教", "慶生", "生日", "尾牙", "春酒", "告白", "女朋友", "男朋友", "女友", "男友", "曖昧", "約"] },
  { formality: "sporty", label: "運動", activity: "sport", keys: ["運動", "健身", "gym", "跑步", "慢跑", "run", "打球", "打棒球", "打籃球", "打羽球", "籃球", "羽球", "桌球", "網球", "排球", "足球", "游泳", "瑜珈", "重訓", "爬山", "登山", "hiking", "騎車", "單車", "腳踏車", "健走", "workout", "練球", "棒球"] },
  { formality: "casual", label: "上課", occasionPref: "school", keys: ["上課", "上學", "學校", "class", "school", "考試", "圖書館", "念書", "讀書", "自習", "實驗室", "社團"] },
  { formality: "casual", label: "在家耍廢", keys: ["耍廢", "在家", "宅", "躺", "睡", "休息", "放假", "廢"] },
  { formality: "casual", label: "去海邊", boost: ["短褲", "shorts", "拖鞋", "slides"], keys: ["海邊", "沙灘", "墾丁", "玩水", "泳池"] },
  { formality: "casual", label: "日常出門", keys: ["出門", "日常", "隨便", "逛街", "出去玩", "出遊", "旅行", "旅遊", "野餐", "露營", "看電影", "買菜", "超市", "便利商店", "倒垃圾", "見朋友", "朋友", "拜拜", "散步", "chill", "夜市", "洗車", "醫院", "看醫生", "診所", "回家", "過年", "回老家", "掃墓", "拜年", "買東西", "宵夜", "早餐", "遛狗", "搭車", "坐車", "高鐵", "機場", "銀行", "郵局", "理髮", "剪頭髮", "接人", "載人", "兜風"] },
];

/** 把使用者輸入解析成意圖;沒任何關鍵字命中就回 { understood: null },讓引擎照天氣走。 */
export function parseIntent(text) {
  const raw = (text || "").trim();
  if (!raw) return null;
  // 否定：「不想穿太正式」「不要太正式」「不冷」不該命中正式/冷。把否定詞連同後面 4 個字一起挖掉再比對。
  const NEG = ["不想", "不要", "不用", "不太", "沒有要", "不想要", "別穿", "別太", "不冷", "不熱", "不涼", "不會冷", "不會熱", "不下雨"];
  let t = raw.toLowerCase();
  for (const n of NEG) {
    let i;
    while ((i = t.indexOf(n)) !== -1) t = `${t.slice(0, i)} ${t.slice(i + n.length + 4)}`;
  }
  const has = (list) => list.some((k) => t.includes(k.toLowerCase()));

  let formality = null, label = null, activity = null, occasionPref = null, boost = null;
  for (const rule of INTENT_FORMALITY) {
    if (has(rule.keys)) {
      formality = rule.formality; label = rule.label;
      activity = rule.activity || null; occasionPref = rule.occasionPref || null; boost = rule.boost || null;
      break;
    }
  }
  // 地點列不完(全聯、KTV、補習班、牙醫…):句子長得像「要去哪、要吃什麼」就當成一般出門,不回「沒學過」
  if (!formality && /去|吃|喝|買|逛|看|找|陪|載|接|拿|領|搭|坐/.test(t) && !/換|穿|脫|那件|這件|那雙|這雙/.test(t)) {
    formality = "casual"; label = "日常出門";
  }

  // 天氣覆寫(和場合獨立):使用者可能同時提到冷熱或雨
  let warmthDelta = 0;
  if (has(["寒流"])) warmthDelta = -9;
  else if (has(["冷", "天冷", "變冷"])) warmthDelta = -6;
  else if (has(["涼", "微涼"])) warmthDelta = -3;
  else if (has(["很熱", "超熱", "大熱天", "炎熱"])) warmthDelta = 6;
  else if (has(["熱"])) warmthDelta = 5;
  const forceRainy = has(["下雨", "會下雨", "雨天", "雷雨", "陣雨", "下雨天", "颱風", "大雨", "暴雨", "梅雨", "淋雨", "會濕"]);
  const palette = paletteOf(t) || null;

  const intent = { raw, understood: null, formality, label, activity, occasionPref, boost, warmthDelta, forceRainy, palette };
  intent.understood = describeIntent(intent);
  return intent;
}

/** 「正式場合 · 當冷天穿 · 全黑」:聽懂了什麼,給畫面上那一行用。什麼都沒有回 null。 */
function describeIntent(intent) {
  const bits = [];
  if (intent.label) bits.push(intent.label);
  if (intent.warmthDelta) bits.push(warmthPhrase(intent.warmthDelta));
  if (intent.forceRainy) bits.push("當下雨天");
  if (intent.palette) bits.push(intent.palette.label);
  return bits.length ? bits.join(" · ") : null;
}

const itemText = (item) => `${item.name || ""} ${(item.tags || []).join(" ")}`.toLowerCase();
// 判正式/運動/休閒用的字:品牌名裡的字不算。「白色V領合身短袖(Polo Ralph Lauren)」是 T 恤、
// 「深藍連帽防風外套(Polo Ralph Lauren)」是防風外套,都不是 Polo 衫(審查 F15)。
const styleText = (item) => itemText(item).replace(/polo\s*ralph\s*lauren|polo-rl/g, " ");
const isShorts = (item) => /短褲|shorts/.test(itemText(item));

/** 單品對某 formality 的貼合度。權重刻意 ≥1.2 —— 主迴圈每組帶 ±1.6 抖動,太小的偏好會被抖動吃掉
 *  (見主迴圈註解);但「說了正式就穩定挑正式」是要蓋過抖動的『持續偏好』,不是機率性出場,所以夠大就行。*/
function intentItemScore(item, intent) {
  if (!intent || !intent.formality) return 0;
  const text = styleText(item);
  const hit = (list) => list.some((k) => text.includes(k.toLowerCase()));
  const formal = hit(FORMAL_CUES), sporty = hit(SPORTY_CUES), casual = hit(CASUAL_CUES);
  let s = 0;
  if (intent.formality === "formal") s = (formal ? 2 : 0) + (sporty ? -3 : 0) + (casual ? -1 : 0);
  else if (intent.formality === "smart") s = (formal ? 1.4 : 0) + (sporty ? -2.2 : 0) + (casual ? -0.4 : 0);
  else if (intent.formality === "sporty") s = (sporty ? 2 : 0) + (formal ? -1.6 : 0);
  else if (intent.formality === "casual") s = (casual ? 0.6 : 0) + (formal ? -0.6 : 0);
  // 正式/得體場合:拖鞋、涼鞋再怎麼熱也不該出現,額外重扣蓋過熱天的 +0.8 加分
  if ((intent.formality === "formal" || intent.formality === "smart")
    && (item.tags?.includes("slides") || /拖鞋|涼鞋/.test(item.name || ""))) s -= 2.5;
  // 正式場合不穿短褲,再熱也一樣。卡其、chino 會被當正式線索,不重扣的話熱天面試 5 次有 5 次是短褲(審查 F15)。
  // 只套 formal:約會(smart)熱天穿短褲是合理的
  if (intent.formality === "formal" && isShorts(item)) s -= 4;
  const pref = intent.activity === "sport" ? "sport" : intent.occasionPref;
  if (pref && item.occasions?.includes(pref)) s += 0.6;
  // 這個場合特別想看到的(看球賽 → 球衣、去海邊 → 短褲拖鞋)
  if (intent.boost?.some((word) => text.includes(word))) s += 1.8;
  return s;
}

/** 一件單品最先命中的風格線索(給理由面板用,讓評分不是黑盒)。 */
function cueHit(item) {
  const text = styleText(item);
  const find = (list, kind) => { const w = list.find((k) => text.includes(k.toLowerCase())); return w ? { w, kind } : null; };
  return find(FORMAL_CUES, "正式") || find(SPORTY_CUES, "運動") || find(CASUAL_CUES, "休閒") || null;
}

/* 線索詞的中文說法:給理由面板看,不影響比對 */
const CUE_ZH = {
  shirt: "襯衫", suit: "西裝", blazer: "西裝外套", slacks: "西裝褲", chino: "卡其褲", leather: "皮革", loafer: "樂福鞋",
  oxford: "牛津布", derby: "德比鞋", coat: "大衣", wool: "羊毛", tailored: "剪裁", polo: "Polo 衫",
  sport: "運動", jersey: "球衣", sweat: "棉質運動", "帽t": "帽T", hoodie: "帽T", track: "運動", jogger: "束口褲", mesh: "網布",
  running: "慢跑", athletic: "運動", sneaker: "球鞋", gym: "運動", slides: "拖鞋",
  denim: "丹寧", jeans: "牛仔褲", distressed: "破損", baggy: "寬版", oversize: "寬版", tee: "T 恤", "t-shirt": "T 恤",
  shorts: "短褲", canvas: "帆布", casual: "休閒", cotton: "棉",
};

/* ---------- 單品請求:「換成黑色襯衫」「脫掉外套」 ----------
 * 對應 drape 的 request route(specific item / remove a piece),一樣純關鍵字。 */

// 槽位關鍵字:長詞排前、外套組排在上衣前 —— 免得「帽T」被配件的「帽」搶走、「襯衫外套」被上衣的「襯衫」搶走。
const SLOT_WORDS = [
  { slot: "wholebody_up", words: ["襯衫外套", "棒球外套", "外套", "夾克", "大衣", "風衣", "罩衫", "球衣"] },
  { slot: "upperbody", words: ["帽t", "衛衣", "大學t", "襯衫", "polo", "t恤", "tee", "毛衣", "針織", "背心", "長袖", "短袖", "上衣", "衣服"] },
  { slot: "lowerbody", words: ["牛仔褲", "西裝褲", "短褲", "長褲", "褲子", "褲"] },
  { slot: "shoes", words: ["拖鞋", "涼鞋", "皮鞋", "球鞋", "慢跑鞋", "靴", "鞋"] },
  { slot: "socks", words: ["襪"] },
  { slot: "bag", words: ["後背包", "背包", "側背包", "腰包", "包包", "包"] },
  { slot: "eyewear", words: ["墨鏡", "眼鏡"] },
  { slot: "wrist", words: ["手錶", "手環", "錶"] },
  { slot: "belt", words: ["皮帶", "腰帶"] },
  { slot: "necklace", words: ["項鍊"] },
  { slot: "ring", words: ["戒指"] },
  { slot: "accessories_up", words: ["帽子", "圍巾", "帽"] },
];
// 太泛的品類字(幾乎沒有單品名稱含「上衣」「鞋」),只用來定槽位、不拿去比對名稱
const GENERIC_CATEGORY = new Set(["上衣", "衣服", "褲", "褲子", "鞋", "包", "包包", "襪", "錶", "帽"]);
// 品類同義詞:名稱是中文、tags 常是英文,兩邊都認
const CATEGORY_ALIASES = {
  "球鞋": ["球鞋", "慢跑鞋", "運動鞋", "sneaker", "running"],
  "皮鞋": ["皮鞋", "真皮", "皮革", "leather", "loafer", "oxford", "derby"],
  "t恤": ["t恤", "tee", "t-shirt"],
  "帽t": ["帽t", "hoodie", "連帽"],
  "衛衣": ["衛衣", "sweatshirt", "crewneck"],
  "毛衣": ["毛衣", "針織", "knit", "sweater"],
  "針織": ["針織", "knit", "毛衣"],
  "襯衫": ["襯衫", "button"],
  "牛仔褲": ["牛仔", "丹寧", "denim", "jeans"],
  "西裝褲": ["西裝褲", "slacks", "打褶"],
  "短褲": ["短褲", "shorts"],
  "長褲": ["長褲", "pants", "trousers"],
  "後背包": ["後背包", "backpack"],
  "背包": ["背包", "backpack"],
  "腰包": ["腰包", "waist"],
  "側背包": ["側背", "斜背", "單肩", "crossbody"],
  "外套": ["外套", "jacket", "coat"],
  "夾克": ["夾克", "jacket"],
  "大衣": ["大衣", "coat"],
  "球衣": ["球衣", "jersey"],
  "拖鞋": ["拖鞋", "slides"],
  "涼鞋": ["涼鞋", "sandal"],
  "靴": ["靴", "boot"],
};

// 描述字(款式、材質、圖案):「開襟外套」的「開襟」、「燈芯絨西裝外套」的「燈芯絨」。舊版只認品類和顏色,
// 「換成開襟外套」只看「外套」,給了一件普通外套(2026-10-03 本人回報)。名稱是中文、tags 常是英文,兩邊都認。
const DESCRIPTORS = [
  ["開襟", "cardigan", "開衫"], ["連帽", "hoodie"], ["燈芯絨", "corduroy"], ["丹寧", "denim", "牛仔"],
  ["格紋", "格子", "plaid", "check"], ["條紋", "stripe", "pinstripe"], ["迷彩", "camo"], ["刷破", "破洞", "distressed"],
  ["工裝", "cargo", "chore", "workwear"], ["真皮", "皮革", "皮衣", "leather"], ["羊毛", "wool"], ["針織", "knit"],
  ["拉鍊", "zip"], ["印花", "圖案", "print", "graphic"], ["寬版", "寬鬆", "oversize", "baggy", "wide-leg", "relaxed"],
  ["西裝", "blazer"], ["棒球", "baseball"], ["防風", "windbreaker"], ["翻領"], ["立領", "mockneck"], ["高領"],
  ["圓領", "crewneck"], ["v領", "vneck"], ["燈籠"], ["打褶", "pleated"], ["水洗", "washed"], ["抽繩", "drawstring"],
  ["運動", "sport", "jogger"], ["亨利領", "henley"], ["法蘭絨", "flannel"], ["麂皮", "suede"], ["帆布", "canvas"],
];

function detectDescriptors(t) {
  return DESCRIPTORS.filter((group) => group.some((word) => t.includes(word.toLowerCase())));
}

// 拿來找品名的那一段:把動詞、贅字、顏色拿掉剩下的(「換成開襟外套」→「開襟外套」)。三個字以上才用,太短會亂中。
const FILLER = ["換成", "改成", "換掉", "改用", "給我", "幫我", "我要", "我想", "想要", "來一件", "來件", "一件", "一雙", "一條",
  "一頂", "一個", "穿上", "穿", "換", "改", "試試", "看看", "那件", "這件", "的", "吧", "呢", "嗎", "啊", "一下"];
function phraseOf(t, colorWord) {
  let phrase = t;
  for (const word of [colorWord, ...FILLER].filter(Boolean).sort((a, b) => b.length - a.length)) phrase = phrase.split(word).join("");
  phrase = phrase.replace(/[\s,，。.!！?？、色]/g, "");
  return phrase.length >= 3 ? phrase : null;
}

// 顏色:名稱字＋hex 色域雙路認。長詞先比(「深藍」先於「藍」、「米白」先於「白」)。
// 門檻是拿真衣櫃 101 件「名稱說的顏色 vs 建檔抓的 hex」對過調的(2026-09-21,原本 18 件不一致):
//   米白/奶油偏暖會被當卡其 → 白以亮度為主;軍綠/橄欖其實落在 h40–70 低彩度 → 綠要收橄欖;
//   酒紅去飽和 → 紅門檻降;深X黑/黑灰亮度 0.2–0.28 → 黑放寬;淺灰亮度 0.84 → 灰白重疊(名稱比對 +3 主導,
//   放寬只影響 hex 那 +1.5)。深藍(亮度 0.19 但飽和)仍不算黑,免得騙使用者「有黑襯衫」。
// target 給「最接近」用:沒命中時按距離排序,讓「最接近」真的是最接近。
const COLOR_WORDS = [
  { key: "navy", words: ["深藍", "藏青", "海軍藍"], target: { h: 230, l: 0.25 }, test: (c) => c.h >= 200 && c.h <= 260 && c.s > 0.08 && c.l < 0.4 },
  { key: "white", words: ["米白", "奶油", "象牙", "白"], target: { l: 0.9 }, test: (c) => c.l > 0.75 && c.s < 0.55 },
  { key: "black", words: ["黑"], target: { l: 0.08 }, test: (c) => c.l < 0.16 || (c.l < 0.28 && c.s < 0.12) },
  { key: "grey", words: ["炭灰", "麻灰", "銀", "灰"], target: { l: 0.5 }, test: (c) => c.s < 0.15 && c.l >= 0.18 && c.l <= 0.88 },
  { key: "blue", words: ["水藍", "淺藍", "天藍", "丹寧", "藍"], target: { h: 220, l: 0.5 }, test: (c) => c.h >= 190 && c.h <= 260 && c.s > 0.08 },
  { key: "red", words: ["酒紅", "磚紅", "暗紅", "紅"], target: { h: 0, l: 0.4 }, test: (c) => (c.h <= 15 || c.h >= 340) && c.s > 0.2 },
  { key: "green", words: ["軍綠", "橄欖", "墨綠", "綠"], target: { h: 90, l: 0.35 }, test: (c) => (c.h >= 70 && c.h <= 170 && c.s > 0.08) || (c.h >= 35 && c.h < 70 && c.s >= 0.08 && c.s <= 0.45 && c.l < 0.45) },
  { key: "khaki", words: ["卡其", "駝", "沙色", "杏"], target: { h: 40, l: 0.6 }, test: (c) => c.h >= 25 && c.h <= 55 && c.s > 0.1 && c.l > 0.35 && c.l <= 0.75 },
  { key: "brown", words: ["咖啡", "深咖", "棕", "褐"], target: { h: 30, l: 0.35 }, test: (c) => c.h >= 15 && c.h <= 45 && c.s > 0.1 && c.l <= 0.5 },
  { key: "purple", words: ["梅紫", "紫"], target: { h: 290, l: 0.4 }, test: (c) => c.h >= 260 && c.h <= 345 && c.s >= 0.08 && c.l < 0.7 },
  { key: "pink", words: ["粉紅", "粉色", "桃紅", "粉"], target: { h: 335, l: 0.75 }, test: (c) => c.h >= 320 && c.h <= 350 && c.l > 0.6 },
  { key: "yellow", words: ["黃", "金"], target: { h: 55, l: 0.6 }, test: (c) => c.h >= 45 && c.h <= 70 && c.s > 0.3 },
  { key: "orange", words: ["橘", "橙"], target: { h: 30, l: 0.55 }, test: (c) => c.h >= 15 && c.h <= 45 && c.s > 0.5 && c.l > 0.4 },
];

const COLOR_NAME = { navy: "深藍", white: "白", black: "黑", grey: "灰", blue: "藍", red: "紅", green: "綠", khaki: "卡其", brown: "咖啡", purple: "紫", pink: "粉紅", yellow: "黃", orange: "橘" };

/** 色碼 → 「深藍色」這種說法,給人看的畫面用(審查 F50:舊版直接露出 #4D474B)。認不出來的叫「混色」。 */
export function colorName(hex) {
  if (!/^#?[0-9a-f]{6}$/i.test(hex || "")) return "";
  const hsl = hexToHsl(hex);
  const hit = COLOR_WORDS.find((spec) => spec.test(hsl));
  return hit ? `${COLOR_NAME[hit.key]}色` : "混色";
}

/** 一件單品所有已知的顏色(主色+副色+色盤):條紋衫的白才不會被平均成的那坨灰吞掉。 */
function itemColors(item) {
  return [...new Set([item.color, item.secondaryColor, ...(item.palette || [])].filter(Boolean))];
}

/** 0(很像)~1(很遠):無彩色只比亮度,有彩色比色相環距離＋亮度;幾乎無彩度的東西離任何色相都遠。 */
function colorDistance(spec, c) {
  const t = spec.target;
  const dl = Math.min(1, Math.abs(c.l - (t.l ?? 0.5)) / 0.6);
  if (t.h === undefined) return dl;
  let dh = Math.abs(c.h - t.h) % 360;
  if (dh > 180) dh = 360 - dh;
  return Math.min(1, (dh / 180) * 0.7 + dl * 0.3 + (c.s < 0.1 ? 0.4 : 0));
}
const SWAP_HINTS = ["換", "改", "想要", "來一", "來件", "給我", "穿", "加一", "配一", "一件", "一雙", "一條", "一頂", "一個"];
// 明確的「替換某一格」動詞:只換那一件,不重挑整套(即使句子裡有正式字眼,如「換成紫色西裝外套」)。
const REPLACE_HINTS = ["換成", "改成", "換一", "換件", "換個", "換條", "換雙", "換頂", "換掉", "改用"];
const REMOVE_HINTS = ["脫掉", "脫", "拿掉", "拿走", "不要", "去掉", "移除", "別穿", "不穿", "不用帶", "不用穿", "不帶", "不揹", "不背", "不用"];
// 明講要脫:上衣、褲子、鞋也照脫。只說「不要這件上衣」「褲子不好看」是嫌它、要換一件,不是要光著
const STRIP_HINTS = ["脫掉", "脫", "拿掉", "拿走", "去掉", "移除"];
const DISLIKE_HINTS = ["不好看", "不喜歡", "不適合", "醜", "怪怪的", "很怪", "不搭", "不行"];
const CORE_SLOT = new Set(["upperbody", "lowerbody", "shoes"]);

// 對話式修正(2026-09-21 第一梯隊):這些要排在「換/脫」前面判,因為「不要換上衣」同時含「不要」和「換」。
const KEEP_HINTS = ["留著", "留住", "保留", "不要換", "不換", "不動", "不要動", "別動", "別換", "鎖住", "鎖", "keep", "不錯", "很好", "很可以", "就這件", "就這雙", "就這條", "我喜歡"];
const UNLOCK_HINTS = ["解鎖", "放開", "都可以換", "全部可以換", "不用鎖"];
const UNDO_HINTS = ["上一步", "復原", "回上一步", "退回", "undo", "回到剛剛", "剛剛那套", "上一套", "前一套", "還原"];
const REROLL_HINTS = ["再來一套", "換一套", "重挑", "再挑", "另一套", "不喜歡", "再一套", "其他換", "其他的換", "其他都換", "都換掉", "全部換", "全換", "全部重來", "重來", "重新配", "再配", "下一套", "換別套", "別套"];
const MORE_FORMAL = ["再正式", "正式一點", "正式點", "更正式", "體面一點", "正經一點", "帥一點", "帥氣一點", "好看一點", "有型一點", "成熟一點", "質感一點", "認真一點", "太休閒", "太隨便", "太邋遢", "太居家", "太運動", "太幼稚", "幼稚", "像小孩", "像學生", "太學生"];
const MORE_CASUAL = ["再休閒", "休閒一點", "休閒點", "更休閒", "輕鬆一點", "隨性一點", "隨便一點", "放鬆一點", "舒服一點", "舒適一點", "自在一點", "簡單一點", "太正式", "太拘謹", "太嚴肅", "太刻意", "太老氣"];
const COOLER = ["再涼", "涼一點", "涼快一點", "太熱", "熱死", "薄一點", "少穿一點", "穿少一點", "會熱", "太厚", "太悶", "會流汗"];
const WARMER = ["再暖", "暖一點", "太冷", "冷死", "厚一點", "多穿一點", "穿多一點", "會冷", "保暖一點", "太薄", "太涼", "會著涼"];

const LADDER = ["casual", "smart", "formal"];
const LADDER_LABEL = { casual: "輕鬆一點", smart: "得體一點", formal: "正式場合" };

/** 把「再正式一點／再涼一點」套在上一次的意圖上,回新意圖＋要跟使用者說的話(例如已經最正式了)。 */
export function adjustIntent(prev, adj) {
  const base = prev
    ? { ...prev }
    : { raw: "", understood: null, formality: null, label: null, activity: null, occasionPref: null, boost: null, warmthDelta: 0, forceRainy: false, palette: null };
  const notes = [];
  if (adj.formalityStep) {
    const cur = base.formality === "sporty" ? "casual" : base.formality;      // 運動當作休閒那一階
    const idx = cur ? LADDER.indexOf(cur) : (adj.formalityStep > 0 ? 0 : 1);   // 沒場合:往上從休閒起跳→得體,往下→輕鬆
    const next = LADDER[Math.max(0, Math.min(LADDER.length - 1, idx + adj.formalityStep))];
    if (cur && next === cur) notes.push(adj.formalityStep > 0 ? "已經是最正式的了" : "已經是最輕鬆的了");
    base.formality = next; base.label = LADDER_LABEL[next]; base.activity = null; base.occasionPref = null; base.boost = null;
  }
  if (adj.warmthDelta) base.warmthDelta = Math.max(-12, Math.min(12, (base.warmthDelta || 0) + adj.warmthDelta));
  if (adj.palette !== undefined) base.palette = adj.palette;   // 色系接在原本的場合上;null = 不限顏色了
  base.understood = describeIntent(base);
  base.raw = adj.raw;
  return { intent: base, notes };
}

function detectSlot(t) {
  for (const group of SLOT_WORDS) {
    const word = group.words.find((w) => t.includes(w));
    if (word) return { slot: group.slot, category: GENERIC_CATEGORY.has(word) ? null : word };
  }
  return null;
}

function detectColor(t) {
  const flat = COLOR_WORDS.flatMap((c) => c.words.map((w) => ({ w, c }))).sort((a, b) => b.w.length - a.w.length);
  const hit = flat.find(({ w }) => t.includes(w));
  return hit ? { ...hit.c, word: hit.w } : null;
}

/* 「白T」「黑T」「素T」「短T」:T 前面是顏色或長短,後面不是英文字(免得 date、party 裡的 t 被當成 T 恤) */
const TEE_SHORT = /(白|黑|灰|藍|綠|紅|素|短|長|米|厚|薄)\s?t(?![a-z恤])/;

/* 「再給我一套」「換別的」「不要這套」「還有別的嗎」:要重挑的各種講法 */
const REROLL_RE = /(再|另|換|下).{0,3}套|不要這套|這套不|換別的|別的|還有嗎/;

/** 把一句話分成幾種請求:換單品 / 脫一件 / 整套(場合) / 微調 / 留著 / 復原 / 聽不懂。 */
export function parseRequest(text) {
  const raw = (text || "").trim();
  if (!raw) return null;
  const t = raw.toLowerCase();
  const slotHit = detectSlot(t) || (TEE_SHORT.test(t) ? { slot: "upperbody", category: "t恤" } : null);
  const color = detectColor(t);
  const intent = parseIntent(raw);
  const has = (list) => list.some((h) => t.includes(h));
  const dislikes = has(DISLIKE_HINTS);
  // 「不穿襪子」裡的「穿」不是要換、「不好看」也不是「好看」:先把否定的說法挖掉,再看有沒有要換、要留的意思
  let positive = t;
  for (const word of [...REMOVE_HINTS, ...DISLIKE_HINTS].sort((a, b) => b.length - a.length)) positive = positive.split(word).join(" ");
  const wantsSwap = SWAP_HINTS.some((h) => positive.includes(h));
  const wantsRemove = has(REMOVE_HINTS);
  const wantsKeep = KEEP_HINTS.some((h) => (/^[不別]/.test(h) ? t : positive).includes(h));

  // 對話式修正先判(見 KEEP_HINTS 註解)
  if (has(UNDO_HINTS)) return { kind: "undo", raw };
  if (has(UNLOCK_HINTS)) return { kind: "unlock", raw, slot: slotHit?.slot || null };
  if (slotHit && wantsKeep && !dislikes) return { kind: "keep", raw, slot: slotHit.slot, reroll: has(REROLL_HINTS) || REROLL_RE.test(t) };
  const step = has(MORE_FORMAL) ? 1 : has(MORE_CASUAL) ? -1 : 0;
  const warm = has(COOLER) ? 4 : has(WARMER) ? -4 : 0;
  // 只講色系(「全黑」「大地色」「顏色隨便」):接在原本的場合上,不是重來
  const palette = paletteOf(t);
  // 「顏色隨便」(palette === null)一律算只講色系:「隨便」剛好也是「日常出門」的詞
  const paletteOnly = palette !== undefined && (palette === null || (!intent?.formality && !intent?.warmthDelta && !intent?.forceRainy));
  const reroll = has(REROLL_HINTS) || REROLL_RE.test(t);
  if (!slotHit && (step || warm || reroll || paletteOnly)) {
    return { kind: "adjust", raw, formalityStep: step, warmthDelta: warm, ...(palette !== undefined ? { palette } : {}) };
  }

  const descriptors = detectDescriptors(t);
  const phrase = phraseOf(t, color?.word);
  const spec = { slot: slotHit?.slot || null, category: slotHit?.category || null, color, descriptors, phrase };
  // 嫌身上這件(「不要這件上衣」「褲子不好看」):換一件別的。上衣、褲子、鞋沒明講「脫」就不脫(不要這件上衣 ≠ 打赤膊)
  const another = { kind: "swap", raw, slot: slotHit?.slot, category: null, color: null, descriptors: [], phrase: null, another: true, disliked: dislikes };
  if (slotHit && wantsRemove && !wantsSwap) {
    if (CORE_SLOT.has(slotHit.slot) && !has(STRIP_HINTS)) return another;
    return { kind: "remove", raw, slot: slotHit.slot };
  }
  if (slotHit && dislikes) return another;
  // 「換成黑色襯衫」:明講要替換那一格,就只換一件,別因為句子含「西裝」之類的字就重挑整套
  if (slotHit && REPLACE_HINTS.some((h) => t.includes(h))) return { kind: "swap", raw, ...spec };
  if (slotHit && intent?.formality) {
    // 「面試要穿襯衫」:整套照場合挑,再把指定那格釘成指定單品
    return { kind: "outfit", raw, intent, pin: spec };
  }
  if (slotHit) return { kind: "swap", raw, ...spec };
  // 沒講品類,但講了款式或材質(「穿開襟的」「來件燈芯絨」):整櫃找
  const pointing = /那件|這件|那雙|這雙|那條|這條|那個|那頂/.test(t);
  if (descriptors.length && (wantsSwap || pointing) && !intent?.understood) return { kind: "swap", raw, ...spec };
  if (intent?.understood) return { kind: "outfit", raw, intent };
  // 沒講品類也沒講場合,但像在點名某一件(「穿哈利波特那件」「那件 Nike 的」):拿這段字去品名、標籤裡找;
  // 找不到的話,畫面那邊會退回「沒學過這個詞」
  if (phrase && (wantsSwap || pointing)) return { kind: "swap", raw, ...spec, byText: true };
  return { kind: "unknown", raw };
}

/* 點名單品時常講中文,品名、標籤裡是英文 */
const NAME_ALIASES = {
  "哈利波特": ["harry-potter", "slytherin", "hogwarts"], "史萊哲林": ["slytherin"], "耐吉": ["nike"], "愛迪達": ["adidas"],
  "紐巴倫": ["new balance"], "教士": ["padres"], "國民": ["nationals"], "大聯盟": ["mlb"], "鱷魚": ["lacoste"],
  "優衣庫": ["uniqlo"], "無印": ["muji"],
};
function textMatches(item, phrase) {
  if (!phrase) return false;
  const text = itemText(item);
  if (text.includes(phrase)) return true;
  return Object.entries(NAME_ALIASES).some(([zh, words]) => phrase.includes(zh) && words.some((word) => text.includes(word)));
}

/** 在指定槽位找最符合「品類＋顏色」的單品。回 { item, exact } 或 null(這類沒東西)。
 *  excludeId:「換一件」沒指定顏色品類時,排除身上那件,不然會換回同一件。 */
export function findItemForSwap(items, spec, wearLog = {}, excludeId = null) {
  const descriptors = spec.descriptors || [];
  const owned = items.filter((it) => !it.wishlist);
  // 候選:同一格的;再加上品名整段對得上、或描述字全中的別格單品。
  // 例:「開襟外套」——「灰色細針織開襟外套」建檔在上衣,只看外套那格永遠找不到它。沒講品類(slot 為 null)就整櫃找。
  const describedElsewhere = (it) => textMatches(it, spec.phrase)
    || (descriptors.length && descriptors.every((group) => group.some((word) => itemText(it).includes(word.toLowerCase()))));
  const pool = owned.filter((it) => !spec.slot || it.part === spec.slot || describedElsewhere(it));
  if (!pool.length) return null;
  const aliases = spec.category ? (CATEGORY_ALIASES[spec.category] || [spec.category]) : null;
  const scored = pool.map((it) => {
    const text = itemText(it);
    let score = 0, catHit = false, colorHit = false, descHit = true;
    const textHit = textMatches(it, spec.phrase);
    if (textHit) score += 5;   // 品名(或標籤)整段對上:幾乎就是它
    for (const group of descriptors) {
      const hits = group.filter((word) => text.includes(word.toLowerCase())).length;
      // 品名和英文標籤都對上(「開襟」＋cardigan)比只沾到一個字(「開襟領」Polo 衫)更像
      score += hits ? 2.5 + Math.min(hits - 1, 1) * 0.6 : -1.5;
      if (!hits) descHit = false;
    }
    if (spec.slot && it.part !== spec.slot) score -= 0.5;   // 別格的只在描述明顯更合時才贏
    // 品類比顏色重:要「黑襯衫」給深藍襯衫還說得過去,給黑衛衣就答非所問
    if (aliases) {
      catHit = aliases.some((a) => text.includes(a.toLowerCase()));
      score += catHit ? 4 : -2.5;
    }
    if (spec.color) {
      const byName = spec.color.words.some((w) => (it.name || "").includes(w));
      const hsls = itemColors(it).map(hexToHsl);
      const byHex = hsls.some((c) => spec.color.test(c));       // 主色/副色/色盤任一命中就算
      colorHit = byName || byHex;
      if (byName) {
        score += 3;
        // 使用者講的確切詞(「酒紅」「深藍」「米白」)命中名稱,再加一點,讓它贏過只含泛稱「紅」「藍」「白」的
        if (spec.color.word && (it.name || "").includes(spec.color.word)) score += 0.7;
      } else if (byHex) score += 1.5;
      else {
        // 沒命中:按最近的距離給分,「最接近」才真的是最接近
        const dist = hsls.length ? Math.min(...hsls.map((c) => colorDistance(spec.color, c))) : 1;
        score += -2 + (1 - dist) * 0.8;
      }
    }
    score += recencyPenalty(it, wearLog) * 0.3;
    if (excludeId && it.id === excludeId) score -= 5;
    return { it, score, catHit, colorHit, descHit, textHit };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const exact = (!aliases || best.catHit) && (!spec.color || best.colorHit) && best.descHit;
  return { item: best.it, exact, textHit: best.textHit };
}

/* ---------- 主入口 ---------- */

/* 被雨剔掉的單品講材質(麂皮、帆布、真皮),認不出材質就講短品名;同樣的只講一次。 */
const MATERIAL_WORDS = [["麂皮", /suede|麂皮/], ["帆布", /canvas|帆布/], ["真皮", /leather|真皮|皮革/], ["丹寧", /denim|丹寧|牛仔/]];
function materialsOf(list) {
  const out = [];
  for (const item of list) {
    const text = itemText(item);
    const material = MATERIAL_WORDS.find(([, pattern]) => pattern.test(text));
    const name = item.name || "";
    const word = material ? material[0] : `「${name.length > 10 ? `${name.slice(0, 10)}…` : name}」`;
    if (!out.includes(word)) out.push(word);
  }
  return out;
}

/**
 * 「隨機一套」:按鈕本來就叫隨機,但體感 36° 時 8 次有 2 次是毛衣加長褲(審查 F27)。
 * 有天氣就先濾掉跟今天差太多的上衣、外套、下身和鞋;沒有天氣(還沒抓到)就完全隨機,不等 API。
 * 每一格濾完沒東西就退回那一格全部,不會因為濾太嚴而少一件。
 */
export function randomOutfit(items, weather = null) {
  const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
  const byPart = (part) => items.filter((item) => item.part === part && !item.wishlist);
  const narrow = (list, keep) => { const kept = list.filter(keep); return kept.length ? kept : list; };
  const known = (item) => typeof item.warmth === "number";
  const feels = typeof weather?.feelsLike === "number" ? weather.feelsLike : null;
  const target = feels === null ? null : targetWarmth(feels);
  const wantOuter = feels === null ? null : needOuter(feels, weather.rainProb ?? 0);
  const outfit = {};

  const tops = byPart("upperbody");
  if (tops.length) {
    // 要穿外套的天氣,上衣本身薄一點(外套那份照 recommendOutfit 打 8 折算)
    const topTarget = target === null ? null : wantOuter ? Math.max(1, target - 2.4) : target;
    outfit.upperbody = pickOne(topTarget === null ? tops : narrow(tops, (top) => !known(top) || Math.abs(top.warmth - topTarget) <= 1.5));
  }
  const outers = byPart("wholebody_up");
  if (outers.length) {
    if (wantOuter === null) {
      if (Math.random() < 0.45) outfit.wholebody_up = pickOne(outers);
    } else if (wantOuter) {
      const need = (target - (known(outfit.upperbody || {}) ? outfit.upperbody.warmth : 1)) / 0.8;
      outfit.wholebody_up = pickOne(narrow(outers, (outer) => !known(outer) || Math.abs(outer.warmth - need) <= 1.5));
    } else if (Math.random() < 0.25) {
      const thin = outers.filter((outer) => known(outer) && outer.warmth <= 1);   // 熱天只會敞開披一件薄的
      if (thin.length) outfit.wholebody_up = pickOne(thin);
    }
  }
  const bottoms = byPart("lowerbody");
  if (bottoms.length) {
    outfit.lowerbody = pickOne(feels === null ? bottoms : narrow(bottoms, (bottom) => !known(bottom)
      || (feels < 22 ? bottom.warmth > 1 : feels >= 30 ? bottom.warmth <= 3 : true)));
  }
  const shoes = byPart("shoes");
  if (shoes.length) {
    outfit.shoes = pickOne(feels === null ? shoes : narrow(shoes, (shoe) => (feels >= 20 || !known(shoe) || shoe.warmth > 1)
      && !((weather.rainProb ?? 0) >= 60 && shoe.rainOk === false)));
  }
  // 配件:手錶天天戴、眼鏡多半也是,出現得比襪子、包多(2026-10-06 本人:隨機一套很少配到手錶眼鏡,舊版每類都只有 45%)
  // 皮帶只配有褲頭的褲子;隨身小物(鋼筆)不是穿的,不配
  const CHANCE = { socks: 0.45, bag: 0.45, eyewear: 0.6, wrist: 0.75, belt: 0.6, necklace: 0.4, ring: 0.6, accessories_up: 0.45 };
  const rainy = (weather?.rainProb ?? 0) >= SUNNY_RAIN_MAX;
  for (const part of ["socks", "bag", "eyewear", "wrist", "belt", "necklace", "ring", "accessories_up"]) {
    if (part === "belt" && !takesBelt(outfit.lowerbody)) continue;
    const list = part === "eyewear" && rainy ? byPart(part).filter((item) => !isSunglasses(item)) : byPart(part);
    if (list.length && Math.random() < CHANCE[part]) outfit[part] = pickOne(list);
  }
  return outfit;
}

/**
 * @param {Array} items    整櫃衣物(需含 warmth/rainOk/color/part)
 * @param {Object} weather fetchWeather() 的結果
 * @param {Object} wearLog readWearLog() 的結果
 * @param {Object} [intent] parseIntent() 的結果(場合意圖);null 就是純看天氣
 * @param {Object} [locked] 槽位→單品。鎖住的格不動,其他件圍著它配(配色/保暖都以它為前提)
 * @param {Map<string, number>} [avoid] 單品 id → 最近幾次推薦裡出現過幾次。按「再推薦一套」時帶進來,
 *        剛剛看過的往後排,不然只靠抖動,常常換來換去還是那幾件
 * @returns {{ outfit: Object, reasons: string[] } | { error: string, missing: string }}
 */
/** @param taste 自己穿過、收藏過、嫌過的組合(taste.js 的 readTaste);沒給就只看規則
 *  回傳的 recalled = 這套是「回味」穿過、收藏過的組合(三成的推薦會這樣挑) */
export function recommendOutfit(items, weather, wearLog, intent = null, locked = {}, avoid = null, taste = null) {
  // 次數 ≥ 99 = 這件一定不要(「換一件上衣」時身上那件)
  const seen = (item, weight) => {
    const count = (avoid && item && avoid.get(item.id)) || 0;
    if (count >= 99) return -50;
    // 講明顏色(「全黑」)時,合色系的那件重複出現比換成深藍好:連按也只輕扣,換的是同色系裡的別件
    return -Math.min(count, 2) * (strict && fitsPalette(item) ? weight * 0.4 : weight);
  };
  const inPalette = paletteTest(intent?.palette);
  const strict = isStrictPalette(intent?.palette);
  const fitsPalette = (item) => !inPalette || !item?.color || inPalette(item);
  const byPart = (part) => items.filter((item) => item.part === part && item.warmth !== undefined);
  const pool = (part) => (locked[part] ? [locked[part]] : byPart(part));
  const tops = pool("upperbody"), bottoms = pool("lowerbody");
  // 講缺什麼,畫面上才知道下一步要加哪一件(審查 F36:舊版只說「不夠」)
  if (!tops.length || !bottoms.length) {
    const missing = !tops.length && !bottoms.length ? "上衣和下身" : !tops.length ? "上衣" : "下身";
    const need = [!tops.length && "上衣 1 件", !bottoms.length && "下身 1 件"].filter(Boolean).join("、");
    return { error: `還差${need}就能配`, missing };
  }

  // 場合意圖可覆寫天氣:「當冷天穿」降體感、「會下雨」拉高降雨機率。重指派 weather(新物件,不動呼叫端)。
  const forecast = weather;   // 理由裡要講真的預報,不講被覆寫過的數字
  if (intent && (intent.warmthDelta || intent.forceRainy)) {
    weather = {
      ...weather,
      feelsLike: adjustedFeelsLike(weather.feelsLike, intent.warmthDelta || 0),
      rainProb: intent.forceRainy ? Math.max(weather.rainProb, 80) : weather.rainProb,
    };
  }

  const wantOuter = needOuter(weather.feelsLike, weather.rainProb);
  // 外套是最外層、最先淋到:下雨天跟鞋、包一樣先拿掉怕雨的(全都怕雨就不拿,總得穿一件)
  const rainyDay = weather.rainProb >= 50;
  const everyOuter = byPart("wholebody_up");
  const dryOuters = everyOuter.filter((outer) => outer.rainOk !== false);
  const allOuters = rainyDay && dryOuters.length ? dryOuters : everyOuter;
  const thinOuters = allOuters.filter((outer) => outer.warmth <= 1);
  // 說了色系:敞開穿的那件也要合色系,不然「全黑」披上彩色球衣(這櫃的薄外套全是球衣)
  const layerOuters = thinOuters.filter(fitsPalette);

  // 薄外套(棒球球衣、罩衫)是敞開當造型層穿的,熱天照樣成立,不該被 needOuter 的溫度閘門
  // 擋掉。但**不能**把它跟「不穿外套」一起丟進主迴圈比分數:主迴圈是幾千種組合取最高分,
  // 每組還帶 random()*1.6 的抖動,組合數一多兩邊的最大抖動都逼近 1.6,任何固定加減分都會
  // 被放大成「永遠」或「從不」—— 實測扣 0.6 分是 0/400 次,完全不扣是 400/400 次,中間沒有
  // 灰階。所以改成先擲一次骰子決定今天加不加,再讓主迴圈從薄外套裡挑配色最好的那件。
  // 正式/得體場合不玩「敞開薄外套」那套 —— 這櫃的薄外套全是棒球球衣,套上去會毀掉約會/面試的樣子
  const dressy = intent?.formality === "formal" || intent?.formality === "smart";
  let useOpenLayer = !wantOuter && layerOuters.length > 0 && !dressy && Math.random() < 0.35;
  let outers = wantOuter ? allOuters : (useOpenLayer ? layerOuters : [null]);
  // 講明顏色時外套不是非穿不可:16° 以上也可以只靠上衣保暖。「全黑」20° 穿黑色拉鍊帽T,
  // 不硬套深藍防風外套;合色系的外套夠合適時,照樣比分數贏過不穿(2026-10-05:這櫃唯一的黑外套是厚真皮騎士外套)
  if (wantOuter && strict && weather.feelsLike >= 16) outers = [...allOuters, null];
  // 這個場合點名要的外套(看球賽 → 球衣):不擲骰子,直接披上
  const wanted = intent?.boost ? thinOuters.filter((outer) => intent.boost.some((word) => itemText(outer).includes(word))) : [];
  if (!wantOuter && wanted.length) { useOpenLayer = true; outers = wanted; }
  if (locked.wholebody_up) { outers = [locked.wholebody_up]; useOpenLayer = false; }   // 鎖住的外套就是外套
  const target = targetWarmth(weather.feelsLike);

  // 自己的選擇(taste.js):嫌過的組合每次都扣;喜歡的(穿過、收藏過)不是每次都加。
  // 上衣×下身有幾百種組合、分數差都在抖動範圍內,每次都加的話,加 0.3 分就從 1% 變 30%、加 1.5 分變 94%
  // (2026-10-06 量的),等於天天推舊的。所以擲骰子:三成的推薦「回味」穿過、收藏過的組合,七成照規則找新的
  const recall = Boolean(taste?.size) && Math.random() < 0.3;
  const tasteOf = (a, b) => {
    const value = pairScore(taste, a, b);
    return value < 0 ? value : recall && value > 0 ? 2 : 0;
  };

  let best = null;
  for (const top of tops) {
    for (const bottom of bottoms) {
      for (const outer of outers.length ? outers : [null]) {
        const worn = [top, bottom, outer].filter(Boolean);
        let score = 0;

        // 1) 上身保暖貼合(外套會脫所以打 8 折)
        // 敞開穿的造型層保暖貢獻當 0,免得引擎為了湊保暖度而挑錯上衣
        const upper = top.warmth + (outer && !useOpenLayer ? outer.warmth * 0.8 : 0);
        score += 4 - Math.abs(upper - target) * 2.2;

        // 2) 下身:熱天短褲加分,冷天短褲扣分
        if (weather.feelsLike >= 26 && bottom.warmth <= 1 && intent?.formality !== "formal") score += 1.2;
        if (weather.feelsLike < 20 && bottom.warmth <= 1) score -= 3;
        // 20–23° 也還不是短褲天;為了保暖才穿外套,下面卻穿短褲,更怪(2026-10-05 示範衣櫃模擬:560 次裡 119 次)。
        // 下雨套防風外套配短褲照舊可以:台灣的雨天常這樣穿,褲管不會濕
        else if (weather.feelsLike < 23 && bottom.warmth <= 1) score -= 1.8;
        if (outer && !useOpenLayer && bottom.warmth <= 1 && weather.feelsLike < 24) score -= 2;

        // 3) 下雨:怕雨單品扣分
        // (扣 4.5:要蓋過「全黑」這類指定色系的 +1.3／-3,不然為了顏色穿真皮外套淋雨)
        if (weather.rainProb >= 50) for (const item of worn) if (item.rainOk === false) score -= 4.5;

        // 4) 配色
        score += colorScore(worn).score;

        // 4.2) 風格一致:襯衫不配運動褲、西裝外套不配短褲、花的只留一件
        score += styleClash(top, bottom, outer);

        // 4.5) 場合貼合:說了「面試」就穩定往正式挑(權重刻意大過 ±1.6 抖動)
        if (intent) for (const item of worn) score += intentItemScore(item, intent);

        // 4.7) 指定的色系(「全黑」「大地色」)
        if (inPalette) for (const item of worn) score += paletteItemScore(item, inPalette, strict);

        // 4.8) 自己的選擇:穿過、收藏過的組合加分,說過不好看的扣分(taste.js)
        if (taste) score += tasteOf(top, bottom) + tasteOf(top, outer) + tasteOf(bottom, outer);

        // 5) 最近穿過降權;剛剛推薦過的也往後排(鎖住的那格不算)
        for (const item of worn) score += recencyPenalty(item, wearLog);
        if (!locked.upperbody) score += seen(top, 1.4);
        if (!locked.lowerbody) score += seen(bottom, 1.4);
        if (!locked.wholebody_up) score += seen(outer, 1.4);

        // 6) 一點隨機,讓連按有變化
        score += Math.random() * 1.6;

        if (!best || score > best.score) best = { top, bottom, outer, score };
      }
    }
  }

  const outfit = { upperbody: best.top, lowerbody: best.bottom };
  if (best.outer) outfit.wholebody_up = best.outer;

  const chosen = [best.top, best.bottom, best.outer].filter(Boolean);

  // 鞋子:下雨先濾掉麂皮/帆布(全櫃都怕雨就不濾,總得穿一雙),再比配色和最近穿過
  const rainy = weather.rainProb >= 50;
  const allShoes = pool("shoes");
  // 26° 以下拖鞋本來就不算選項:下雨天不怕雨的只剩拖鞋時,寧可穿怕雨的那雙(舊的示範衣櫃 12° 下雨配羊毛大衣加拖鞋)
  const dryOnly = allShoes.filter((shoe) => shoe.rainOk !== false && (weather.feelsLike >= 26 || !shoe.tags?.includes("slides")));
  const shoePool = rainy && dryOnly.length ? dryOnly : allShoes;
  let duckedRain = false;
  let bestShoe = null;
  for (const shoe of shoePool) {
    let score = colorScore([...chosen, shoe]).score + recencyPenalty(shoe, wearLog) + intentItemScore(shoe, intent) + Math.random() * 1.2;
    score += shoeClash(shoe, best.top, best.bottom, best.outer, intent?.formality === "sporty");   // 拖鞋不配襯衫、皮鞋不配運動褲
    if (taste) score += tasteOf(shoe, best.top) + tasteOf(shoe, best.bottom);
    score += paletteItemScore(shoe, inPalette, strict) + seen(shoe, 0.8);
    if (weather.feelsLike >= 30 && shoe.warmth <= 1) score += 0.8;   // 熱到爆就別穿包腳的
    if (weather.feelsLike < 20 && shoe.warmth <= 1) score -= 3;      // 反過來,涼了別穿薄鞋
    if (shoe.tags?.includes("slides")) {
      // 拖鞋是夏天限定:26° 以下就別了,再冷更不用談
      if (weather.feelsLike < 26) score -= 4;
      if (weather.feelsLike < 20) score -= 4;
    }
    if (!bestShoe || score > bestShoe.score) bestShoe = { shoe, score };
  }
  if (bestShoe) {
    outfit.shoes = bestShoe.shoe;
    duckedRain = rainy && dryOnly.length > 0 && dryOnly.length < allShoes.length;
  }

  // 襪子:有就順手配一雙(挑最久沒穿的);穿拖鞋就免了
  if (locked.socks) outfit.socks = locked.socks;
  else if (outfit.shoes?.tags?.includes("slides") !== true) {
    const socks = byPart("socks").sort((a, b) => (wearLog[a.id] || "").localeCompare(wearLog[b.id] || ""));
    if (socks.length) outfit.socks = socks[0];
  }

  // 包:同樣先過雨,再比配色。下雨天要帶傘,順便偏好裝得下傘的後背包
  const allBags = pool("bag");
  const dryBags = allBags.filter((bag) => bag.rainOk !== false);
  const bagPool = rainy && dryBags.length ? dryBags : allBags;
  let bestBag = null;
  for (const bag of bagPool) {
    let score = colorScore([...chosen, bag]).score + recencyPenalty(bag, wearLog) + intentItemScore(bag, intent) + Math.random() * 1.2;
    score += paletteItemScore(bag, inPalette, strict) + seen(bag, 0.8);
    if (rainy && bag.tags?.includes("backpack")) score += 1;   // 折傘塞得進去
    if (!bestBag || score > bestBag.score) bestBag = { bag, score };
  }
  if (bestBag) outfit.bag = bestBag.bag;

  // 眼鏡、手錶、其他配件(2026-10-06 本人:今日推薦從來不配這幾類,舊版引擎根本沒挑)。
  // 只挑已經有的(想買的不算,也不看保暖度),比配色、色系、場合、最近戴過:
  //   手錶手環:有就戴一支,每天都戴的東西
  //   眼鏡:一般眼鏡照戴;太陽眼鏡只在不太會下雨的日子
  //   其他配件(帽子、項鍊…):一半的機率加,不每套都塞
  const wornSoFar = [...chosen, outfit.shoes, outfit.bag].filter(Boolean);
  const pickAccessory = (part, keep = () => true, bonus = () => 0) => {
    if (locked[part]) return locked[part];
    let bestAcc = null;
    for (const acc of items) {
      if (acc.part !== part || acc.wishlist || !keep(acc)) continue;
      const score = colorScore([...wornSoFar, acc]).score + recencyPenalty(acc, wearLog) + intentItemScore(acc, intent)
        + paletteItemScore(acc, inPalette, strict) + seen(acc, 0.8) + bonus(acc) + Math.random() * 1.2;
      if (!bestAcc || score > bestAcc.score) bestAcc = { acc, score };
    }
    return bestAcc?.acc || null;
  };
  const watch = pickAccessory("wrist");
  if (watch) outfit.wrist = watch;
  const glasses = pickAccessory("eyewear", (item) => weather.rainProb < SUNNY_RAIN_MAX || !isSunglasses(item));
  if (glasses) outfit.eyewear = glasses;
  if (locked.accessories_up || Math.random() < 0.5) {
    const extra = pickAccessory("accessories_up");
    if (extra) outfit.accessories_up = extra;
  }
  // 皮帶(2026-10-06):有褲頭的褲子才繫;跟鞋子深淺接近的優先(深色皮鞋配深色皮帶)
  if (locked.belt || takesBelt(best.bottom)) {
    const shoeL = outfit.shoes?.color ? hexToHsl(outfit.shoes.color).l : null;
    const belt = pickAccessory("belt", () => true, (acc) => (shoeL !== null && acc.color && Math.abs(hexToHsl(acc.color).l - shoeL) < 0.2 ? 0.8 : 0));
    if (belt) outfit.belt = belt;
  }
  // 戒指有就戴一只;項鍊四成。隨身小物(鋼筆)不是穿的,不配
  const ring = pickAccessory("ring");
  if (ring) outfit.ring = ring;
  if (locked.necklace || Math.random() < 0.4) {
    const necklace = pickAccessory("necklace");
    if (necklace) outfit.necklace = necklace;
  }
  const duckedRainBag = rainy && dryBags.length > 0 && dryBags.length < allBags.length;
  // 實際因為雨被剔掉的那些(理由要照實講,不寫死「麂皮帆布鞋」)
  const skippedShoes = duckedRain ? allShoes.filter((shoe) => shoe.rainOk === false) : [];
  const skippedBags = duckedRainBag ? allBags.filter((bag) => bag.rainOk === false) : [];

  const reasons = [];
  if (intent?.formality) {
    const how = { formal: "正式一點", smart: "得體一點", sporty: "好活動的", casual: "輕鬆自在" }[intent.formality];
    // 場合標籤本身就是那句話(如「得體一點」)時,別再接一次同樣的字,免得「為『得體一點』挑得體一點」
    const tail = how && !intent.label.includes(how) && !how.includes(intent.label) ? `挑${how}` : "搭配";
    reasons.push(`為「${intent.label}」${tail}`);
  }
  const feel = weather.feelsLike;
  const advice = feel >= 28 ? "選透氣的穿" : feel >= 22 ? "薄長袖或短袖都行" : feel >= 16 ? "記得保暖" : "穿暖一點";
  // 外面很熱、人說冷:多半是冷氣房、圖書館。外套要講成「帶著進室內穿」,不是「早晚偏涼」
  const indoorCold = intent?.warmthDelta < 0 && forecast.feelsLike >= 28;
  if (intent?.warmthDelta) {
    reasons.push(`照你說的${warmthPhrase(intent.warmthDelta)}:預報體感 ${forecast.feelsLike}°,照 ${feel}° 的穿法挑,${advice}`);
  } else {
    reasons.push(`體感 ${feel}°,${advice}`);
  }
  if (best.outer && !locked.wholebody_up) {
    const name = `「${best.outer.name}」`;
    if (useOpenLayer) reasons.push(`熱歸熱,${name}敞開穿當個層次`);
    else if (indoorCold) reasons.push(`外面還是 ${forecast.feelsLike}°,${name}帶著,進冷氣房再穿`);
    else if (feel < 24) {
      // 早晚偏涼只在今天溫差大時才講;整天都冷就直說
      const why = feel < 18 ? "天冷" : !intent?.warmthDelta && forecast.tMax - forecast.tMin >= 6 ? "早晚偏涼" : "有點涼";
      reasons.push(`${why},搭${name}`);
    } else reasons.push(`${intent?.forceRainy ? "你說會下雨" : "會下雨"},加件${name}`);
  }
  // 使用者自己說會下雨時,別報「降雨 80%」(那是被覆寫的假數字,和面板上的真預報打架);用「你說會下雨」誠實表述
  if (intent?.forceRainy) reasons.push("你說會下雨,記得帶傘");
  else if (weather.rainProb >= 50) reasons.push(`降雨 ${weather.rainProb}%,記得帶傘`);
  else if (weather.rainProb >= 30) reasons.push(`降雨 ${weather.rainProb}%,包包塞把折傘`);
  if (skippedShoes.length || skippedBags.length) {
    const avoided = [
      skippedShoes.length && `${materialsOf(skippedShoes).join("、")}的鞋`,
      skippedBags.length && `${materialsOf(skippedBags).join("、")}的包`,
    ].filter(Boolean);
    reasons.push(`會下雨,${avoided.join("和")}先收著`);
  }
  // 這套裡有自己穿過、收藏過的組合:講出來,知道推薦是看過你的選擇的
  const recalled = recall && pairScore(taste, best.top, best.bottom) > 0;
  if (recalled) reasons.push(`「${best.top.name}」配「${best.bottom.name}」你之前穿過或收藏過`);
  const colorInfo = colorScore([best.top, best.bottom, best.outer].filter(Boolean));
  if (inPalette) {
    // 說了色系就講做到幾成;櫃裡湊不齊也照實講,不假裝
    const pieces = [best.top, best.bottom, best.outer, outfit.shoes].filter(Boolean);
    const off = pieces.filter((item) => !fitsPalette(item));
    // 鞋子、外套不合色系,是因為合的那件怕雨收起來了:講雨,不講「櫃裡沒有」
    const rainedShoe = outfit.shoes && off.includes(outfit.shoes) && !locked.shoes
      ? skippedShoes.find((shoe) => shoe.color && inPalette(shoe)) : null;
    const rainedOuter = rainy && best.outer && off.includes(best.outer) && !locked.wholebody_up
      ? everyOuter.find((outer) => outer.rainOk === false && outer.color && inPalette(outer)) : null;
    const others = off.filter((item) => !(rainedShoe && item === outfit.shoes) && !(rainedOuter && item === best.outer));
    const why = [
      rainedOuter && `合色系的「${rainedOuter.name}」怕雨,外套換成「${best.outer.name}」`,
      rainedShoe && `合色系的「${rainedShoe.name}」怕雨先收著,鞋子換成「${outfit.shoes.name}」`,
      others.length && `「${others[0].name}」${others.length > 1 ? `等 ${others.length} 件` : ""}不在這個色系(櫃裡這個條件下沒有更合的)`,
    ].filter(Boolean);
    reasons.push(why.length
      ? `照「${intent.palette.label}」挑,不過${why.join(";")}`
      : `照「${intent.palette.label}」挑,整套都在這個色系`);
  } else if (colorInfo.score > 0) reasons.push(colorInfo.label);

  // 誠實:說了要正式/得體,但櫃裡湊不出來時講清楚,別假裝挑到了
  if (intent?.formality === "formal" || intent?.formality === "smart") {
    if (!chosen.some((it) => cueHit(it)?.kind === "正式")) {
      reasons.push("櫃裡正式單品不多,先挑了最不休閒的");
    }
    // 跟下面「看到的線索」用同一把尺(cueHit),免得一邊說 leather 正式、一邊說沒正式鞋。
    // 原因要分清楚:被雨剔掉的不能講成「櫃裡沒有」(審查 F16);鞋是自己鎖的就不用解釋
    if (outfit.shoes && !locked.shoes && cueHit(outfit.shoes)?.kind !== "正式") {
      const rainedOut = skippedShoes.find((shoe) => cueHit(shoe)?.kind === "正式");
      const passedOver = allShoes.find((shoe) => cueHit(shoe)?.kind === "正式");
      if (rainedOut) reasons.push(`正式的「${rainedOut.name}」怕雨,這次配偏休閒的`);
      else if (passedOver) reasons.push(`正式的「${passedOver.name}」這次沒選上,配了偏休閒的`);
      else reasons.push("櫃裡沒有正式一點的鞋,配了偏休閒的");
    }
  }

  // 透明化:列出每件核心單品「命中了哪個線索」,讓場合評分不是黑盒
  if (intent?.formality) {
    const shown = [...chosen, outfit.shoes].filter(Boolean).map((it) => {
      const hit = cueHit(it);
      const name = it.name || "";
      // 讀法:單品 → 命中的線索(類別);截斷時去掉尾巴半個括號,箭頭順著讀不逆向
      const short = name.length > 12 ? `${name.slice(0, 12).replace(/[（(【\[]+$/, "")}…` : name;
      // 線索詞有一半是英文標籤(leather、tee),畫面上換成中文(審查 F50);這段是刻意做的透明化,不拿掉
      return hit ? `「${short}」有${CUE_ZH[hit.w] || hit.w},算${hit.kind}` : `「${short}」看不出來`;
    });
    reasons.push(`看到的線索:${shown.join(";")}`);
  }

  return { outfit, reasons, recalled };
}
