// [本 fork 新增] 推薦從自己的選擇學:穿過、收藏過的組合加分,說過「不好看」的組合扣分;順便量推薦準不準。
//
// 2026-10-06 本人要的。之前每次改推薦,都是拿我們自己定的規則打分數(「怪搭配 0 次」只代表沒違反規則,
// 不代表會想穿),沒有一個數字說得出推薦到底準不準。現在記兩份,都只在裝置裡、不上傳伺服器:
//   open-wardrobe-taste-v1      會同步(兩台合在一起算):
//     { id: "wear-<時間>", t: "wear", day, ids, rec: { seen, match } }  按「今天穿這套」;一天只留最後一套
//       rec.seen = 今天看了幾套推薦,rec.match = 穿的是第幾套(不是照推薦穿的 = null),rec.recalled = 那套是回味舊組合
//     { id: "dislike-<時間>", t: "dislike", removed, kept }              「褲子不好看」:嫌的那件 × 身上其他幾件
//   open-wardrobe-reco-today-v1 只在這台:今天看過的推薦。每按一次「再推薦」都會變,同步它只會燒寫入額度
// 收藏的穿搭(open-wardrobe-looks-v1)本來就有,直接拿來當「喜歡」。不用 AI、不花錢,照樣是規則加減分,
// 只是分數來自自己的紀錄。

const TASTE_KEY = "open-wardrobe-taste-v1";
const TODAY_KEY = "open-wardrobe-reco-today-v1";
const LOOKS_KEY = "open-wardrobe-looks-v1";
const LIMIT = 300;
const CORE = ["upperbody", "lowerbody", "wholebody_up", "shoes"];

const today = () => new Date().toLocaleDateString("sv");
function readList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
function writeList(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* 存不了就這次不記 */ }
}
const notify = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event("wardrobe-local-change")); };   // 開了同步的話 5 秒後推
/** 一套的核心(上衣、下身、外套、鞋)排好的 id:拿來比「穿的是不是推薦的那套」。配件、襪子、包不算,換了也還是同一套。 */
const coreIds = (outfit) => CORE.map((slot) => outfit?.[slot]?.id).filter(Boolean).sort();
const sameSet = (a, b) => a.length === b.length && a.every((id, index) => id === b[index]);

/** 畫面上出現了一套推薦(今日推薦、再推薦、照這句挑、換一件、入口的「穿上看看」)。
 *  recalled = 這套是回味穿過、收藏過的組合;記下來,之後分得出「推舊的」和「推新的」各被接受幾次 */
export function noteRecommendation(outfit, recalled = false) {
  const ids = coreIds(outfit);
  if (ids.length < 2) return;
  const day = today();
  const list = readList(TODAY_KEY).filter((entry) => entry.day === day);
  if (list.length && sameSet(list[list.length - 1].ids, ids)) return;   // 同一套連著出現只算一次
  list.push({ day, ids, ...(recalled ? { recalled: true } : {}) });
  writeList(TODAY_KEY, list.slice(-60));
}

/** 按「今天穿這套」。回傳這筆的 id,取消時用。 */
export function noteWear(outfit) {
  const ids = coreIds(outfit);
  const day = today();
  const recs = readList(TODAY_KEY).filter((entry) => entry.day === day);
  const hit = recs.findIndex((entry) => sameSet(entry.ids, ids));
  const all = Object.values(outfit || {}).filter(Boolean).map((item) => item.id);
  const rec = { seen: recs.length, match: hit < 0 ? null : hit + 1, ...(recs[hit]?.recalled ? { recalled: true } : {}) };
  const entry = { id: `wear-${Date.now()}`, t: "wear", day, ids: [...new Set(all)], rec };
  // 同一天改穿別套:換掉當天那筆,一天只算一次
  writeList(TASTE_KEY, [entry, ...readList(TASTE_KEY).filter((old) => !(old.t === "wear" && old.day === day))].slice(0, LIMIT));
  notify();
  return entry.id;
}

/** 取消剛剛那下「今天穿這套」。 */
export function unnoteWear(id) {
  if (!id) return;
  writeList(TASTE_KEY, readList(TASTE_KEY).filter((entry) => entry.id !== id));
  notify();
}

/** 「褲子不好看」:這件跟身上其他幾件的組合扣分(不是這件本身不好)。 */
export function noteDislike(removedId, keptIds) {
  const kept = [...new Set(keptIds)].filter((id) => id && id !== removedId);
  if (!removedId || !kept.length) return;
  writeList(TASTE_KEY, [{ id: `dislike-${Date.now()}`, t: "dislike", removed: removedId, kept }, ...readList(TASTE_KEY)].slice(0, LIMIT));
  notify();
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** 讀成「兩件一起的分數」:穿過、收藏過一次 +1,說過不好看一次 -2。給 recommendOutfit 的 taste 參數。 */
export function readTaste() {
  const pairs = new Map();
  const add = (ids, weight) => {
    const list = [...new Set(ids || [])].filter(Boolean);
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const key = pairKey(list[i], list[j]);
        pairs.set(key, (pairs.get(key) || 0) + weight);
      }
    }
  };
  for (const entry of readList(TASTE_KEY)) {
    if (entry?.t === "wear") add(entry.ids, 1);
    else if (entry?.t === "dislike") for (const id of entry.kept || []) add([entry.removed, id], -2);
  }
  for (const look of readList(LOOKS_KEY)) add(look?.itemIds, 1);
  return pairs;
}

/** 兩件一起的分數:每次 ±0.5,上限 +1.5、下限 -2.5。recommendOutfit 只拿正負號決定要不要回味(見那邊的註解),
 *  負的照扣:說一次不好看 -1、兩次 -2。 */
export function pairScore(taste, a, b) {
  if (!taste?.size || !a?.id || !b?.id) return 0;
  const value = taste.get(pairKey(a.id, b.id)) || 0;
  return Math.max(-2.5, Math.min(1.5, value * 0.5));
}

/**
 * 推薦準不準(近 days 天,有按「今天穿這套」的那幾天)。
 * @returns { days, fromRec, first, avgMatch } 或 null(還沒記過)
 *   fromRec = 照推薦穿的天數;first = 第一套就穿;avgMatch = 照推薦穿的那幾天,平均看到第幾套
 */
export function recoStats(days = 30) {
  const since = new Date(Date.now() - days * 864e5).toLocaleDateString("sv");
  // 兩台同一天各按了「今天穿這套」,同步合起來會有兩筆:一天只算最後按的那筆
  const byDay = new Map();
  for (const entry of readList(TASTE_KEY)) {
    if (entry?.t !== "wear" || !entry.rec || !(entry.day >= since)) continue;
    const kept = byDay.get(entry.day);
    if (!kept || String(entry.id) > String(kept.id)) byDay.set(entry.day, entry);
  }
  const wears = [...byDay.values()];
  if (!wears.length) return null;
  const fromRec = wears.filter((entry) => entry.rec.match);
  return {
    days: wears.length,
    fromRec: fromRec.length,
    first: fromRec.filter((entry) => entry.rec.match === 1).length,
    avgMatch: fromRec.length ? fromRec.reduce((sum, entry) => sum + entry.rec.match, 0) / fromRec.length : null,
  };
}
