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

/* ---------- 主入口 ---------- */

/**
 * @param {Array} items    整櫃衣物(需含 warmth/rainOk/color/part)
 * @param {Object} weather fetchWeather() 的結果
 * @param {Object} wearLog readWearLog() 的結果
 * @returns {{ outfit: Object, reasons: string[] } | { error: string }}
 */
export function recommendOutfit(items, weather, wearLog) {
  const byPart = (part) => items.filter((item) => item.part === part && item.warmth !== undefined);
  const tops = byPart("upperbody"), bottoms = byPart("lowerbody");
  if (!tops.length || !bottoms.length) return { error: "衣櫃裡上衣或下身不夠,沒辦法推薦" };

  const wantOuter = needOuter(weather.feelsLike, weather.rainProb);
  const allOuters = byPart("wholebody_up");
  const thinOuters = allOuters.filter((outer) => outer.warmth <= 1);

  // 薄外套(棒球球衣、罩衫)是敞開當造型層穿的,熱天照樣成立,不該被 needOuter 的溫度閘門
  // 擋掉。但**不能**把它跟「不穿外套」一起丟進主迴圈比分數:主迴圈是幾千種組合取最高分,
  // 每組還帶 random()*1.6 的抖動,組合數一多兩邊的最大抖動都逼近 1.6,任何固定加減分都會
  // 被放大成「永遠」或「從不」—— 實測扣 0.6 分是 0/400 次,完全不扣是 400/400 次,中間沒有
  // 灰階。所以改成先擲一次骰子決定今天加不加,再讓主迴圈從薄外套裡挑配色最好的那件。
  const useOpenLayer = !wantOuter && thinOuters.length > 0 && Math.random() < 0.35;
  const outers = wantOuter ? allOuters : (useOpenLayer ? thinOuters : [null]);
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
  const allShoes = byPart("shoes");
  const dryOnly = allShoes.filter((shoe) => shoe.rainOk !== false);
  const shoePool = rainy && dryOnly.length ? dryOnly : allShoes;
  let duckedRain = false;
  let bestShoe = null;
  for (const shoe of shoePool) {
    let score = colorScore([...chosen, shoe]).score + recencyPenalty(shoe, wearLog) + Math.random() * 1.2;
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
  if (outfit.shoes?.tags?.includes("slides") !== true) {
    const socks = byPart("socks").sort((a, b) => (wearLog[a.id] || "").localeCompare(wearLog[b.id] || ""));
    if (socks.length) outfit.socks = socks[0];
  }

  // 包:同樣先過雨,再比配色。下雨天要帶傘,順便偏好裝得下傘的後背包
  const allBags = byPart("bag");
  const dryBags = allBags.filter((bag) => bag.rainOk !== false);
  const bagPool = rainy && dryBags.length ? dryBags : allBags;
  let bestBag = null;
  for (const bag of bagPool) {
    let score = colorScore([...chosen, bag]).score + recencyPenalty(bag, wearLog) + Math.random() * 1.2;
    if (rainy && bag.tags?.includes("backpack")) score += 1;   // 折傘塞得進去
    if (!bestBag || score > bestBag.score) bestBag = { bag, score };
  }
  if (bestBag) outfit.bag = bestBag.bag;
  const duckedRainBag = rainy && dryBags.length > 0 && dryBags.length < allBags.length;

  const reasons = [];
  reasons.push(`體感 ${weather.feelsLike}°,${weather.feelsLike >= 28 ? "選透氣的穿" : weather.feelsLike >= 22 ? "薄長袖或短袖都行" : "記得保暖"}`);
  if (best.outer) {
    reasons.push(wantOuter
      ? `早晚偏涼,搭「${best.outer.name}」`
      : `熱歸熱,「${best.outer.name}」敞開穿當個層次`);
  }
  if (weather.rainProb >= 50) reasons.push(`降雨 ${weather.rainProb}%,記得帶傘`);
  else if (weather.rainProb >= 30) reasons.push(`降雨 ${weather.rainProb}%,包包塞把折傘`);
  if (duckedRain || duckedRainBag) {
    const avoided = [duckedRain && "麂皮帆布鞋", duckedRainBag && "皮革丹寧包"].filter(Boolean);
    reasons.push(`會下雨,避開${avoided.join("和")}`);
  }
  const colorInfo = colorScore([best.top, best.bottom, best.outer].filter(Boolean));
  if (colorInfo.score > 0) reasons.push(colorInfo.label);

  return { outfit, reasons };
}
