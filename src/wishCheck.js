// [本 fork 新增] 想買的衣服「值不值得買」:櫃裡有沒有很像的、能跟現有的配出什麼。
// 全部在瀏覽器裡算,只看分類、品名和主色,不連任何服務。

import { colorLabel, colorScore, recommendOutfit } from "./recommend.js";

/* 同一分類裡再細分的款式。順序有意義:「針織 Polo 衫」算 Polo、「針織背心」算背心。
   兩件都認得出款式、款式又不同,就不算像(白 T 跟白襯衫不是同一件事)。 */
const KINDS = {
  upperbody: [
    ["襯衫", /襯衫/], ["帽T", /帽T|連帽/], ["衛衣", /衛衣|大學T/], ["背心", /背心/], ["Polo 衫", /polo/i],
    ["針織", /毛衣|針織|開襟/], ["長袖", /長袖/], ["T恤", /T恤|短袖|素T|\bT\b|五分袖/],
  ],
  lowerbody: [["短褲", /短褲/], ["裙子", /裙/], ["牛仔褲", /牛仔|丹寧/], ["西裝褲", /西裝/], ["運動褲", /運動|棉褲/], ["長褲", /褲/]],
  wholebody_up: [["球衣", /球衣/], ["西裝外套", /西裝/], ["大衣", /大衣|羽絨/], ["皮衣", /皮衣|騎士/], ["外套", /外套|夾克/]],
  shoes: [["拖鞋", /拖|涼鞋/], ["靴子", /靴/], ["球鞋", /鞋/]],
  bag: [["後背包", /後背/], ["側背包", /包/]],
};

function kindOf(item) {
  for (const [kind, pattern] of KINDS[item.part] || []) if (pattern.test(item.name || "")) return kind;
  return null;
}

/* 版型,從品名和英文標籤猜。只有衣服、褲子、外套才分;兩件都認得出又不一樣,就不算像
   (寬版牛仔褲跟直筒牛仔褲穿起來是兩回事)。「鬆緊」是褲頭、「鬆餅」是布紋,都不算寬。 */
const FITS = [
  ["寬版", /寬|oversize|落肩|廓形|垂墜|baggy|wide-leg|relaxed/i],
  ["直筒", /直筒|straight/i],
  ["合身", /合身|修身|窄|緊身|錐形|束口|slim|skinny|tapered|jogger/i],
];
const FIT_PARTS = ["upperbody", "lowerbody", "wholebody_up"];

export function fitOf(item) {
  if (!FIT_PARTS.includes(item.part)) return null;
  const text = `${item.name || ""} ${(item.tags || []).join(" ")}`;
  for (const [fit, pattern] of FITS) if (pattern.test(text)) return fit;
  return null;
}

/* sRGB → CIELAB,用 ΔE 比兩個顏色:比 RGB 直接相減更接近眼睛看到的差別。 */
function lab(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function colorGap(a, b) {
  const p = lab(a), q = lab(b);
  if (!p || !q) return Infinity;
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/* ΔE 10 以內算同色。用衣櫃實際的色票量過:白對白 2.7–7.5、黑對炭黑 5–9 要算進來;
   黑對深藍 12.6–13.6、白對米色 21.9 不算(畫面上寫的是「同色」,不能把深藍說成黑)。 */
const SIMILAR_GAP = 10;

/* 花紋:條紋、格紋跟素面不算同一件。主色再接近,條紋衣跟素色 T 恤也不是重複買(審查 F20)。
   品名沒寫花紋的當素面,所以兩件只要一件有花紋、或花紋不同,就不算像。 */
const PATTERNS = [["條紋", /條紋|直紋|橫紋|stripe|pinstripe/i], ["格紋", /格紋|格子|plaid|check|tartan|千鳥/i], ["迷彩", /迷彩|camo/i]];
function patternOf(item) {
  const text = `${item.name || ""} ${(item.tags || []).join(" ")}`;
  for (const [pattern, regex] of PATTERNS) if (regex.test(text)) return pattern;
  return null;
}

/** 櫃裡同分類、同款式、同花紋、同版型(認得出的話)、主色接近的。版型確定一樣的排前面,其次看顏色多近。 */
export function findSimilar(wish, owned) {
  const wishKind = kindOf(wish);
  const wishFit = fitOf(wish);
  const wishPattern = patternOf(wish);
  return owned
    .filter((item) => item.part === wish.part)
    .filter((item) => {
      const kind = kindOf(item);
      return !wishKind || !kind || kind === wishKind;
    })
    .filter((item) => patternOf(item) === wishPattern)
    .map((item) => ({ item, fit: fitOf(item), gap: colorGap(wish.color, item.color) }))
    .filter(({ fit }) => !wishFit || !fit || fit === wishFit)
    .filter(({ gap }) => gap <= SIMILAR_GAP)
    .sort((a, b) => Number(Boolean(wishFit) && b.fit === wishFit) - Number(Boolean(wishFit) && a.fit === wishFit) || a.gap - b.gap)
    .map(({ item }) => item);
}

/* ---------- 同一款(2026-10-08):給「併成一格」和新增時「數量 +1」用 ----------
   findSimilar 回答的是「櫃裡有沒有類似的」(提醒別重複買),標準鬆:同分類、同款式、同色就算。
   拿它來問「是不是同一款買了兩件」太鬆:本人截圖裡,黑色素 T 被叫去跟 ALONEMASTER 印花 T、
   黑色丹寧亨利領併成一格;整個衣櫃 104 件有 38 件會跳出候選、72 組配對,幾乎都是不同的衣服。
   同一款要多三個條件:
     ① 商品連結是同一件 → 直接算(手機版、電腦版網址不同也認得,見 brandLink.sameProduct)
     ② 兩邊都知道品牌、品牌又不同 → 不算
     ③ 細節要完全一樣:一件有印花、另一件沒有,就不是同一款(細節清單在下面)
     ④ 品名寫的顏色要一樣:照片抓的色碼,深藍西裝褲跟黑西裝褲差不到 10,品名寫的才準
     ⑤ 品名要夠像(兩兩字一組比,重疊一半以上):同一件第二次加,品名幾乎一樣;
        三件白 T「圓領寬版素T」「棉質寬版落肩短袖T恤」「Dickies 圓領短袖T恤」只重疊兩三成,是三件不同的 T
   加了這些,站主 104 件裡跳出候選的從 38 件降到 0 件(2026-10-08 實測);寧可漏掉,也不要叫人把兩件不同的衣服併在一起。
   漏掉的話,單品頁一樣可以自己把數量 +1、把另一張刪掉。 */
const DETAILS = [
  ["印花", /印花|圖案|graphic|print|logo|字樣|三葉草|串標|貼布|魷魚|slytherin|padres|nationals/i],
  ["刺繡", /刺繡|embroider/i],
  ["亨利領", /亨利領|henley/i],
  ["立領", /立領|高領|mock ?neck|turtle/i],
  ["V領", /V領|v-?neck/i],
  ["翻領", /翻領|扣領|collar|button-?(up|down)/i],
  ["連帽", /連帽|帽T|hood/i],
  ["拉鍊", /拉鍊|zip/i],
  ["口袋", /口袋|pocket|cargo|工裝/i],
  ["五分袖", /五分袖|half-?sleeve/i],
  ["長袖", /長袖|long-?sleeve|longsleeve/i],
  ["丹寧", /丹寧|牛仔|denim|jeans/i],
  ["水洗做舊", /水洗|做舊|刷破|破損|酸洗|washed|distressed|vintage/i],
  ["撞色", /撞色|車線|contrast/i],
  ["針織", /針織|毛衣|knit|sweater/i],
  ["尼龍", /尼龍|nylon/i],
  ["麂皮", /麂皮|suede/i],
  ["皮革", /皮革|真皮|leather/i],
  ["帆布", /帆布|canvas/i],
  ["燈芯絨", /燈芯絨|corduroy/i],
  ["斜紋", /斜紋|twill/i],
  ["鬆餅紋", /鬆餅|waffle/i],
];
function detailsOf(item) {
  const text = `${item.name || ""} ${(item.tags || []).join(" ")}`;
  return DETAILS.filter(([, regex]) => regex.test(text)).map(([name]) => name).sort().join("|");
}

// 品名去掉括號裡的品牌、空白和標點,兩兩字一組
function nameBigrams(item) {
  const text = String(item.name || "").replace(/[(（][^)）]*[)）]/g, "").replace(/[\s,.、·・\-_/]+/g, "").toLowerCase();
  const grams = new Set();
  for (let i = 0; i < text.length - 1; i += 1) grams.add(text.slice(i, i + 2));
  return grams;
}
function nameOverlap(a, b) {
  const x = nameBigrams(a), y = nameBigrams(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const gram of x) if (y.has(gram)) common += 1;
  return (2 * common) / (x.size + y.size);
}
const NAME_OVERLAP = 0.5;

/** a、b 是不是同一款(同一個商品買了兩件)。brandOf、sameProduct 從外面給,這支檔不必依賴品牌和連結的模組。 */
export function isSameStyle(a, b, { brandOf = (item) => item.brand || null, sameProduct = () => false } = {}) {
  if (!a || !b || a.part !== b.part) return false;
  if (a.sourceUrl && b.sourceUrl && sameProduct(a.sourceUrl, b.sourceUrl)) return true;
  const kindA = kindOf(a), kindB = kindOf(b);
  if (kindA && kindB && kindA !== kindB) return false;
  if (patternOf(a) !== patternOf(b)) return false;
  const fitA = fitOf(a), fitB = fitOf(b);
  if (fitA && fitB && fitA !== fitB) return false;
  if (colorGap(a.color, b.color) > SIMILAR_GAP) return false;
  const brandA = brandOf(a), brandB = brandOf(b);
  if (brandA && brandB && brandA !== brandB) return false;
  if (detailsOf(a) !== detailsOf(b)) return false;
  // 品名寫的顏色(沒寫就用色碼猜的):「深藍」跟「黑」、「米白」跟「白」都算不一樣
  if (colorLabel(a.name, a.color) !== colorLabel(b.name, b.color)) return false;
  return nameOverlap(a, b) >= NAME_OVERLAP;
}

/** 櫃裡跟這件同一款的(不含自己),顏色最近的排前面 */
export function findSameStyle(item, owned, options) {
  return owned
    .filter((other) => other.id !== item.id && isSameStyle(item, other, options))
    .sort((x, y) => colorGap(item.color, x.color) - colorGap(item.color, y.color));
}

export function kindLabel(item) {
  return kindOf(item) || { upperbody: "上衣", lowerbody: "下身", wholebody_up: "外套", shoes: "鞋", bag: "包", socks: "襪子", eyewear: "眼鏡", wrist: "錶", belt: "皮帶", necklace: "項鍊", ring: "戒指", accessories_up: "配件", carry: "小物" }[item.part] || "單品";
}

/* 自己加的衣服(想買的、按了「已經買了」的)沒有保暖度(那是離線流程替衣櫃補的),從品名猜。1 最薄、5 最厚,跟衣櫃同一把尺。 */
export function guessWarmth(item) {
  const name = item.name || "";
  switch (item.part) {
    case "wholebody_up":
      if (/羽絨|大衣|皮衣|騎士|羊毛/.test(name)) return 5;
      if (/球衣|罩衫|防風|襯衫式/.test(name)) return 2;
      return 3;
    case "upperbody":
      if (/毛衣|針織|毛絨|刷毛|法蘭絨/.test(name)) return 4;
      if (/帽T|連帽|衛衣|大學T/.test(name)) return 3;
      if (/長袖|襯衫/.test(name)) return 2;
      return 1;
    case "lowerbody":
      return /短褲|短裙/.test(name) ? 1 : 3;
    case "shoes":
      return /拖|涼鞋/.test(name) ? 1 : 2;
    default:
      return 1;
  }
}

/* 用「這件該穿的天氣」去配,不用今天的天氣:十月看一件羽絨外套,不該配出短褲。
   數字對著 recommend.js 的 targetWarmth/needOuter 挑。 */
function feelsLikeFor(piece) {
  const w = piece.warmth;
  if (piece.part === "wholebody_up") return w >= 5 ? 14 : w >= 3 ? 19 : 23;
  if (piece.part === "upperbody") return w >= 4 ? 17 : w >= 3 ? 20 : w >= 2 ? 24 : 29;
  if (piece.part === "lowerbody") return w <= 1 ? 29 : 21;
  return 22;
}

/* 主角配什麼最能看出搭不搭:上衣看下身、下身看上衣、外套看上衣、鞋看下身。 */
const PARTNER = { upperbody: "lowerbody", lowerbody: "upperbody", wholebody_up: "upperbody", shoes: "lowerbody", bag: "upperbody", socks: "shoes" };
const CORE = ["upperbody", "lowerbody", "wholebody_up", "shoes"];

/**
 * 把想買的那件鎖住,讓推薦引擎從已經有的衣服裡配,挑配色分數最高、彼此不重複的 3 套。
 * @returns {{ outfits: Object[], feelsLike: number, partner: string|null, fit: number, total: number } | { error: string }}
 */
export function wishOutfits(wish, owned, { want = 3, tries = 40 } = {}) {
  const piece = { ...wish, warmth: wish.warmth ?? guessWarmth(wish) };
  const feelsLike = feelsLikeFor(piece);
  const weather = { feelsLike, rainProb: 0 };
  const locked = ["upperbody", "lowerbody", "wholebody_up", "shoes", "bag", "socks"].includes(piece.part) ? { [piece.part]: piece } : {};

  const seen = new Map();
  for (let i = 0; i < tries; i += 1) {
    const result = recommendOutfit(owned, weather, {}, null, locked);
    if (result.error) return { error: result.error };
    const outfit = { ...result.outfit, [piece.part]: piece };
    // 看的是上衣本身,外套一罩就看不到了(引擎在 17° 會替針織衫套一件棒球球衣)
    if (piece.part === "upperbody") delete outfit.wholebody_up;
    const key = CORE.map((slot) => outfit[slot]?.id || "-").join("|");
    if (seen.has(key)) continue;
    const worn = CORE.map((slot) => outfit[slot]).filter(Boolean);
    seen.set(key, { outfit, score: colorScore(worn).score });
  }
  const outfits = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, want).map(({ outfit }) => outfit);

  // 「配色不打架」= 兩件擺一起,colorScore 不判成「顏色可能打架」
  const partner = PARTNER[piece.part] || null;
  const partners = partner ? owned.filter((item) => item.part === partner) : [];
  const fit = partners.filter((item) => colorScore([piece, item]).score > -3).length;
  return { outfits, feelsLike, partner, fit, total: partners.length };
}
