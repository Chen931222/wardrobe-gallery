// [本 fork 新增] 最愛(2026-10-06 本人要的):單品頁點星星加入,衣櫃目錄第一行有「最愛」,點了只看這些。
//
// 存一份 id 清單(open-wardrobe-favorites-v1):站主衣櫃的、自己加的、示範衣櫃的都能加,只記在這台。
// 開了同步就跟著同步(字串清單,兩台合併時取聯集、某一台拿掉的才算拿掉)。
// 先不影響推薦:每次都替某幾件加分,推薦就會一直推那幾件(taste.js 量過,+0.3 分就從 1% 變 30%)。
export const FAVORITES_KEY = "open-wardrobe-favorites-v1";

export function readFavorites() {
  try {
    const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return new Set(Array.isArray(value) ? value.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

/** 加入或拿掉,回傳新的那份。 */
export function toggleFavorite(id) {
  const next = readFavorites();
  if (next.has(id)) next.delete(id); else next.add(id);
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next])); } catch { /* 存不了就只在這次的畫面上 */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("wardrobe-local-change"));   // 開了同步,5 秒後推
  return next;
}
