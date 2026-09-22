// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
/* recommend.js — 每日穿搭推薦引擎(純函式,不碰 DOM)。
 *
 * 規則移植自 outfit-today 專案的 engine.js,改吃 wardrobe-ai 的資料格式:
 * 每件衣物需有 warmth(1~5)、rainOk、color(hex);由 tools/enrich-metadata.mjs 補齊。
 *
 * 評分 = 保暖貼合 + 配色和諧 + 最近穿過降權 + 一點隨機(讓「再推薦一次」有變化)。
 * 穿著紀錄存 localStorage,和微調紀錄一樣跟著瀏覽器走。 */

const TAICHUNG = { lat: 24.1477, lon: 120.6736 };
const WEARLOG_KEY = "open-wardrobe-wearlog-v1";

const WMO_DESC = {
  0: "晴朗", 1: "大致晴朗", 2: "多雲", 3: "陰天", 45: "起霧", 48: "起霧",
  51: "毛毛雨", 53: "毛毛雨", 55: "毛毛雨", 61: "小雨", 63: "中雨", 65: "大雨",
  80: "陣雨", 81: "陣雨", 82: "強陣雨", 95: "雷雨", 96: "雷雨", 99: "雷雨",
};

export async function fetchWeather() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${TAICHUNG.lat}&longitude=${TAICHUNG.lon}`
    + `&current=temperature_2m,apparent_temperature,weather_code`
    + `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max`
    + `&timezone=Asia%2FTaipei&forecast_days=1`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`weather http ${response.status}`);
  const data = await response.json();
  return {
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

export function recordWear(items) {
  const log = readWearLog();
  const today = new Date().toLocaleDateString("sv");
  for (const item of items) log[item.id] = today;
  localStorage.setItem(WEARLOG_KEY, JSON.stringify(log));
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

function isNeutral(hex) {
  const { s, l } = hexToHsl(hex);
  return s < 0.22 || l < 0.18 || l > 0.9;
}

function colorScore(items) {
  const accents = [];
  for (const item of items) {
    if (item.color && !isNeutral(item.color)) accents.push(hexToHsl(item.color).h);
  }
  if (accents.length <= 1) return { score: 2, label: accents.length ? "中性色打底一個主色" : "全中性色" };
  // 兩個以上主色:色相接近(同家族/鄰近 60°)可接受,差太遠扣分
  let worst = 0;
  for (let i = 0; i < accents.length; i++) {
    for (let j = i + 1; j < accents.length; j++) {
      let diff = Math.abs(accents[i] - accents[j]) % 360;
      if (diff > 180) diff = 360 - diff;
      worst = Math.max(worst, diff);
    }
  }
  if (worst < 60) return { score: 1, label: "同色系搭配" };
  return { score: -3, label: "顏色可能打架" };
}

/* ---------- 場合意圖:把一句話(「面試」「下雨天上課」「運動」)轉成挑衣偏好 ----------
 * 純關鍵字規則,零依賴、零成本、決定論 —— 和引擎其他規則同一個世界觀,不呼叫任何 API。
 * occasions 詞彙太薄(只有 school/out/sport),所以正式度靠 name + tags 判。 */

const FORMAL_CUES = ["襯衫", "shirt", "西裝", "suit", "blazer", "西裝褲", "slacks", "chino", "卡其", "皮鞋", "皮革", "leather", "loafer", "oxford", "derby", "大衣", "coat", "羊毛", "wool", "tailored", "條紋襯衫", "polo"];
const SPORTY_CUES = ["運動", "sport", "球衣", "jersey", "sweat", "帽t", "hoodie", "連帽", "track", "jogger", "棉褲", "機能", "mesh", "網布", "running", "慢跑", "排汗", "athletic", "sneaker", "gym", "拖鞋", "slides"];
const CASUAL_CUES = ["denim", "丹寧", "jeans", "牛仔", "distressed", "破損", "baggy", "寬版", "oversize", "tee", "t-shirt", "短褲", "shorts", "canvas", "帆布", "casual", "cotton", "棉"];

// 意圖規則:由「最正式」往「最休閒」排,取第一個命中的當 formality。
// 詞彙表(2026-09-21 補齊:站主打「工作」被回沒聽懂)。長詞先於短詞、正式先於休閒。
const INTENT_FORMALITY = [
  { formality: "formal", label: "正式場合", keys: ["面試", "interview", "正式", "正裝", "上台", "報告", "簡報", "發表", "presentation", "婚禮", "wedding", "喜宴", "喪禮", "告別式", "典禮", "畢業", "頒獎", "見家長", "商務", "演講", "開會", "會議", "meeting", "面談", "口試", "答辯", "見客戶"] },
  { formality: "smart", label: "得體一點", keys: ["約會", "date", "吃飯", "聚餐", "晚餐", "dinner", "餐廳", "下午茶", "咖啡廳", "見面", "看展", "展覽", "工作", "上班", "打工", "實習", "辦公", "公司", "拜訪", "拍照", "約拍", "派對", "party", "演唱會", "音樂會", "約"] },
  { formality: "sporty", label: "運動", activity: "sport", keys: ["運動", "健身", "gym", "跑步", "慢跑", "run", "打球", "籃球", "羽球", "桌球", "網球", "爬山", "登山", "hiking", "騎車", "單車", "健走", "workout", "練球"] },
  { formality: "casual", label: "上課", occasionPref: "school", keys: ["上課", "上學", "學校", "class", "school", "考試", "圖書館"] },
  { formality: "casual", label: "在家耍廢", keys: ["耍廢", "在家", "宅", "躺", "睡", "休息", "放假", "廢"] },
  { formality: "casual", label: "日常出門", keys: ["出門", "日常", "隨便", "逛街", "出去玩", "出遊", "旅行", "旅遊", "野餐", "露營", "看電影", "買菜", "超市", "便利商店", "倒垃圾", "見朋友", "朋友", "拜拜", "散步", "chill"] },
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

  let formality = null, label = null, activity = null, occasionPref = null;
  for (const rule of INTENT_FORMALITY) {
    if (has(rule.keys)) {
      formality = rule.formality; label = rule.label;
      activity = rule.activity || null; occasionPref = rule.occasionPref || null;
      break;
    }
  }

  // 天氣覆寫(和場合獨立):使用者可能同時提到冷熱或雨
  let warmthDelta = 0;
  if (has(["寒流"])) warmthDelta = -9;
  else if (has(["冷", "天冷", "變冷"])) warmthDelta = -6;
  else if (has(["涼", "微涼"])) warmthDelta = -3;
  else if (has(["很熱", "超熱", "大熱天", "炎熱"])) warmthDelta = 6;
  else if (has(["熱"])) warmthDelta = 5;
  const forceRainy = has(["下雨", "會下雨", "雨天", "雷雨", "陣雨", "下雨天"]);

  const bits = [];
  if (label) bits.push(label);
  if (warmthDelta < 0) bits.push("當冷天穿");
  else if (warmthDelta > 0) bits.push("當熱天穿");
  if (forceRainy) bits.push("當下雨天");
  const understood = bits.length ? bits.join(" · ") : null;

  return { raw, understood, formality, label, activity, occasionPref, warmthDelta, forceRainy };
}

const itemText = (item) => `${item.name || ""} ${(item.tags || []).join(" ")}`.toLowerCase();

/** 單品對某 formality 的貼合度。權重刻意 ≥1.2 —— 主迴圈每組帶 ±1.6 抖動,太小的偏好會被抖動吃掉
 *  (見主迴圈註解);但「說了正式就穩定挑正式」是要蓋過抖動的『持續偏好』,不是機率性出場,所以夠大就行。*/
function intentItemScore(item, intent) {
  if (!intent || !intent.formality) return 0;
  const text = itemText(item);
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
  const pref = intent.activity === "sport" ? "sport" : intent.occasionPref;
  if (pref && item.occasions?.includes(pref)) s += 0.6;
  return s;
}

/** 一件單品最先命中的風格線索(給理由面板用,讓評分不是黑盒)。 */
function cueHit(item) {
  const text = itemText(item);
  const find = (list, kind) => { const w = list.find((k) => text.includes(k.toLowerCase())); return w ? { w, kind } : null; };
  return find(FORMAL_CUES, "正式") || find(SPORTY_CUES, "運動") || find(CASUAL_CUES, "休閒") || null;
}

/* ---------- 單品請求:「換成黑色襯衫」「脫掉外套」 ----------
 * 對應 drape 的 request route(specific item / remove a piece),一樣純關鍵字。 */

// 槽位關鍵字:長詞排前、外套組排在上衣前 —— 免得「帽T」被配件的「帽」搶走、「襯衫外套」被上衣的「襯衫」搶走。
const SLOT_WORDS = [
  { slot: "wholebody_up", words: ["襯衫外套", "棒球外套", "外套", "夾克", "大衣", "風衣", "罩衫", "球衣"] },
  { slot: "upperbody", words: ["帽t", "衛衣", "襯衫", "polo", "t恤", "tee", "毛衣", "針織", "背心", "長袖", "短袖", "上衣"] },
  { slot: "lowerbody", words: ["牛仔褲", "西裝褲", "短褲", "長褲", "褲子", "褲"] },
  { slot: "shoes", words: ["拖鞋", "涼鞋", "皮鞋", "球鞋", "慢跑鞋", "靴", "鞋"] },
  { slot: "socks", words: ["襪"] },
  { slot: "bag", words: ["後背包", "背包", "側背包", "腰包", "包包", "包"] },
  { slot: "eyewear", words: ["墨鏡", "眼鏡"] },
  { slot: "wrist", words: ["手錶", "手環", "錶"] },
  { slot: "accessories_up", words: ["帽子", "圍巾", "帽"] },
];
// 太泛的品類字(幾乎沒有單品名稱含「上衣」「鞋」),只用來定槽位、不拿去比對名稱
const GENERIC_CATEGORY = new Set(["上衣", "褲", "褲子", "鞋", "包", "包包", "襪", "錶", "帽"]);
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
  { key: "pink", words: ["粉"], target: { h: 335, l: 0.75 }, test: (c) => c.h >= 320 && c.h <= 350 && c.l > 0.6 },
  { key: "yellow", words: ["黃", "金"], target: { h: 55, l: 0.6 }, test: (c) => c.h >= 45 && c.h <= 70 && c.s > 0.3 },
  { key: "orange", words: ["橘", "橙"], target: { h: 30, l: 0.55 }, test: (c) => c.h >= 15 && c.h <= 45 && c.s > 0.5 && c.l > 0.4 },
];

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
const REMOVE_HINTS = ["脫掉", "脫", "拿掉", "拿走", "不要", "去掉", "移除", "別穿", "不穿"];

// 對話式修正(2026-09-21 第一梯隊):這些要排在「換/脫」前面判,因為「不要換上衣」同時含「不要」和「換」。
const KEEP_HINTS = ["留著", "留住", "保留", "不要換", "不換", "不動", "鎖住", "鎖", "keep"];
const UNLOCK_HINTS = ["解鎖", "放開", "都可以換", "全部可以換", "不用鎖"];
const UNDO_HINTS = ["上一步", "復原", "回上一步", "退回", "undo", "回到剛剛", "剛剛那套"];
const REROLL_HINTS = ["再來一套", "換一套", "重挑", "再挑", "另一套", "不喜歡", "再一套", "其他換", "其他的換"];
const MORE_FORMAL = ["再正式", "正式一點", "正式點", "更正式", "體面一點", "正經一點"];
const MORE_CASUAL = ["再休閒", "休閒一點", "休閒點", "更休閒", "輕鬆一點", "隨性一點", "隨便一點", "放鬆一點"];
const COOLER = ["再涼", "涼一點", "涼快一點", "太熱", "熱死", "薄一點", "少穿一點", "會熱"];
const WARMER = ["再暖", "暖一點", "太冷", "冷死", "厚一點", "多穿一點", "會冷", "保暖一點"];

const LADDER = ["casual", "smart", "formal"];
const LADDER_LABEL = { casual: "輕鬆一點", smart: "得體一點", formal: "正式場合" };

/** 把「再正式一點／再涼一點」套在上一次的意圖上,回新意圖＋要跟使用者說的話(例如已經最正式了)。 */
export function adjustIntent(prev, adj) {
  const base = prev
    ? { ...prev }
    : { raw: "", understood: null, formality: null, label: null, activity: null, occasionPref: null, warmthDelta: 0, forceRainy: false };
  const notes = [];
  if (adj.formalityStep) {
    const cur = base.formality === "sporty" ? "casual" : base.formality;      // 運動當作休閒那一階
    const idx = cur ? LADDER.indexOf(cur) : (adj.formalityStep > 0 ? 0 : 1);   // 沒場合:往上從休閒起跳→得體,往下→輕鬆
    const next = LADDER[Math.max(0, Math.min(LADDER.length - 1, idx + adj.formalityStep))];
    if (cur && next === cur) notes.push(adj.formalityStep > 0 ? "已經是最正式的了" : "已經是最輕鬆的了");
    base.formality = next; base.label = LADDER_LABEL[next]; base.activity = null; base.occasionPref = null;
  }
  if (adj.warmthDelta) base.warmthDelta = Math.max(-12, Math.min(12, (base.warmthDelta || 0) + adj.warmthDelta));
  const bits = [];
  if (base.label) bits.push(base.label);
  if (base.warmthDelta < 0) bits.push("當冷天穿"); else if (base.warmthDelta > 0) bits.push("當熱天穿");
  if (base.forceRainy) bits.push("當下雨天");
  base.understood = bits.length ? bits.join(" · ") : null;
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

/** 把一句話分成四種請求:換單品 / 脫一件 / 整套(場合) / 聽不懂。 */
export function parseRequest(text) {
  const raw = (text || "").trim();
  if (!raw) return null;
  const t = raw.toLowerCase();
  const slotHit = detectSlot(t);
  const color = detectColor(t);
  const intent = parseIntent(raw);
  const has = (list) => list.some((h) => t.includes(h));
  const wantsSwap = has(SWAP_HINTS);
  const wantsRemove = has(REMOVE_HINTS);

  // 對話式修正先判(見 KEEP_HINTS 註解)
  if (has(UNDO_HINTS)) return { kind: "undo", raw };
  if (has(UNLOCK_HINTS)) return { kind: "unlock", raw, slot: slotHit?.slot || null };
  if (slotHit && has(KEEP_HINTS)) return { kind: "keep", raw, slot: slotHit.slot, reroll: has(REROLL_HINTS) };
  const step = has(MORE_FORMAL) ? 1 : has(MORE_CASUAL) ? -1 : 0;
  const warm = has(COOLER) ? 4 : has(WARMER) ? -4 : 0;
  if (!slotHit && (step || warm || has(REROLL_HINTS))) return { kind: "adjust", raw, formalityStep: step, warmthDelta: warm };

  if (slotHit && wantsRemove && !wantsSwap) return { kind: "remove", raw, slot: slotHit.slot };
  // 「換成黑色襯衫」:明講要替換那一格,就只換一件,別因為句子含「西裝」之類的字就重挑整套
  if (slotHit && REPLACE_HINTS.some((h) => t.includes(h))) return { kind: "swap", raw, slot: slotHit.slot, category: slotHit.category, color };
  if (slotHit && intent?.formality) {
    // 「面試要穿襯衫」:整套照場合挑,再把指定那格釘成指定單品
    return { kind: "outfit", raw, intent, pin: { slot: slotHit.slot, category: slotHit.category, color } };
  }
  if (slotHit) return { kind: "swap", raw, slot: slotHit.slot, category: slotHit.category, color };
  if (intent?.understood) return { kind: "outfit", raw, intent };
  return { kind: "unknown", raw };
}

/** 在指定槽位找最符合「品類＋顏色」的單品。回 { item, exact } 或 null(這類沒東西)。
 *  excludeId:「換一件」沒指定顏色品類時,排除身上那件,不然會換回同一件。 */
export function findItemForSwap(items, spec, wearLog = {}, excludeId = null) {
  const pool = items.filter((it) => it.part === spec.slot);
  if (!pool.length) return null;
  const aliases = spec.category ? (CATEGORY_ALIASES[spec.category] || [spec.category]) : null;
  const scored = pool.map((it) => {
    const text = itemText(it);
    let score = 0, catHit = false, colorHit = false;
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
    return { it, score, catHit, colorHit };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const exact = (!aliases || best.catHit) && (!spec.color || best.colorHit);
  return { item: best.it, exact };
}

/* ---------- 主入口 ---------- */

/**
 * @param {Array} items    整櫃衣物(需含 warmth/rainOk/color/part)
 * @param {Object} weather fetchWeather() 的結果
 * @param {Object} wearLog readWearLog() 的結果
 * @param {Object} [intent] parseIntent() 的結果(場合意圖);null 就是純看天氣
 * @param {Object} [locked] 槽位→單品。鎖住的格不動,其他件圍著它配(配色/保暖都以它為前提)
 * @returns {{ outfit: Object, reasons: string[] } | { error: string }}
 */
export function recommendOutfit(items, weather, wearLog, intent = null, locked = {}) {
  const byPart = (part) => items.filter((item) => item.part === part && item.warmth !== undefined);
  const pool = (part) => (locked[part] ? [locked[part]] : byPart(part));
  const tops = pool("upperbody"), bottoms = pool("lowerbody");
  if (!tops.length || !bottoms.length) return { error: "衣櫃裡上衣或下身不夠,沒辦法推薦" };

  // 場合意圖可覆寫天氣:「當冷天穿」降體感、「會下雨」拉高降雨機率。重指派 weather(新物件,不動呼叫端)。
  if (intent && (intent.warmthDelta || intent.forceRainy)) {
    weather = {
      ...weather,
      feelsLike: weather.feelsLike + (intent.warmthDelta || 0),
      rainProb: intent.forceRainy ? Math.max(weather.rainProb, 80) : weather.rainProb,
    };
  }

  const wantOuter = needOuter(weather.feelsLike, weather.rainProb);
  const allOuters = byPart("wholebody_up");
  const thinOuters = allOuters.filter((outer) => outer.warmth <= 1);

  // 薄外套(棒球球衣、罩衫)是敞開當造型層穿的,熱天照樣成立,不該被 needOuter 的溫度閘門
  // 擋掉。但**不能**把它跟「不穿外套」一起丟進主迴圈比分數:主迴圈是幾千種組合取最高分,
  // 每組還帶 random()*1.6 的抖動,組合數一多兩邊的最大抖動都逼近 1.6,任何固定加減分都會
  // 被放大成「永遠」或「從不」—— 實測扣 0.6 分是 0/400 次,完全不扣是 400/400 次,中間沒有
  // 灰階。所以改成先擲一次骰子決定今天加不加,再讓主迴圈從薄外套裡挑配色最好的那件。
  // 正式/得體場合不玩「敞開薄外套」那套 —— 這櫃的薄外套全是棒球球衣,套上去會毀掉約會/面試的樣子
  const dressy = intent?.formality === "formal" || intent?.formality === "smart";
  let useOpenLayer = !wantOuter && thinOuters.length > 0 && !dressy && Math.random() < 0.35;
  let outers = wantOuter ? allOuters : (useOpenLayer ? thinOuters : [null]);
  if (locked.wholebody_up) { outers = [locked.wholebody_up]; useOpenLayer = false; }   // 鎖住的外套就是外套
  const target = targetWarmth(weather.feelsLike);

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
        if (weather.feelsLike >= 26 && bottom.warmth <= 1) score += 1.2;
        if (weather.feelsLike < 20 && bottom.warmth <= 1) score -= 3;

        // 3) 下雨:怕雨單品扣分
        if (weather.rainProb >= 50) for (const item of worn) if (item.rainOk === false) score -= 3;

        // 4) 配色
        score += colorScore(worn).score;

        // 4.5) 場合貼合:說了「面試」就穩定往正式挑(權重刻意大過 ±1.6 抖動)
        if (intent) for (const item of worn) score += intentItemScore(item, intent);

        // 5) 最近穿過降權
        for (const item of worn) score += recencyPenalty(item, wearLog);

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
  const dryOnly = allShoes.filter((shoe) => shoe.rainOk !== false);
  const shoePool = rainy && dryOnly.length ? dryOnly : allShoes;
  let duckedRain = false;
  let bestShoe = null;
  for (const shoe of shoePool) {
    let score = colorScore([...chosen, shoe]).score + recencyPenalty(shoe, wearLog) + intentItemScore(shoe, intent) + Math.random() * 1.2;
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
    if (rainy && bag.tags?.includes("backpack")) score += 1;   // 折傘塞得進去
    if (!bestBag || score > bestBag.score) bestBag = { bag, score };
  }
  if (bestBag) outfit.bag = bestBag.bag;
  const duckedRainBag = rainy && dryBags.length > 0 && dryBags.length < allBags.length;

  const reasons = [];
  if (intent?.formality) {
    const how = { formal: "正式一點", smart: "得體一點", sporty: "好活動的", casual: "輕鬆自在" }[intent.formality];
    // 場合標籤本身就是那句話(如「得體一點」)時,別再接一次同樣的字,免得「為『得體一點』挑得體一點」
    const tail = how && !intent.label.includes(how) && !how.includes(intent.label) ? `挑${how}` : "搭配";
    reasons.push(`為「${intent.label}」${tail}`);
  }
  if (intent && (intent.warmthDelta || intent.forceRainy)) {
    const say = [];
    if (intent.warmthDelta < 0) say.push("當涼天");
    else if (intent.warmthDelta > 0) say.push("當熱天");
    if (intent.forceRainy) say.push("會下雨");
    reasons.push(`照你說的:${say.join("、")}穿`);
  }
  reasons.push(`體感 ${weather.feelsLike}°,${weather.feelsLike >= 28 ? "選透氣的穿" : weather.feelsLike >= 22 ? "薄長袖或短袖都行" : "記得保暖"}`);
  if (best.outer) {
    reasons.push(wantOuter
      ? `早晚偏涼,搭「${best.outer.name}」`
      : `熱歸熱,「${best.outer.name}」敞開穿當個層次`);
  }
  // 使用者自己說會下雨時,別報「降雨 80%」(那是被覆寫的假數字,和面板上的真預報打架);用「你說會下雨」誠實表述
  if (intent?.forceRainy) reasons.push("你說會下雨,記得帶傘");
  else if (weather.rainProb >= 50) reasons.push(`降雨 ${weather.rainProb}%,記得帶傘`);
  else if (weather.rainProb >= 30) reasons.push(`降雨 ${weather.rainProb}%,包包塞把折傘`);
  if (duckedRain || duckedRainBag) {
    const avoided = [duckedRain && "麂皮帆布鞋", duckedRainBag && "皮革丹寧包"].filter(Boolean);
    reasons.push(`會下雨,避開${avoided.join("和")}`);
  }
  const colorInfo = colorScore([best.top, best.bottom, best.outer].filter(Boolean));
  if (colorInfo.score > 0) reasons.push(colorInfo.label);

  // 誠實:說了要正式/得體,但櫃裡湊不出來時講清楚,別假裝挑到了
  if (intent?.formality === "formal" || intent?.formality === "smart") {
    if (!chosen.some((it) => FORMAL_CUES.some((k) => itemText(it).includes(k.toLowerCase())))) {
      reasons.push("櫃裡正式單品不多,先挑了最不休閒的");
    }
    // 跟下面「看到的線索」用同一把尺(cueHit),免得一邊說 leather 正式、一邊說沒正式鞋
    if (outfit.shoes && cueHit(outfit.shoes)?.kind !== "正式") {
      reasons.push("櫃裡沒有正式一點的鞋,配了偏休閒的");
    }
  }

  // 透明化:列出每件核心單品「命中了哪個線索」,讓場合評分不是黑盒
  if (intent?.formality) {
    const shown = [...chosen, outfit.shoes].filter(Boolean).map((it) => {
      const hit = cueHit(it);
      const name = it.name || "";
      // 讀法:單品 → 命中的線索(類別);截斷時去掉尾巴半個括號,箭頭順著讀不逆向
      const short = name.length > 12 ? `${name.slice(0, 12).replace(/[（(【\[]+$/, "")}…` : name;
      return hit ? `${short} → ${hit.w}(${hit.kind})` : `${short} → 無線索`;
    });
    reasons.push(`看到的線索:${shown.join(" · ")}`);
  }

  return { outfit, reasons };
}
