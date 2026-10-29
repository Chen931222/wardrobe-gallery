// [本 fork 新增] 從儲存讀進來的衣服、編輯紀錄,先整理成畫面和推薦認得的型別。
//
// 備份檔、同步、別台的舊版、手動改瀏覽器資料,都可能帶進「JSON 合法、型別不對」的值(2026-10-26 破壞測試:
// tags 是數字、name 是物件、分類寫 hat)。它們穿過讀取時包 JSON.parse 的 try/catch,到畫面上才炸,
// 整頁變白,重新整理還是白,連再匯一次好的備份都進不去。
// 原則:型別不對的那一欄拿掉(用原本的值或預設),不是整件丟掉;分類不認得的當上衣、標成猜的,到衣櫃點開就能改。
import { PARTS } from "./parts.js";

export const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const asText = (value) => (typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : undefined);
const asNumber = (value) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const orNull = (clean) => (value) => (value === null ? null : clean(value));
// 不用 Object.hasOwn:iOS 15.4 以前的 Safari 沒有
export const isPart = (part) => typeof part === "string" && Object.prototype.hasOwnProperty.call(PARTS, part);

// 每一欄怎麼整理;回 undefined = 這一欄拿掉。null 是「刻意清空」(編輯紀錄會存),照留
const FIELDS = {
  name: asText,
  part: asText,   // 認不認得的分類,由 cleanItem(衣服本身)和 App 的 withEdits(套用編輯時)決定;編輯紀錄裡不刪,免得新分類被舊版刪掉
  color: orNull(asText),
  secondaryColor: orNull(asText),
  tags: (value) => (Array.isArray(value) ? value.map(asText).filter((tag) => tag !== undefined) : undefined),
  price: orNull(asNumber),
  priceCurrency: orNull(asText),
  quantity: asNumber,
  brand: orNull(asText),
  note: orNull(asText),
  sourceUrl: (value) => (typeof value === "string" && /^https?:\/\//i.test(value) ? value : null),   // 會放進 <a href>:只收 http(s),跟 cleanUrl 一樣
  warmth: asNumber,
  trashedAt: orNull(asText),
  wishlist: Boolean,
  dream: Boolean,
  partGuessed: Boolean,
  standIn: Boolean,
};

function cleanFields(record) {
  const out = { ...record };
  for (const [field, clean] of Object.entries(FIELDS)) {
    if (!(field in out)) continue;
    const value = clean(out[field]);
    if (value === undefined) delete out[field];
    else out[field] = value;
  }
  return out;
}

/** 一件衣服:名稱一定是字;分類不認得的當上衣、標成猜的 */
export function cleanItem(record) {
  const out = cleanFields(record);
  if (out.name === undefined) out.name = "";
  if (!isPart(out.part)) {
    out.part = "upperbody";
    out.partGuessed = true;
  }
  return out;
}

/** 編輯紀錄 { 衣服 id: 改過的欄位 }:不是物件的那筆拿掉;欄位型別不對的那一欄拿掉,畫面用回原本的值。
 *  分類只檢查是不是字,不認得的留著(App 套用時略過) */
export function cleanEdits(value) {
  if (!isObject(value)) return {};
  const out = {};
  for (const [id, patch] of Object.entries(value)) if (isObject(patch)) out[id] = cleanFields(patch);
  return out;
}
