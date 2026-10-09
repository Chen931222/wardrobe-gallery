// [本 fork 修改] 上游 tandpfun/wardrobe 既有檔案。本 fork 的改動:介面全繁中化並擴充分類,新增入口環/衣櫃/搭配三頁切換、IndexedDB 本機衣物合併與格子刪除鈕。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, CaretDown, Check, MagnifyingGlass, Plus, Sparkle, Star, Trash, X } from "@phosphor-icons/react";
import { OptimizedImage } from "./OptimizedImage.jsx";
import { OutfitStudio, rememberWearing } from "./OutfitStudio.jsx";
import { LandingRing } from "./LandingRing.jsx";
import { AddGarment } from "./AddGarment.jsx";
import { SyncPanel } from "./SyncPanel.jsx";
import { deleteLocalItem, findUrl, loadLocalItems, productUrlProblem, putLocalRecord, updateLocalItem } from "./localWardrobe.js";
import { CAN_ADD, CAN_EDIT, canEditItem } from "./ownerMode.js";
import { hasLocalChanges, lastSyncError, noteDeliberateDelete, scheduleSync, syncCode, syncNotice, syncNow } from "./sync.js";
import { findSameStyle, findSimilar, fitOf, guessWarmth, kindLabel, wishOutfits } from "./wishCheck.js";
import { colorLabel, colorName, colorRole, colorScore, isNeutral } from "./recommend.js";
import { useDialog } from "./useDialog.js";
import { ScrollRail } from "./ScrollRail.jsx";
import { fetchPriceForUrl, sameProduct } from "./brandLink.js";
import { CURRENCIES, formatPrice, parsePrice } from "./price.js";
import { downloadBackupZip, importBackupFile } from "./backup.js";
import { backupReminder, inAppBrowser, isIos, isStandalone, requestPersist, snoozeBackupHint } from "./keepSafe.js";
import { Welcome } from "./Welcome.jsx";
import { UpdatesSheet } from "./Updates.jsx";
import { useIndexIndicator } from "./useIndexIndicator.js";
import { hasUnseenUpdates } from "./updates.js";
import { demoCloset } from "./demoCloset.js";
import { PART_GROUPS, PART_ORDER, PARTS } from "./parts.js";
import { FAVORITES_KEY, readFavorites, toggleFavorite } from "./favorites.js";
import { useFullImage } from "./useFullImage.js";
import { brandOf, brandSuggestions, canonicalBrand } from "./brands.js";
import { partFromName } from "./brandLink.js";
import { noteRecommendation } from "./taste.js";

const STORAGE_KEY = "open-wardrobe-edits-v1";
const DELETED_STORAGE_KEY = "open-wardrobe-deleted-v1";

// 由上到下、由主到次排列,和穿搭頁的槽位順序一致
// 分類只有 src/parts.js 一份(2026-10-06 加了皮帶、項鍊、戒指、隨身小物)
const TYPES = [
  { id: "all", label: "全部" },
  ...PART_ORDER.map((id) => ({ id, label: PARTS[id].label, singular: PARTS[id].singular })),
];

const TYPE_MAP = Object.fromEntries(TYPES.map((type) => [type.id, type]));

/* 衣櫃標籤是離線流程用英文關鍵字寫的,給人看的唯讀頁換成中文(審查 F50)。品牌照原文。
   對不到的照原樣顯示:可能是站主自己打的。 */
const TAG_ZH = {
  "acid-wash": "酸洗", backpack: "後背包", baggy: "寬版", baseball: "棒球", baselayer: "內搭", belted: "附腰帶", biker: "騎士",
  black: "黑色", blazer: "西裝外套", blouson: "短夾克", burgundy: "酒紅", "button-up": "排扣", camo: "迷彩", canvas: "帆布",
  cardigan: "開襟", cargo: "工裝", "cargo-pants": "工裝褲", casual: "休閒", cat: "貓", charcoal: "炭灰", chino: "卡其褲",
  chore: "工作外套", chunky: "厚底", "city-connect": "城市版", coach: "教練外套", "contrast-stitch": "對比車線", corduroy: "燈芯絨",
  cotton: "棉", "cotton-fleece": "刷毛棉", court: "球場鞋", cream: "奶油色", creased: "壓線", crescent: "半月", crew: "圓領",
  crewneck: "圓領", crossbody: "斜背", "dark-gray": "深灰", denim: "丹寧", distressed: "破損", drapey: "垂墜", drawstring: "抽繩",
  "dress-pants": "西裝褲", "elastic-waist": "鬆緊腰", embroidered: "刺繡", "embroidered-logo": "刺繡標誌", field: "野戰",
  "five-pocket": "五口袋", flannel: "法蘭絨", fleece: "刷毛", graphic: "印花", "graphic print": "印花", grey: "灰色",
  halfzip: "半拉鍊", "harry-potter": "哈利波特", heather: "麻花", "heather-gray": "麻灰", heavyweight: "厚磅", henley: "亨利領",
  hightop: "高筒", hoodie: "帽T", jacket: "夾克", jeans: "牛仔褲", jersey: "球衣", jogger: "束口褲", knit: "針織", laptop: "筆電包",
  layered: "疊穿", leather: "皮革", "light-wash": "淺色水洗", lightweight: "輕薄", longsleeve: "長袖", loungewear: "居家服",
  mesh: "網布", mockneck: "半高領", nationals: "國民隊", navy: "深藍", nylon: "尼龍", olive: "橄欖綠", "open-collar": "開領",
  oversized: "寬版", oxford: "牛津布", padres: "教士隊", pants: "長褲", parachute: "降落傘褲", patch: "布章", pinstripe: "細條紋",
  pleated: "打褶", "pocket-tee": "口袋 T", polo: "Polo 衫", "polo-rl": "Polo Ralph Lauren", preppy: "學院風", red: "紅色",
  "relaxed-fit": "寬鬆", retro: "復古", ribbed: "羅紋", running: "慢跑", sandals: "涼鞋", shirt: "襯衫", "shirt-jacket": "襯衫外套",
  "short sleeve": "短袖", shorts: "短褲", shortsleeve: "短袖", "shoulder bag": "肩背包", signature: "經典款", skater: "滑板",
  sleeveless: "無袖", slides: "拖鞋", sling: "斜背", "smart-casual": "休閒正式", sneakers: "球鞋", socks: "襪子", sport: "運動",
  "straight-leg": "直筒", streetwear: "街頭", striped: "條紋", suede: "麂皮", "sweat-shorts": "棉短褲", sweater: "毛衣",
  sweatpants: "棉褲", sweatshirt: "大學T", tank: "背心", tee: "T 恤", techwear: "機能風", textured: "紋理", tods: "TOD'S", trousers: "長褲",
  twill: "斜紋布", vest: "背心", vintage: "古著", vneck: "V 領", waffle: "鬆餅格", "waist bag": "腰包", washed: "水洗",
  "washed-black": "水洗黑", "wide-leg": "寬褲", windbreaker: "防風外套", wool: "羊毛", workwear: "工裝", zip: "拉鍊",
  "zip-off": "可拆褲管", "zip-pocket": "拉鍊口袋",
  adidas: "adidas", nike: "Nike", mlb: "MLB", dickies: "Dickies", gu: "GU", lacoste: "Lacoste", "new balance": "New Balance",
  samsonite: "Samsonite", timberland: "Timberland", "under armour": "Under Armour",
};
const tagLabel = (tag) => TAG_ZH[String(tag).toLowerCase()] || tag;

/* 衣櫃搜尋(2026-10-08 本人:「可以增加搜尋欄?用關鍵字」)。
   範圍是整個衣櫃(含想買的),不管目錄停在哪一類:停在「上衣」搜「褲」什麼都沒有,會以為壞了。
   比對品名、品牌、分類、款式、版型、顏色(品名寫的和色碼猜的)、標籤(英文和中文)。空格隔開的每個詞都要對到:「黑 短褲」。 */
const SEARCH_PART_WORDS = { upperbody: "衣服 上身", wholebody_up: "夾克", lowerbody: "褲子 褲 裙子", shoes: "鞋", socks: "襪", bag: "包包 包" };
// 標籤裡跟品牌同名的不算(COACH 包的標籤 coach 會被翻成「教練外套」,搜「外套」就冒出一個包)
const tagsBesidesBrand = (item) => {
  const brand = (brandOf(item) || "").toLowerCase();
  return (item.tags || []).filter((tag) => String(tag).toLowerCase() !== brand);
};
function searchTextOf(item) {
  const part = PARTS[item.part] || {};
  return [
    item.name, brandOf(item), part.label, part.singular, part.short, SEARCH_PART_WORDS[item.part], kindLabel(item), fitOf(item),
    // 顏色只用品名寫的(沒寫才用色碼猜):色碼常猜錯,軍綠短褲被猜成黑色,搜「黑」就會冒出來
    colorLabel(item.name, item.color),
    ...tagsBesidesBrand(item), ...tagsBesidesBrand(item).map(tagLabel),
    item.wishlist ? (item.dream ? "夢幻逸品 夢幻 逸品 夢想 還沒買" : "想買 還沒買") : "", item.note,
  ].filter(Boolean).join(" ").toLowerCase();
}
const searchTermsOf = (query) => query.trim().toLowerCase().split(/\s+/).filter(Boolean);
// 英文、數字從單字開頭比(「gu」不會比到 burgundy、「nike」比得到「nike」),中文照字串比
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 一件衣服對不對得上這段搜尋字(空的算對得上)。衣櫃搜尋和搭配頁衣架的搜尋共用 */
function itemMatchesQuery(item, query) {
  const terms = searchTermsOf(query);
  if (!terms.length) return true;
  const text = searchTextOf(item);
  return terms.every((term) => termMatches(text, term));
}
function termMatches(text, term) {
  if (/^[a-z0-9]/.test(term)) return new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}`).test(text);
  return text.includes(term);
}

/* 站主那批衣服從哪裡來(2026-10-05 起完整衣櫃不再公開):
   訪客、?public 讀公開的 /data/wardrobe.json,只有示範的 20 件(src/demoCloset.js,人工挑過、品名去掉品牌)。
   擁有者模式讀 /api/closet,線上要帶開通過的同步碼;還沒輸入、或碼已經換掉 → 先給示範衣櫃,畫面上請他去輸入同步碼。
   網路斷、伺服器錯 → 丟錯,refresh 沿用上一份,不讓衣服從畫面上消失。
   完整的那份一次瀏覽只抓一次:它只在重新部署時才會變,同步事件一來就重抓只是白打 function。 */
let ownerCloset = null;   // 抓完整衣櫃的那一次(Promise);同時發的幾次 refresh 共用,抓到了這次瀏覽就不再抓
let ownerClosetDone = false;   // 這次瀏覽已經抓到了(之後直接用,不再先給存著的那份)
function fetchOwnerCloset() {
  if (!ownerCloset) {
    const code = syncCode();
    ownerClosetDone = false;
    ownerCloset = fetch("/api/closet", { cache: "no-store", headers: code ? { "x-sync-code": code } : {} }).then(async (response) => {
      if (response.ok) return { list: await response.json(), locked: false };
      await response.text().catch(() => "");   // 沒用到的回應也要讀完,不然那條連線一直掛著(只取消不算數)
      if ([400, 401, 403, 404].includes(response.status)) return { list: null, locked: true };
      throw new Error("衣櫃載入失敗。");
    });
    // 沒拿到的(還沒輸入同步碼、網路斷)不記住:輸入碼之後、網路回來的下一次 refresh 再抓
    ownerCloset.then((result) => { if (result.locked) ownerCloset = null; else ownerClosetDone = true; }, () => { ownerCloset = null; });
  }
  return ownerCloset;
}

/* 站主的衣櫃先給上次那份(2026-10-06 本人回報「載入有點慢」):/api/closet 是 Vercel function,
   實測熱的 0.35 秒、冷啟動 1.2 秒,舊版每次打開都等它回來才畫得出衣櫃。那份只在重新部署時才變,
   所以存一份在這台:打開先畫存著的,背景照樣抓最新的,不一樣才重讀一次(發 wardrobe-closet-updated)。
   只存在有同步碼的這台;碼沒了、或伺服器說碼不對(locked),存的那份馬上丟掉。不進備份(backup.js 的 DEVICE_ONLY)。 */
const CLOSET_CACHE_KEY = "open-wardrobe-closet-cache-v1";
const readClosetCache = () => {
  try { const list = JSON.parse(localStorage.getItem(CLOSET_CACHE_KEY) || "null"); return Array.isArray(list) ? list : null; } catch { return null; }
};
const writeClosetCache = (list) => {
  try {
    const text = JSON.stringify(list);
    if (localStorage.getItem(CLOSET_CACHE_KEY) === text) return false;
    localStorage.setItem(CLOSET_CACHE_KEY, text);
    return true;
  } catch { return false; }   // 私密瀏覽、空間滿:不存就是每次等網路,跟舊版一樣
};
const clearClosetCache = () => { try { localStorage.removeItem(CLOSET_CACHE_KEY); } catch { /* 私密瀏覽 */ } };
let watchingFresh = null;   // 正在等哪一次抓取回來比對(同時幾次 refresh 只比一次)
function watchFreshCloset(pending) {
  if (watchingFresh === pending) return;
  watchingFresh = pending;
  pending.then((result) => {
    const changed = result.locked ? (clearClosetCache(), true) : writeClosetCache(result.list);
    if (changed) window.dispatchEvent(new Event("wardrobe-closet-updated"));
  }, () => {});   // 網路斷:畫面上那份照用,下次打開再抓
}

async function loadServed() {
  const demo = async () => {
    const response = await fetch("/data/wardrobe.json", { cache: "no-store" });
    if (!response.ok) throw new Error("衣櫃載入失敗。");
    return demoCloset(await response.json());
  };
  if (!CAN_EDIT) return { list: await demo(), locked: false };
  const code = syncCode();
  if (!code) clearClosetCache();
  const pending = fetchOwnerCloset();
  const cached = !ownerClosetDone && code ? readClosetCache() : null;
  if (cached) {
    watchFreshCloset(pending);
    return { list: cached, locked: false };
  }
  const result = await pending;
  if (result.locked || !code) clearClosetCache(); else writeClosetCache(result.list);
  return result.locked ? { list: await demo(), locked: true } : result;
}
const TYPE_ORDER = Object.fromEntries(TYPES.slice(1).map((type, index) => [type.id, index]));


function readEdits() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}


// quantity(2026-10-06 本人要的:同一款買了兩件,不想佔兩格):數量,沒寫就是 1
// brand(2026-10-07):品牌,沒寫就看品名、標籤、網址猜(brands.js);存成空白 = 刻意不寫
// note(2026-10-08 本人要的備註欄):自己寫給自己看的,公開的單品頁不顯示。跟其他欄位一樣逐欄記、逐欄同步
const EDIT_FIELDS = ["name", "part", "color", "secondaryColor", "tags", "price", "priceCurrency", "quantity", "brand", "note"];
const qtyOf = (value) => Math.min(99, Math.max(1, Math.floor(Number(value)) || 1));
const editValue = (item, field) => {
  const value = item?.[field];
  if (field === "tags") return value || [];
  if (field === "name") return value || "";
  if (field === "note") return String(value || "").trim();
  if (field === "quantity") return qtyOf(value);
  return value ?? null;
};

/** 只記跟原本(建檔時、還沒任何編輯)不一樣的欄位。整筆寫入的話,兩台各改一欄時同步分不出誰改了哪一欄,
 *  後存的那台會把另一台的修改整件蓋掉(2026-10-03)。改回原值的欄位就拿掉,沒有改過的整件就刪掉。 */
function persistEdit(item, original) {
  const edits = readEdits();
  const entry = {};
  for (const field of EDIT_FIELDS) {
    const value = editValue(item, field);
    if (!original || JSON.stringify(value) !== JSON.stringify(editValue(original, field))) entry[field] = value;
  }
  if (Object.keys(entry).length) edits[item.id] = entry;
  else delete edits[item.id];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("wardrobe-local-change"));   // 開了同步的話,5 秒後推上去
}

function removePersistedEdit(id) {
  const edits = readEdits();
  delete edits[id];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("wardrobe-local-change"));
}

function readDeletedItems() {
  try {
    const value = JSON.parse(localStorage.getItem(DELETED_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}

/** 垃圾桶的「復原」:站主衣櫃那件從隱藏名單拿掉。 */
function unpersistDeletedItem(id) {
  const deleted = readDeletedItems();
  if (!deleted.delete(id)) return;
  localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify([...deleted]));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("wardrobe-local-change"));
}
const IS_LOCALHOST = typeof window !== "undefined" && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
const TRASH_DAYS = 30;

function persistDeletedItem(id) {
  const deleted = readDeletedItems();
  deleted.add(id);
  localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify([...deleted]));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("wardrobe-local-change"));
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;
}

function colorDistance(first, second) {
  return Math.sqrt(
    ((first.red - second.red) ** 2)
    + ((first.green - second.green) ** 2)
    + ((first.blue - second.blue) ** 2),
  );
}

function extractPalette(image) {
  const canvas = document.createElement("canvas");
  canvas.width = 72;
  canvas.height = 72;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const buckets = new Map();

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 72) continue;

    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const key = `${Math.round(red / 28)}-${Math.round(green / 28)}-${Math.round(blue / 28)}`;
    const current = buckets.get(key) || { red: 0, green: 0, blue: 0, count: 0 };
    current.red += red;
    current.green += green;
    current.blue += blue;
    current.count += 1;
    buckets.set(key, current);
  }

  const ranked = [...buckets.values()]
    .map((bucket) => ({
      red: Math.round(bucket.red / bucket.count),
      green: Math.round(bucket.green / bucket.count),
      blue: Math.round(bucket.blue / bucket.count),
      count: bucket.count,
    }))
    .sort((a, b) => b.count - a.count);

  const selected = [];
  for (const color of ranked) {
    if (selected.every((existing) => colorDistance(existing, color) > 38)) selected.push(color);
    if (selected.length === 5) break;
  }

  return selected.map((color) => rgbToHex(color.red, color.green, color.blue));
}

function buildSamplingCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0);
  return canvas;
}

function sampleImageColor(image, canvas, event) {
  const bounds = image.getBoundingClientRect();
  const scale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
  const renderedWidth = image.naturalWidth * scale;
  const renderedHeight = image.naturalHeight * scale;
  const offsetX = (bounds.width - renderedWidth) / 2;
  const offsetY = (bounds.height - renderedHeight) / 2;
  const imageX = Math.floor((event.clientX - bounds.left - offsetX) / scale);
  const imageY = Math.floor((event.clientY - bounds.top - offsetY) / scale);

  if (imageX < 0 || imageY < 0 || imageX >= canvas.width || imageY >= canvas.height) return null;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  for (let radius = 0; radius <= 18; radius += 2) {
    const startX = Math.max(0, imageX - radius);
    const startY = Math.max(0, imageY - radius);
    const width = Math.min(canvas.width - startX, (radius * 2) + 1);
    const height = Math.min(canvas.height - startY, (radius * 2) + 1);
    const data = context.getImageData(startX, startY, width, height).data;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] > 96) return rgbToHex(data[index], data[index + 1], data[index + 2]);
    }
  }

  return null;
}

/* picking:挑選模式(2026-10-09,想買的 ↔ 夢幻逸品一次搬幾件)。挑選時點格子是勾選、不開單品頁,刪除鈕藏起來免得誤刪 */
function GalleryItem({ item, selected, onOpen, onDelete, favorite = false, picking = false, picked = false, onPick = null }) {
  const type = TYPE_MAP[item.part]?.singular || "衣物";
  const label = item.name || type;
  const pickable = picking && onPick && canEditItem(item);

  return (
    <div className={`gallery-cell${selected ? " selected" : ""}${pickable ? " is-picking" : ""}${picked ? " is-picked" : ""}`}>
      <button
        className="gallery-item"
        type="button"
        onClick={() => (pickable ? onPick(item.id) : onOpen(item.id))}
        aria-label={pickable
          ? `${picked ? "取消勾選" : "勾選"}${label}`
          : `查看${label}${qtyOf(item.quantity) > 1 ? `(${qtyOf(item.quantity)} 件)` : ""}${item.wishlist ? (item.dream ? "(夢幻逸品)" : "(還沒買)") : ""}${favorite ? "(最愛)" : ""}`}
        aria-pressed={pickable ? picked : selected}
        data-testid={`wardrobe-item-${item.id}`}
      >
        <OptimizedImage
          src={item.thumbnail || item.image}
          alt=""
          sizes="(max-width: 520px) calc(50vw - 16px), (max-width: 860px) calc(33vw - 18px), 260px"
          breakpoints={[120, 180, 240, 320, 480]}
        />
        {item.wishlist && <span className={item.dream ? "wish-badge is-dream" : "wish-badge"}>{item.dream ? "夢幻逸品" : "想買"}</span>}
        {favorite && <span className="fav-mark" aria-hidden="true"><Star size={13} weight="fill" /></span>}
        {pickable && <span className="pick-mark" aria-hidden="true">{picked && <Check size={14} weight="bold" />}</span>}
        {qtyOf(item.quantity) > 1 && <span className="qty-badge" aria-hidden="true">×{qtyOf(item.quantity)}</span>}
      </button>
      {/* 品名一行:只靠圖分不出「灰褐運動長褲」和「灰色打褶西裝褲」(2026-07 本人回報)。按鈕的 aria-label 已經念過品名 */}
      <span className="gallery-name" aria-hidden="true" title={label}>{label}</span>
      {Boolean(item.price) && <span className="gallery-price">{formatPrice(item.price, item.priceCurrency)}</span>}
      {canEditItem(item) && !pickable && (
        <button
          className="gallery-delete"
          type="button"
          onClick={() => onDelete(item.id)}
          aria-label={`刪除${label}`}
        >
          <Trash size={14} weight="regular" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/* 衣櫃目錄(2026-10-06 本人選的)。舊版是一長排橫向捲動的分類:iPhone 上只看得到 5–7 顆,
   「想買的」「垃圾桶」排在最後面最難找,再加皮帶、戒指就更長。改成像書的目錄:每組一行、每類標件數,
   一眼看完不用滑;沒有衣服的分類不列(正在看的那類除外),想加的時候新增的選單裡都有。 */
/* 收起來(2026-10-06 本人要的:目錄展開時手機上第一件衣服往下推了約 135px)。收起時只留第一行;
   正在看的那一類也留在第一行(「全部 / 皮帶 6」),看得出現在篩的是什麼。記在這台(open-wardrobe-index-open-v1),
   第一次預設展開:新朋友要先看得到有哪些分類。 */
const INDEX_OPEN_KEY = "open-wardrobe-index-open-v1";
function readIndexOpen() {
  try { return localStorage.getItem(INDEX_OPEN_KEY) !== "0"; } catch { return true; }
}

const BRAND_PREFIX = "brand:";
const brandFilterOf = (activeType) => (activeType.startsWith(BRAND_PREFIX) ? activeType.slice(BRAND_PREFIX.length) : null);
const BRANDS_SHOWN = 10;   // 品牌多的話先列件數最多的幾個,其他按「其他 N 個」

/** 衣櫃搜尋欄。count = 搜尋中找到幾件;沒在搜尋給 null。桌機按「/」直接跳進來,Esc 清掉 */
function ClosetSearch({ query, onChange, count }) {
  const inputRef = useRef(null);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (document.querySelector('[aria-modal="true"]')) return;   // 對話框開著不搶
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="closet-search-wrap">
      <div className="closet-search" role="search">
        <MagnifyingGlass size={16} weight="regular" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Escape" && query) { event.stopPropagation(); onChange(""); } }}
          placeholder="搜尋品名、品牌、顏色,例如「黑 短褲」"
          aria-label="搜尋衣櫃"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
        />
        {query && <button type="button" onClick={() => { onChange(""); inputRef.current?.focus(); }}>清除</button>}
      </div>
      {count !== null && <p className="closet-search-status" aria-live="polite">整個衣櫃找到 {count} 件</p>}
    </div>
  );
}

function ClosetIndex({ activeType, onChoose, counts, total, favCount = 0, wishCount, dreamCount = 0, trashCount, brands = { list: [], none: 0 } }) {
  const [open, setOpen] = useState(readIndexOpen);
  const [allBrands, setAllBrands] = useState(false);
  const navRef = useRef(null);
  const lineRef = useRef(null);
  useIndexIndicator(navRef, lineRef, [activeType, open, allBrands, counts, brands, favCount, wishCount, dreamCount, trashCount]);
  /* 點了下面幾行的分類、品牌:選好就收起來,變成「全部 / 包款」(2026-10-08 本人:不要再多點一次才收)。
     用鍵盤選的,焦點原本在要收起來(inert)的那幾行裡,會掉到 body;收好後移到第一行的「/ 包款」 */
  const refocusRef = useRef(false);
  const chooseAndFold = (id) => {
    onChoose(id);
    if (!open) return;
    refocusRef.current = Boolean(navRef.current?.querySelector(".closet-index-rows")?.contains(document.activeElement));
    setOpen(false);
    try { localStorage.setItem(INDEX_OPEN_KEY, "0"); } catch { /* 只記這次 */ }
  };
  useEffect(() => {
    if (open || !refocusRef.current) return;
    refocusRef.current = false;
    navRef.current?.querySelector(".closet-index-top button.active:not(.closet-index-toggle)")?.focus({ preventScroll: true });
  }, [open]);
  const toggle = () => {
    setOpen((was) => {
      try { localStorage.setItem(INDEX_OPEN_KEY, was ? "0" : "1"); } catch { /* 只記這次 */ }
      return !was;
    });
  };
  const entry = (id, label, count, fold = false) => (
    <button key={id} type="button" className={activeType === id ? "active" : ""} aria-pressed={activeType === id} onClick={() => (fold ? chooseAndFold(id) : onChoose(id))}>
      <span className="closet-index-label">{label}</span><span className="closet-index-count">{count}</span>
    </button>
  );
  const activePart = PARTS[activeType] ? activeType : null;
  // 品牌(2026-10-07):目錄最下面一行,像書的索引。件數多的排前面;正在看的那個一定列出來
  const activeBrand = brandFilterOf(activeType);
  const shownBrands = allBrands ? brands.list : brands.list.filter((brand, index) => index < BRANDS_SHOWN || brand.name === activeBrand);
  const hiddenBrands = brands.list.length - shownBrands.length;
  const folded = activePart
    ? { id: activePart, label: PARTS[activePart].short || PARTS[activePart].label, count: counts[activePart] || 0 }
    : activeBrand !== null
      ? { id: activeType, label: activeBrand || "沒寫品牌", count: activeBrand ? brands.list.find((brand) => brand.name === activeBrand)?.count || 0 : brands.none }
      : null;
  return (
    <nav ref={navRef} className={open ? "closet-index" : "closet-index is-folded"} aria-label="衣櫃目錄">
      <span ref={lineRef} className="closet-index-indicator" aria-hidden="true" />
      <div className="closet-index-top">
        {/* 收合鈕貼在「全部」後面(2026-10-06 本人:不要一顆獨立在右邊)。「全部」已經選中時,點它也是展開／收起 */}
        <span className="closet-index-current">
          <button type="button" className={activeType === "all" ? "active" : ""} aria-pressed={activeType === "all"} onClick={() => (activeType === "all" ? toggle() : onChoose("all"))}>
            <span className="closet-index-label">全部</span><span className="closet-index-count">{total}</span>
          </button>
          <button type="button" className="closet-index-toggle" aria-expanded={open} aria-controls="closet-index-rows" aria-label={open ? "收起分類" : "展開分類"} title={open ? "收起分類" : "展開分類"} onClick={toggle}>
            <CaretDown size={14} weight="regular" aria-hidden="true" />
          </button>
          {!open && folded && (
            <>
              <span className="closet-index-sep" aria-hidden="true">/</span>
              {entry(folded.id, folded.label, folded.count)}
            </>
          )}
        </span>
        {(favCount > 0 || wishCount > 0 || dreamCount > 0 || trashCount > 0) && (
          <span className="closet-index-extra">
            {favCount > 0 && entry("favorites", "最愛", favCount)}
            {wishCount > 0 && entry("wishlist", "想買的", wishCount)}
            {(dreamCount > 0 || wishCount > 0) && entry("dream", "夢幻逸品", dreamCount)}
            {trashCount > 0 && entry("trash", "垃圾桶", trashCount)}
          </span>
        )}
      </div>
      {/* 收合用 grid 的 0fr ↔ 1fr 做高度;收起時 inert,裡面的按鈕 Tab 不到、點不到 */}
      <div id="closet-index-rows" className="closet-index-rows" inert={!open}>
        <div className="closet-index-rows-inner">
          {PART_GROUPS.map((group) => {
            const parts = group.parts.filter((part) => counts[part] || activeType === part);
            if (!parts.length) return null;
            return (
              <div key={group.id} className="closet-index-row" role="group" aria-label={group.label}>
                <span className="closet-index-group" aria-hidden="true">{group.label}</span>
                <span className="closet-index-items">{parts.map((part) => entry(part, PARTS[part].short || PARTS[part].label, counts[part] || 0, true))}</span>
              </div>
            );
          })}
          {brands.list.length > 0 && (
            <div className="closet-index-row" role="group" aria-label="品牌">
              <span className="closet-index-group" aria-hidden="true">品牌</span>
              <span className="closet-index-items">
                {shownBrands.map((brand) => entry(`${BRAND_PREFIX}${brand.name}`, brand.name, brand.count, true))}
                {hiddenBrands > 0 && (
                  <button type="button" className="closet-index-more" onClick={() => setAllBrands(true)}>其他 {hiddenBrands} 個</button>
                )}
                {brands.none > 0 && entry(BRAND_PREFIX, "沒寫", brands.none, true)}
              </span>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

/* 總價(2026-10-07 本人要的「總價錢」):跟著目錄選的範圍加(全部/某一類/某個品牌/想買的)。
   數量 ×2 的算兩件;不同幣別分開加、不換算(沒有匯率來源,換了也是猜);幾件沒填價錢照實寫,不然看起來像全部的總值。
   站主衣櫃那 104 件本來都沒有價錢(verified 2026-10-07:library.json 0 件有),要自己在單品頁填。 */
function sumPrices(list) {
  const byCurrency = new Map();
  let priced = 0;
  for (const item of list) {
    const price = Number(item.price);
    if (!(price > 0)) continue;
    priced += 1;
    const currency = item.priceCurrency || "TWD";
    byCurrency.set(currency, (byCurrency.get(currency) || 0) + price * qtyOf(item.quantity));
  }
  return { text: [...byCurrency].map(([currency, value]) => formatPrice(value, currency)).join(" + "), priced, count: list.length };
}
function ClosetTotal({ items }) {
  const owned = sumPrices(items.filter((item) => !item.wishlist));
  const wish = sumPrices(items.filter((item) => item.wishlist));
  const part = (label, sum) => sum.count > 0 && (
    <span className="closet-total-part">
      <span className="closet-total-label">{label}</span>
      {sum.priced ? <strong>{sum.text}</strong> : <span className="closet-total-none">還沒填價錢</span>}
      {!(sum.count === 1 && sum.priced) && (
        <small>{sum.priced === sum.count ? `${sum.count} 件都有價錢` : sum.priced ? `${sum.count} 件裡 ${sum.priced} 件有價錢` : "點開一件,在「價錢」填上就會加進來"}</small>
      )}
    </span>
  );
  if (!owned.count && !wish.count) return null;
  return (
    <p className="closet-total">
      {part(wish.count ? "已經有的" : "合計", owned)}
      {part("想買的", wish)}
    </p>
  );
}

/* 垃圾桶(2026-10-06 本人要的:刪錯了要有復原的機會)。自己加的放 30 天再真的刪,站主衣櫃的只是隱藏。 */
function TrashGrid({ items, onRestore, onPurge, canPurge }) {
  const hasServed = items.some((item) => !item.isLocal);
  return (
    <section className="trash" aria-label="垃圾桶">
      <p className="trash-note">
        刪掉的先放在這裡,按「復原」就回到衣櫃。自己加的 {TRASH_DAYS} 天後自動刪掉{hasServed ? ";站主衣櫃的只是隱藏,一直留著" : ""}。
      </p>
      <div className="gallery-grid">
        {items.map((item) => {
          const left = item.trashedAt ? Math.max(0, TRASH_DAYS - Math.floor((Date.now() - Date.parse(item.trashedAt)) / 864e5)) : null;
          const label = item.name || TYPE_MAP[item.part]?.singular || "衣物";
          return (
            <div key={item.id} className="gallery-cell trash-cell">
              <div className="gallery-item trash-thumb">
                <OptimizedImage src={item.thumbnail || item.image} alt="" sizes="(max-width: 520px) calc(50vw - 16px), 180px" breakpoints={[120, 180, 240, 320]} />
              </div>
              <p className="trash-name">{label}</p>
              <p className="trash-left">{left === null ? "隱藏中" : left === 0 ? "今天會自動刪掉" : `${left} 天後自動刪掉`}</p>
              <div className="trash-actions">
                <button type="button" className="secondary-button" onClick={() => onRestore(item.id)} aria-label={`復原${label}`}>復原</button>
                {canPurge(item) && (
                  <button type="button" className="trash-purge" onClick={() => onPurge(item.id)} aria-label={`永久刪除${label}`}>永久刪除</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TagEditor({ tags, onChange }) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const nextTag = input.trim().replace(/^#/, "");
    if (!nextTag || tags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) return;
    onChange([...tags, nextTag]);
    setInput("");
  };

  return (
    <div className="tag-editor">
      <div className="editable-tags">
        {tags.map((tag) => (
          <span className="editable-tag" key={tag}>
            {tag}
            <button type="button" onClick={() => onChange(tags.filter((existing) => existing !== tag))} aria-label={`移除 ${tag}`}>
              <X size={12} weight="regular" aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <div className="tag-input-row">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addTag();
            }
          }}
          placeholder="加一個細節標籤"
          aria-label="新增細節標籤"
        />
        <button type="button" onClick={addTag} disabled={!input.trim()} aria-label="新增細節">
          <Plus size={15} weight="regular" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/* 主角配什麼最能看出搭不搭(跟 wishCheck.js 的 PARTNER 一致):上衣看下身、下身看上衣、外套看上衣、鞋看下身 */
const COLOR_PARTNER = { upperbody: "lowerbody", lowerbody: "upperbody", wholebody_up: "upperbody", shoes: "lowerbody", bag: "upperbody", socks: "shoes" };

/** 顏色區塊的主體:這個顏色在推薦裡是底色還是重點色、櫃裡有幾件跟它配得起來 */
function ColorRoleNote({ draft, owned, itemId }) {
  const piece = { color: draft.color, name: draft.name, tags: draft.tags, part: draft.part };
  const { role, why } = colorRole(piece);
  const partner = COLOR_PARTNER[draft.part] || null;
  const partners = partner ? owned.filter((other) => other.part === partner && other.id !== itemId && !other.wishlist) : [];
  // 「配得起來」= 兩件擺一起,colorScore 不判成「顏色可能打架」(跟「值不值得買」同一個算法)
  const fit = partners.filter((other) => colorScore([piece, other]).score > -3).length;
  if (!draft.color) return <p className="color-role-copy">還沒有主色,推薦時當成跟什麼都搭。從圖片吸一個,配色才算得準。</p>;
  return (
    <div className="color-role">
      <span className="color-role-swatch" style={{ backgroundColor: draft.color }} aria-hidden="true" />
      <div>
        <p className="color-role-title">
          <strong>{colorLabel(draft.name, draft.color)}</strong>
          <span>{role === "base" ? "底色" : "重點色"}</span>
        </p>
        <p className="color-role-copy">
          {role === "base"
            ? `${why},推薦時拿來打底,跟什麼都配。`
            : "推薦時一套只讓它一件有顏色,其他配黑白灰、深色或丹寧。"}
          {partner && partners.length > 0 && (role === "base"
            ? `櫃裡的${PART_NAME[partner]} ${partners.length} 件都能配。`
            : `櫃裡的${PART_NAME[partner]} ${partners.length} 件裡,${fit} 件跟它不打架。`)}
        </p>
        {draft.secondaryColor && <p className="color-role-copy">副色 {colorName(draft.secondaryColor)},說「換成{colorName(draft.secondaryColor)}的」時也找得到它。</p>}
      </div>
    </div>
  );
}

function ColorControl({ label, field, value, palette, onChange, sampling, setSampling, optional = false, onClear, onAdd }) {
  if (optional && !value) {
    return (
      <div className="color-slot empty-color-slot">
        <div className="color-slot-heading">
          <span>{label}</span>
          <small>選填</small>
        </div>
        <p>沒有偵測到明顯的副色。</p>
        <button className="add-secondary-button" type="button" onClick={onAdd}>新增副色</button>
      </div>
    );
  }

  return (
    <div className="color-slot">
      <div className="color-slot-heading">
        <span>{label}</span>
        {optional && <button type="button" onClick={onClear}>移除</button>}
      </div>
      <label className="selected-color-control">
        <input
          type="color"
          value={value || "#9a9286"}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`選擇${label}`}
        />
        <span className="selected-color-copy" title={value || undefined}>
          <small>目前</small>
          <strong>{value ? colorName(value) : "自訂"}</strong>
        </span>
      </label>
      <div className="suggestion-heading">
        <span>圖片建議色</span>
        <small>點一下套用</small>
      </div>
      <div className="palette" aria-label={`從圖片取出的${label}建議`}>
        {palette.map((color) => (
          <button
            type="button"
            key={color}
            className={value?.toLowerCase() === color.toLowerCase() ? "active" : ""}
            style={{ backgroundColor: color }}
            onClick={() => onChange(color)}
            aria-label={`把這個${colorName(color)}設為${label}`}
            title={colorName(color)}
          />
        ))}
      </div>
      <button
        className={`sample-button${sampling === field ? " active" : ""}`}
        type="button"
        onClick={() => setSampling((current) => current === field ? null : field)}
      >
        {sampling === field ? "取消吸色" : `從圖片吸${label}`}
      </button>
    </div>
  );
}

function ItemEditor({ draft, setDraft, palette, sampling, setSampling, sampleStatus, priceStatus = "", onFetchPrice = null, mergeCandidates = [], onMerge = null, brandOptions = [], owned = [], itemId = null }) {
  const [fixingColor, setFixingColor] = useState(false);
  const suggestedSecondary = palette.find((color) => color.toLowerCase() !== draft.color?.toLowerCase()) || "#9a9286";

  return (
    <div className="item-editor">
      <label className="field">
        <span>名稱</span>
        <input
          value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          placeholder={TYPE_MAP[draft.part]?.singular || "衣物"}
        />
      </label>
      {/* 品牌:先填好看品名、網址猜到的;清空 = 這件不寫品牌 */}
      <label className="field">
        <span>品牌</span>
        <input
          value={draft.brand}
          list="brand-options"
          autoComplete="off"
          onChange={(event) => setDraft((current) => ({ ...current, brand: event.target.value }))}
          placeholder="沒寫"
        />
        <datalist id="brand-options">{brandOptions.map((brand) => <option key={brand} value={brand} />)}</datalist>
      </label>

      <label className="field">
        <span>分類</span>
        <select value={draft.part} onChange={(event) => setDraft((current) => ({ ...current, part: event.target.value }))}>
          {PART_GROUPS.map((group) => (
            <optgroup key={group.id} label={group.label}>
              {group.parts.map((part) => <option value={part} key={part}>{PARTS[part].label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>

      {/* 數量(2026-10-06):同一款有好幾件,一格寫 ×2 就好;櫃裡有很像的另一張,可以直接併進來 */}
      <div className="field qty-field">
        <span id="qty-label">數量</span>
        <div className="qty-row" role="group" aria-labelledby="qty-label">
          <button type="button" aria-label="少一件" disabled={qtyOf(draft.quantity) <= 1} onClick={() => setDraft((current) => ({ ...current, quantity: qtyOf(current.quantity) - 1 }))}>−</button>
          <output aria-live="polite">{qtyOf(draft.quantity)}</output>
          <button type="button" aria-label="多一件" disabled={qtyOf(draft.quantity) >= 99} onClick={() => setDraft((current) => ({ ...current, quantity: qtyOf(current.quantity) + 1 }))}>+</button>
        </div>
        {onMerge && mergeCandidates.length > 0 && (
          <div className="qty-merge">
            <p>櫃裡有 {mergeCandidates.length} 件看起來是同一款(品名、品牌、細節、顏色都對得上)。真的是同一款,就併成這一格(那一張移到垃圾桶,可以復原):</p>
            <ul>
              {mergeCandidates.slice(0, 3).map((other) => (
                <li key={other.id}>
                  <img src={other.thumbnail || other.image} alt="" />
                  <span>{other.name || "這件"}{qtyOf(other.quantity) > 1 ? ` ×${qtyOf(other.quantity)}` : ""}</span>
                  <button type="button" onClick={() => onMerge(other)}>併進來</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 價錢:想買的有商品網址就自己去抓(打開單品頁時、或按「從網址抓價錢」);沒有網址的自己填 */}
      <div className="field price-field">
        <span>價錢</span>
        <div className="price-row">
          <select aria-label="幣別" value={draft.priceCurrency || "TWD"} onChange={(event) => setDraft((current) => ({ ...current, priceCurrency: event.target.value }))}>
            {CURRENCIES.map(([code, symbol]) => <option key={code} value={code}>{symbol}</option>)}
          </select>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-label="價錢"
            value={draft.price}
            onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))}
            placeholder="還沒標價"
          />
        </div>
        {(priceStatus || onFetchPrice) && (
          <p className="price-status" aria-live="polite">
            {priceStatus}
            {onFetchPrice && <button type="button" className="price-fetch" onClick={onFetchPrice}>從網址抓價錢</button>}
          </p>
        )}
      </div>

      <fieldset className="color-field">
        <legend>顏色</legend>
        {/* 2026-10-08 本人:這個區塊不知道存在的意義。舊版一打開就是調色盤,五個建議色常常是五個差不多的黑。
            顏色在推薦裡只用來判斷「底色/重點色」,所以先講這件,改色收進「顏色抓錯了」。 */}
        <ColorRoleNote draft={draft} owned={owned} itemId={itemId} />
        {!(fixingColor || sampling || !draft.color) && (
          <button type="button" className="color-fix-toggle" onClick={() => setFixingColor(true)} aria-expanded="false">顏色抓錯了?改</button>
        )}
        {(fixingColor || sampling || !draft.color) && (
        <>
        <div className="colors-editor">
          <ColorControl
            label="主色"
            field="primary"
            value={draft.color}
            palette={palette}
            onChange={(color) => setDraft((current) => ({ ...current, color }))}
            sampling={sampling}
            setSampling={setSampling}
          />
          <ColorControl
            label="副色"
            field="secondary"
            value={draft.secondaryColor}
            palette={palette}
            onChange={(secondaryColor) => setDraft((current) => ({ ...current, secondaryColor }))}
            sampling={sampling}
            setSampling={setSampling}
            optional
            onClear={() => setDraft((current) => ({ ...current, secondaryColor: null }))}
            onAdd={() => setDraft((current) => ({ ...current, secondaryColor: suggestedSecondary }))}
          />
        </div>
        <p className="color-help" aria-live="polite">{sampling ? "點衣服上的任一處吸取顏色。" : sampleStatus || "主色是從圖片自動抓的;只有在偵測到明顯的第二種顏色時才會建議副色。"}</p>
        {draft.color && !sampling && <button type="button" className="color-fix-toggle" onClick={() => setFixingColor(false)} aria-expanded="true">收起</button>}
        </>
        )}
      </fieldset>

      <div className="field details-field">
        <span>細節標籤</span>
        <TagEditor tags={draft.tags} onChange={(tags) => setDraft((current) => ({ ...current, tags }))} />
      </div>

      {/* 備註(2026-10-08):放在所有欄位最下面。只有能編輯的人看得到,公開的單品頁不顯示 */}
      <label className="field note-field">
        <span>備註</span>
        <textarea
          value={draft.note || ""}
          onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
          rows={3}
          maxLength={500}
          placeholder="例:要手洗、M 號偏大、等打折再買"
        />
        <small>只有你看得到,公開的衣櫃不會顯示。</small>
      </label>
    </div>
  );
}

// 公開展覽版:唯讀呈現單品(分類、色票+hex、標籤),再給一個「拿去搭配頁穿上」的出口。
function ReadOnlyDetails({ item, onWear }) {
  const type = TYPE_MAP[item.part]?.singular || "衣物";
  const colors = [
    item.color && { hex: item.color, label: "主色" },
    item.secondaryColor && { hex: item.secondaryColor, label: "副色" },
  ].filter(Boolean);
  const tags = [...new Set(tagsBesidesBrand(item).map(tagLabel))];   // 品牌已經寫在上面那行;COACH 不再顯示成「教練外套」
  return (
    <div className="viewer-readonly">
      <p className="viewer-ro-category">{brandOf(item) ? `${brandOf(item)} · ` : ""}{type}{qtyOf(item.quantity) > 1 ? ` · ${qtyOf(item.quantity)} 件` : ""}</p>
      {Boolean(item.price) && <p className="viewer-ro-price">{formatPrice(item.price, item.priceCurrency)}</p>}
      {!!colors.length && (
        <div className="viewer-ro-colors">
          {colors.map((color) => (
            <span className="viewer-ro-color" key={color.label}>
              <span className="viewer-ro-swatch" style={{ backgroundColor: color.hex }} aria-hidden="true" />
              <span className="viewer-ro-color-copy">
                <small>{color.label}</small>
                <span>{colorName(color.hex)}</span>
              </span>
            </span>
          ))}
        </div>
      )}
      {!!tags.length && (
        <ul className="viewer-ro-tags" aria-label="細節標籤">
          {tags.map((tag) => <li key={tag}>{tag}</li>)}
        </ul>
      )}
      <div className="viewer-actions viewer-ro-actions">
        <button className="primary-button" type="button" onClick={() => onWear(item)}>
          <Sparkle size={15} weight="regular" aria-hidden="true" /> 在搭配頁穿上
        </button>
      </div>
    </div>
  );
}

/* 想買的單品存好之後還能改網址;不然貼錯只能刪掉重新去背。 */
function WishLinkEditor({ item, onSetUrl, disabled = false }) {
  const [text, setText] = useState(item.sourceUrl || "");
  const [saved, setSaved] = useState(false);
  // 換了一件就重設;同一件的網址被別台改了,只有這台沒動過輸入框時才跟上,打到一半的字不蓋掉
  const shownUrl = useRef(item.sourceUrl || "");
  useEffect(() => {
    shownUrl.current = item.sourceUrl || "";
    setText(item.sourceUrl || "");
  }, [item.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const before = shownUrl.current;
    const next = item.sourceUrl || "";
    if (before === next) return;
    shownUrl.current = next;
    setText((current) => (current === before ? next : current));
    setSaved(false);   // 換成別台存的網址了,「已存。」講的不是這個
  }, [item.sourceUrl]);
  useEffect(() => { setSaved(false); }, [item.id]);
  const problem = productUrlProblem(text);
  const changed = (findUrl(text) || "") !== (item.sourceUrl || "");

  const submit = async (event) => {
    event.preventDefault();
    if (problem || !changed) return;
    const url = findUrl(text);
    await onSetUrl(item.id, url);
    shownUrl.current = url || "";
    setText(url || "");
    setSaved(true);
  };

  return (
    <form className="add-field viewer-wish-link" onSubmit={submit}>
      <label htmlFor={`wish-url-${item.id}`}>商品網址</label>
      <div className="viewer-wish-link-row">
        <input
          id={`wish-url-${item.id}`}
          type="text"
          inputMode="url"
          autoComplete="off"
          value={text}
          onChange={(event) => { setText(event.target.value); setSaved(false); }}
          placeholder="https://"
          aria-invalid={Boolean(problem)}
        />
        <button className="secondary-button" type="submit" disabled={disabled || Boolean(problem) || !changed}>存網址</button>
      </div>
      {problem && <small className="add-field-error">{problem}</small>}
      {saved && !problem && <small role="status">已存。</small>}
    </form>
  );
}

const PIECE_ORDER = ["wholebody_up", "upperbody", "lowerbody", "shoes", "bag", "socks", "eyewear", "wrist"];
const PART_NAME = { upperbody: "上衣", lowerbody: "下身", wholebody_up: "外套", shoes: "鞋", bag: "包", socks: "襪子" };

/** 想買的那件:櫃裡有沒有很像的、跟已經有的能配出什麼。買之前看一眼用。 */
function WishCheck({ item, owned, onOpen, onWearOutfit }) {
  // 只在這件或衣櫃清單真的變了才重算:三套是亂數配的,同步重讀衣櫃就換一組,使用者正要按「穿這套」
  const keyOf = (piece) => [piece.id, piece.part, piece.name, piece.color, piece.secondaryColor, (piece.tags || []).join(",")].join(":");
  const ownedKey = owned.map(keyOf).join("|");   // 名稱、標籤、副色都會影響「很像」和配色,要算進來
  const itemKey = keyOf(item);
  const similar = useMemo(() => findSimilar(item, owned), [itemKey, ownedKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const plan = useMemo(() => wishOutfits(item, owned), [itemKey, ownedKey]);     // eslint-disable-line react-hooks/exhaustive-deps
  const kind = kindLabel(item);
  const fit = fitOf(item);
  const sameFit = fit ? similar.filter((piece) => fitOf(piece) === fit).length : 0;

  return (
    <div className="wish-check">
      <section aria-labelledby={`wish-similar-${item.id}`}>
        <h3 id={`wish-similar-${item.id}`}>櫃裡很像的</h3>
        {similar.length ? (
          <>
            <p>
              已經有 {similar.length} 件同色的{kind}
              {fit && (sameFit === similar.length ? `,都是${fit}` : sameFit ? `,其中 ${sameFit} 件也是${fit}` : `,版型看不出是不是${fit}`)}。
            </p>
            <div className="wish-thumbs">
              {similar.slice(0, 4).map((piece) => (
                <button key={piece.id} type="button" onClick={() => onOpen(piece.id)} aria-label={`查看${piece.name}`} title={piece.name}>
                  <OptimizedImage src={piece.thumbnail || piece.image} alt="" sizes="72px" breakpoints={[120, 180]} />
                </button>
              ))}
              {similar.length > 4 && <span className="wish-more">還有 {similar.length - 4} 件</span>}
            </div>
          </>
        ) : (
          <p>櫃裡沒有同色{fit ? `、同樣${fit}` : ""}的{kind},這件不重複。</p>
        )}
      </section>

      <section aria-labelledby={`wish-outfits-${item.id}`}>
        <h3 id={`wish-outfits-${item.id}`}>跟已經有的怎麼配</h3>
        {plan.error ? <p>{plan.error}</p> : (
          <>
            <p>
              {/* 中性色跟什麼都配,「26 件裡 26 件不打架」沒有資訊(審查 F58),換個說法 */}
              {plan.partner && plan.total > 0 && (isNeutral(item.color)
                ? `${colorName(item.color)}是中性色,跟櫃裡的${PART_NAME[plan.partner]}都配得起來。`
                : `${PART_NAME[plan.partner]} ${plan.total} 件裡,${plan.fit} 件跟它配色不打架。`)}
              照它適合的天氣(體感約 {plan.feelsLike}°)配了 {plan.outfits.length} 套:
            </p>
            <ul className="wish-outfits">
              {plan.outfits.map((outfit) => {
                const pieces = PIECE_ORDER.map((slot) => outfit[slot]).filter(Boolean);
                return (
                  <li key={pieces.map((piece) => piece.id).join("|")}>
                    <div className="wish-outfit-pieces" aria-label={pieces.map((piece) => piece.name).join("、")} role="img">
                      {pieces.map((piece) => (
                        <span key={piece.id} className={piece.id === item.id ? "is-wish" : undefined}>
                          <OptimizedImage src={piece.thumbnail || piece.image} alt="" sizes="56px" breakpoints={[120]} />
                        </span>
                      ))}
                    </div>
                    <button className="secondary-button" type="button" onClick={() => onWearOutfit(outfit)}>穿上看看</button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

const DRAFT_FIELDS = ["name", "part", "color", "secondaryColor", "tags", "price", "priceCurrency", "quantity", "brand", "note"];

function draftOf(item) {
  return {
    name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])],
    price: item.price ? String(item.price) : "", priceCurrency: item.priceCurrency || "TWD",
    quantity: qtyOf(item.quantity),
    brand: brandOf(item) || "",
    note: item.note || "",
  };
}

/* 同一件換成新物件時(同步拉到別台的衣服、存檔):沒動過的欄位跟上新值,正在改的欄位保留。 */
function rebaseDraft(draft, before, after) {
  return Object.fromEntries(DRAFT_FIELDS.map((field) => [
    field,
    JSON.stringify(draft[field]) === JSON.stringify(before[field]) ? after[field] : draft[field],
  ]));
}

/** @param gone 這件在別台被刪掉或隱藏了:頁面留著(草稿還在、可以複製),但存檔、刪除、穿上這些動作都關掉 */
function ItemViewer({ item, gone = false, owned, onClose, onSave, onDelete, onWear, onBought, onSetDream = null, onSetUrl, onSetPrice, onOpen, onWearOutfit, onReplaceImage, onRestoreImage, favorite = false, onToggleFavorite = null, onMergeAway = null, brandOptions = [] }) {
  const closeButtonRef = useRef(null);
  const dialogRef = useRef(null);
  // 焦點圈在單品頁裡、關掉後回到原本點的那格(審查 F46)。Esc 照下面自己的處理(先取消吸色、有沒存的先擋)
  useDialog(dialogRef, null, { initialFocus: closeButtonRef });
  const imageRef = useRef(null);
  const viewImage = useFullImage(item);   // 自己加的衣服:清單裡是縮圖,這裡換成原圖
  const samplingCanvasRef = useRef(null);
  const shakeTimerRef = useRef(null);
  const [sampling, setSampling] = useState(null);
  const [sampleStatus, setSampleStatus] = useState("");
  const [palette, setPalette] = useState(item.palette || []);
  const [draft, setDraft] = useState(() => draftOf(item));
  const [shaking, setShaking] = useState(false);
  const [closeBlocked, setCloseBlocked] = useState(false);

  // item 換了:換成另一件就整個重設;同一件只是被 refresh 重建成新物件(同步拉到東西時每件都會),
  // 打到一半的欄位不能被清掉。在 render 裡直接調整,不用 effect,免得先拿舊草稿畫一次、isDirty 閃一下。
  const [draftBase, setDraftBase] = useState(item);
  if (draftBase !== item) {
    setDraftBase(item);
    if (draftBase.id !== item.id) {
      setSampling(null);
      setSampleStatus("");
      setPalette(item.palette || []);
      setDraft(draftOf(item));
    } else {
      setDraft((current) => rebaseDraft(current, draftOf(draftBase), draftOf(item)));
    }
  }

  const type = TYPE_MAP[item.part]?.singular || "衣物";
  const hasModeledImage = Boolean(item.modeledImage);
  const pieceRotation = useMemo(() => {
    const hash = [...item.id].reduce((total, character) => total + character.charCodeAt(0), 0);
    return `${(hash % 9) - 4}deg`;
  }, [item.id]);

  const isDirty = useMemo(() => {
    const normalizedTags = (tags) => tags.map((tag) => tag.trim()).filter(Boolean);
    return JSON.stringify({
      name: draft.name.trim(),
      part: draft.part,
      color: draft.color?.toLowerCase() || null,
      secondaryColor: draft.secondaryColor?.toLowerCase() || null,
      tags: normalizedTags(draft.tags),
      price: parsePrice(draft.price),
      priceCurrency: parsePrice(draft.price) ? draft.priceCurrency || "TWD" : null,
      quantity: qtyOf(draft.quantity),
      brand: canonicalBrand(draft.brand) || "",
      note: (draft.note || "").trim(),
    }) !== JSON.stringify({
      name: (item.name || "").trim(),
      part: item.part,
      color: item.color?.toLowerCase() || null,
      secondaryColor: item.secondaryColor?.toLowerCase() || null,
      tags: normalizedTags(item.tags || []),
      price: item.price || null,
      priceCurrency: item.price ? item.priceCurrency || "TWD" : null,
      quantity: qtyOf(item.quantity),
      brand: brandOf(item) || "",
      note: (item.note || "").trim(),
    });
  }, [draft, item]);

  const nudgeUnsaved = useCallback(() => {
    setCloseBlocked(true);
    setShaking(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setShaking(true));
    });
    clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => setShaking(false), 420);
  }, []);

  const requestClose = useCallback(() => {
    if (isDirty && !gone) nudgeUnsaved();   // 已經不在的那件,存不了也不用擋
    else onClose();
  }, [isDirty, gone, nudgeUnsaved, onClose]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.isComposing || event.keyCode === 229) return;   // 選字中按 Esc 是取消選字
      if (event.key === "Escape") {
        if (sampling) setSampling(null);
        else requestClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("viewer-open");
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("viewer-open");
      clearTimeout(shakeTimerRef.current);
    };
  }, [requestClose, sampling]);

  // 焦點只在打開或換一件時放到關閉鈕;放在上面那個 effect 裡會跟著每次重新 render 搶焦點(同步重讀衣櫃時正在打字的欄位被搶走)
  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true });
  }, [item.id]);

  useEffect(() => {
    if (!isDirty) setCloseBlocked(false);
  }, [isDirty]);

  // 「已儲存。」只講剛剛那一次;存完又改了就拿掉,免得有沒存的修改時還寫著已儲存
  useEffect(() => {
    if (isDirty) setSampleStatus((status) => (status === "已儲存。" ? "" : status));
  }, [isDirty]);

  // 「在搭配頁穿上」「穿上看看」會離開這頁:有沒存的修改先擋下來,跟關閉一樣(審查抓到:改了分類沒存,直接穿上就丟了)
  const wearHere = () => {
    if (isDirty && !gone) { nudgeUnsaved(); return; }
    onWear(item);
  };

  const cancelEditing = () => {
    setDraft(draftOf(item));
    setSampling(null);
    setSampleStatus("");
    onClose();
  };

  // 有商品網址就能從網址找價錢:想買的、打開時還沒標價就自動找一次;按鈕可以重新找(特價、改價)。找到直接存
  const [priceStatus, setPriceStatus] = useState("");
  const canFetchPrice = Boolean(item.sourceUrl && !productUrlProblem(item.sourceUrl)) && !gone;
  const fetchPrice = useCallback(async (auto = false) => {
    setPriceStatus("從網址找價錢…");
    const price = await fetchPriceForUrl(item.sourceUrl).catch(() => null);
    if (!price) { setPriceStatus(auto ? "" : "這個網址讀不到價錢(可能擋住了),自己填"); return; }
    onSetPrice(item.id, price);
    setPriceStatus(`從網址讀到 ${formatPrice(price.amount, price.currency)}`);
  }, [item.id, item.sourceUrl, onSetPrice]);
  useEffect(() => {
    setPriceStatus("");
    if (item.wishlist && canFetchPrice && !item.price) fetchPrice(true);
  }, [item.id]);   // eslint-disable-line react-hooks/exhaustive-deps -- 只在打開或換一件時自動找

  const saveEditing = () => {
    const price = parsePrice(draft.price);
    // 品牌跟自動猜的一樣、本來也沒填:不存(之後品名改了還會跟著猜);改過才存,清空 = 刻意不寫
    // 統一寫法再存(adidas、ADIDAS → Adidas),目錄才不會同一個牌子分兩格
    const typedBrand = canonicalBrand(draft.brand) || "";
    const brand = typedBrand === (brandOf(item) || "") ? item.brand : typedBrand;
    onSave({
      ...item, ...draft, name: draft.name.trim(), tags: draft.tags.map((tag) => tag.trim()).filter(Boolean),
      price, priceCurrency: price ? draft.priceCurrency || "TWD" : null, quantity: qtyOf(draft.quantity), brand,
      note: (draft.note || "").trim(),
    });
    setSampling(null);
    // 存完就關掉,回到原本那一格(2026-10-06 本人要的;舊版存完停在原地,只在表單裡寫一行「已儲存」)
    onClose();
  };

  const handleImageLoad = (event) => {
    samplingCanvasRef.current = buildSamplingCanvas(event.currentTarget);
    const extracted = extractPalette(event.currentTarget);
    setPalette([...new Set([...(item.palette || []), ...extracted])].slice(0, 5));
  };

  const handleImageClick = (event) => {
    if (!sampling || !samplingCanvasRef.current) return;
    const color = sampleImageColor(event.currentTarget, samplingCanvasRef.current, event);
    if (!color) {
      setSampleStatus("那個位置是透明的——請直接點在衣服上。");
      return;
    }
    const targetField = sampling === "secondary" ? "secondaryColor" : "color";
    setDraft((current) => ({ ...current, [targetField]: color }));
    setPalette((current) => [color, ...current.filter((existing) => existing.toLowerCase() !== color.toLowerCase())].slice(0, 5));
    setSampleStatus(`已吸取這個${colorName(color)}。`);
    setSampling(null);
  };

  // 同一款的另一張:可以併進這一格,數量加上去。2026-10-08 起改用 findSameStyle(品牌、細節、品名顏色、品名都要對得上);
  // 舊版用「很像」(同分類同色就算),會叫人把素 T 跟印花 T、亨利領併在一起
  const mergeCandidates = useMemo(() => (
    item.wishlist ? [] : findSameStyle(item, owned, { brandOf, sameProduct }).filter((other) => !other.wishlist)
  ), [item, owned]);
  const mergeWith = (other) => {
    const quantity = Math.min(99, qtyOf(draft.quantity) + qtyOf(other.quantity));
    const price = parsePrice(draft.price);
    onSave({
      ...item, ...draft, name: draft.name.trim(), tags: draft.tags.map((tag) => tag.trim()).filter(Boolean),
      price, priceCurrency: price ? draft.priceCurrency || "TWD" : null, quantity,
    }, { quiet: true });
    onMergeAway(other, item, qtyOf(draft.quantity));
    onClose();
  };

  // 最愛(2026-10-06):名稱旁邊一顆星,點了加入;衣櫃目錄的「最愛」只看這些
  const favoriteButton = onToggleFavorite && (
    <button
      type="button"
      className={favorite ? "viewer-fav is-on" : "viewer-fav"}
      aria-pressed={favorite}
      aria-label={favorite ? "從最愛拿掉" : "加到最愛"}
      title={favorite ? "從最愛拿掉" : "加到最愛"}
      onClick={() => onToggleFavorite(item.id)}
    >
      <Star size={20} weight={favorite ? "fill" : "regular"} aria-hidden="true" />
    </button>
  );

  const garmentArtwork = (
    <div
      className={`viewer-art${hasModeledImage ? " viewer-art-floating" : ""}${sampling ? " sampling" : ""}`}
      style={hasModeledImage ? { "--piece-rotation": pieceRotation } : undefined}
    >
      <OptimizedImage
        ref={imageRef}
        src={viewImage}
        alt={`選中的${type}`}
        sizes="(max-width: 520px) 40vw, 300px"
        breakpoints={[160, 240, 320, 480, 640]}
        priority
        onLoad={handleImageLoad}
        onClick={handleImageClick}
      />
      {sampling && <span className="sample-hint">點衣服吸色</span>}
      {/* 換圖放在圖上(2026-10-06):本人在下面那一排沒找到;想換圖時眼睛本來就在看圖 */}
      {onReplaceImage && !sampling && (
        <button type="button" className="viewer-art-replace" onClick={() => onReplaceImage(item)} disabled={gone}>
          <Camera size={15} weight="regular" aria-hidden="true" /> 換圖
        </button>
      )}
    </div>
  );

  return (
    <div className="viewer-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
    <div className="viewer-entry">
    <aside ref={dialogRef} className={`viewer editing${hasModeledImage ? " has-modeled-image" : ""}${shaking ? " shake" : ""}`} role="dialog" aria-modal="true" aria-label="選中的衣物">
      <button className="viewer-icon-close" type="button" onClick={requestClose} aria-label="關閉" ref={closeButtonRef}>
        <X size={24} weight="light" aria-hidden="true" />
      </button>

      {hasModeledImage ? (
        <div className="modeled-hero">
          <OptimizedImage
            className="modeled-hero-photo"
            src={item.modeledImage}
            alt={`模特兒穿著${draft.name || type}`}
            sizes="(max-width: 860px) 100vw, 520px"
            breakpoints={[320, 480, 640, 800, 1040, 1280]}
            quality={82}
            priority
          />
          <div className="viewer-heading modeled-heading">
            <div>
              <h2>{draft.name || TYPE_MAP[draft.part]?.singular}</h2>
            </div>
            {favoriteButton}
          </div>
          {garmentArtwork}
        </div>
      ) : (
        <>
          <div className="viewer-heading">
            <div>
              <h2>{draft.name || TYPE_MAP[draft.part]?.singular}</h2>
            </div>
            {favoriteButton}
          </div>
          {garmentArtwork}
        </>
      )}

      <div className="viewer-details editing">
        {gone && (
          <p className="viewer-gone" role="status">
            這件已經在另一台被刪除或隱藏了。打到一半的字還在,要留的話先複製下來;關掉這頁就會消失。
          </p>
        )}
        {item.wishlist && (
          <div className="viewer-wish">
            <p>{item.dream ? "在夢幻逸品:很想要、還沒打算買。" : "還沒買。"}不會出現在公開的衣櫃;開了同步的話,你的其他裝置也看得到。</p>
            <div className="viewer-wish-actions">
              {item.sourceUrl && !productUrlProblem(item.sourceUrl) && (
                <a className="secondary-button" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">回商品頁</a>
              )}
              <button className="secondary-button" type="button" onClick={wearHere} disabled={gone}>
                <Sparkle size={15} weight="regular" aria-hidden="true" /> 穿上看看
              </button>
              <button className="secondary-button" type="button" onClick={() => onBought(item.id)} disabled={gone}>已經買了</button>
              {onSetDream && (
                <button className="secondary-button" type="button" onClick={() => onSetDream(item.id, !item.dream)} disabled={gone}>
                  {item.dream ? "移回想買的" : "移到夢幻逸品"}
                </button>
              )}
            </div>
            <WishLinkEditor item={item} onSetUrl={onSetUrl} disabled={gone} />
            <WishCheck item={item} owned={owned} onOpen={onOpen} onWearOutfit={onWearOutfit} />
          </div>
        )}
        {canEditItem(item) ? (
          <>
            {/* 站主和自己加的衣服,單品頁原本只有編輯表單,要穿上得回搭配頁找(審查 F30) */}
            <div className="viewer-wear-row">
              {!item.wishlist && (
                <button className="secondary-button" type="button" onClick={wearHere} disabled={gone}>
                  <Sparkle size={15} weight="regular" aria-hidden="true" /> 在搭配頁穿上
                </button>
              )}
              {/* 換圖的按鈕在圖的右下角;站主衣櫃的換過,這裡可以換回原圖 */}
              {item.overridden && onRestoreImage && (
                <button className="secondary-button" type="button" onClick={() => onRestoreImage(item)} disabled={gone}>換回原圖</button>
              )}
            </div>
            <ItemEditor
              brandOptions={brandOptions}
              owned={owned || []}
              itemId={item.id}
              draft={draft}
              setDraft={setDraft}
              palette={palette}
              sampling={sampling}
              setSampling={setSampling}
              sampleStatus={sampleStatus}
              priceStatus={priceStatus}
              onFetchPrice={canFetchPrice ? () => fetchPrice(false) : null}
              mergeCandidates={mergeCandidates}
              onMerge={onMergeAway && !gone ? mergeWith : null}
            />

            {closeBlocked && <p className="unsaved-notice" role="status">離開這頁前請先儲存或取消變更。</p>}

            <div className="viewer-actions">
              <button className="delete-button" type="button" onClick={() => onDelete(item.id)} disabled={gone}>
                <Trash size={15} weight="regular" aria-hidden="true" /> 刪除
              </button>
              <span className="action-spacer" />
              <button className="secondary-button" type="button" onClick={cancelEditing}>取消</button>
              <button className="primary-button" type="button" onClick={saveEditing} disabled={gone}>
                <Check size={15} weight="bold" aria-hidden="true" /> 儲存
              </button>
            </div>
          </>
        ) : (
          <ReadOnlyDetails item={item} onWear={onWear} />
        )}
      </div>
    </aside>
    </div>
    </div>
  );
}

export function App() {
  const [items, setItems] = useState([]);
  const [activeType, setActiveType] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("landing");
  const [pendingOutfit, setPendingOutfit] = useState(null);   // 由入口頁的今日推薦帶進搭配頁
  const [closetChoice, setClosetChoice] = useState(null);     // 訪客手動選的衣櫃;null = 照有沒有自己的衣服決定
  const [syncOpen, setSyncOpen] = useState(false);
  // 更新公告:有還沒看過的就在入口亮點,打開就熄(看過的日期存在這台,見 updates.js)
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [updatesUnseen, setUpdatesUnseen] = useState(hasUnseenUpdates);
  const closeUpdates = useCallback(() => { setUpdatesOpen(false); setUpdatesUnseen(false); }, []);
  const [pendingDaily, setPendingDaily] = useState(null);   // 入口今日推薦的天氣和理由,跟著那套帶進搭配頁(審查 F25)
  const [addRequest, setAddRequest] = useState(0);
  // 做完一件事的一行回饋:剛加入的、按了「已經買了」、剛加入同步(審查 F18、F55、F63)
  const [notice, setNotice] = useState(() => {
    try {
      const joined = sessionStorage.getItem("open-wardrobe-joined");
      if (joined === null) return "";
      sessionStorage.removeItem("open-wardrobe-joined");
      return Number(joined) ? `加入同步了,從另一台拿到 ${joined} 件。` : "加入同步了。";
    } catch { return ""; }
  });
  const noticeTimer = useRef(null);
  const [noticeAction, setNoticeAction] = useState(null);   // { label, run }:刪除後的「復原」
  const say = useCallback((text, action = null) => {
    setNotice(text);
    setNoticeAction(action);
    clearTimeout(noticeTimer.current);
    // 帶按鈕的多留一下,來得及按
    noticeTimer.current = setTimeout(() => { setNotice(""); setNoticeAction(null); }, action ? 9000 : 6000);
  }, []);
  useEffect(() => {
    if (notice) noticeTimer.current = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(noticeTimer.current);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- 只為了一打開就有的那句(加入同步)排一次
  // 同步出狀況(停掉、上次失敗)時入口「同步」旁亮一個點;不打開面板也看得到(審查 F11、F40)
  const [syncAlert, setSyncAlert] = useState(() => CAN_EDIT && Boolean(syncNotice() || lastSyncError()));
  const sheetRef = useRef(null);
  const closeSync = useCallback(() => { setSyncOpen(false); setSyncAlert(CAN_EDIT && Boolean(syncNotice() || lastSyncError())); }, []);
  useDialog(sheetRef, closeSync, { active: syncOpen });

  // 衣櫃 = 離線流程匯入的(data/library.json)+ 使用者自己在網頁加的(IndexedDB)
  // 同時有兩次 refresh 在跑時(同步拉到東西、剛存好),只採用最後發出的那次;edits 和隱藏名單在 await 之後才讀,
  // 不然中間剛存的修改會被一份過期的值蓋回去,單品頁的草稿再跟著那份舊值走,下次存檔就把舊名字寫回去
  const refreshSeq = useRef(0);      // 發出過幾次
  const appliedSeq = useRef(0);      // 畫面上是第幾次的結果;比它舊的回來就丟掉
  // 上一次成功讀到的站主衣櫃、本機衣服:這次抓不到(網路斷、IndexedDB 暫時打不開)就沿用,不讓畫面上的衣服消失,
  // 人台和收藏也不會因此把它們當成被刪掉而拿掉
  const servedRef = useRef(null);
  const localRef = useRef(null);
  const servedSeq = useRef(0);
  const localSeq = useRef(0);
  const appliedComplete = useRef(false);   // 畫面上那份兩邊都有讀到
  const [ownerLocked, setOwnerLocked] = useState(false);   // 擁有者模式但沒有開通的同步碼:看到的是示範衣櫃
  const [trash, setTrash] = useState([]);                   // 垃圾桶:刪掉、還沒真的刪的
  const [favorites, setFavorites] = useState(readFavorites); // 最愛的 id(favorites.js)
  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    let failed = null;
    const [servedResult, local] = await Promise.all([
      loadServed().catch((cause) => { failed = cause; return null; }),
      loadLocalItems(),
    ]);
    const served = servedResult?.list || null;
    if (servedResult) setOwnerLocked(servedResult.locked);
    // 備用的上一份只收比較新的結果:較舊的 refresh 晚回來,不能把它換回刪除前的清單(之後讀不到時刪掉的會冒回來)
    if (served && seq > servedSeq.current) { servedRef.current = served; servedSeq.current = seq; }
    if (local && seq > localSeq.current) { localRef.current = local; localSeq.current = seq; }
    if (seq <= appliedSeq.current) {
      // 比較舊的結果被丟掉;但畫面上那份是靠沿用撐的、這份卻有讀到,就再讀一次補上
      if (served && local && !appliedComplete.current) refresh();
      return;
    }
    appliedSeq.current = seq;
    appliedComplete.current = Boolean(served && local);
    setError(!served && !servedRef.current ? (failed?.message || "衣櫃載入失敗。") : "");
    const edits = readEdits();
    const deleted = readDeletedItems();
    const localAll = local || localRef.current || [];
    // 換過圖的站主衣服:override-<id> 這種 record 只帶一張圖,蓋到那件上,本身不是一件衣服(2026-10-06)
    const overrides = new Map(localAll.filter((record) => record.overrideFor).map((record) => [record.overrideFor, record]));
    const servedList = (served || servedRef.current || []).map((item) => {
      const override = overrides.get(item.id);
      // 換上的那張也是這台的圖:清單裡先放縮圖,單品頁、人台用 fullImageId 讀原圖(useFullImage.js)
      return override ? { ...item, image: override.image, thumbnail: override.thumbnail || override.image, fullImageId: override.fullImageId, overridden: true } : item;
    });
    const mine = localAll.filter((record) => !record.overrideFor);
    const withEdits = (item) => ({ ...item, ...(edits[item.id] || {}) });
    // 垃圾桶:自己加的標了 trashedAt、站主衣櫃的在隱藏名單裡;都不出現在衣櫃,另外列
    const merged = [...servedList, ...mine.filter((item) => !item.trashedAt)].filter((item) => !deleted.has(item.id));
    setItems(merged.map(withEdits));
    setTrash([...mine.filter((item) => item.trashedAt), ...servedList.filter((item) => deleted.has(item.id))].map(withEdits));
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  // 站主的衣櫃先畫了存著的那份,背景抓到的不一樣(重新部署過、碼失效):重讀一次
  // 自己加的衣服縮圖做好了(localWardrobe.js):重讀一次,格子換成縮圖
  useEffect(() => {
    window.addEventListener("wardrobe-closet-updated", refresh);
    window.addEventListener("wardrobe-thumbs-ready", refresh);
    return () => {
      window.removeEventListener("wardrobe-closet-updated", refresh);
      window.removeEventListener("wardrobe-thumbs-ready", refresh);
    };
  }, [refresh]);
  // 入口頁是滿版的,上面那條提示看不到:打開時講一次
  useEffect(() => {
    if (CAN_EDIT && ownerLocked) say("這台還沒輸入同步碼,看到的是示範衣櫃。到右上「同步」輸入同步碼,就會打開你的衣櫃。");
  }, [ownerLocked, say]);

  // 同步:打開時、切回來時拉一次;離開(切到別的 app)前有改過就推;衣服一改,5 秒後推。
  // 拿到別台的東西不整頁重新整理:衣服、編輯、隱藏由 refresh 重讀;收藏、微調、穿著紀錄由搭配頁自己聽同一個事件重讀。
  // 這樣新增視窗、單品頁、打到一半的指令都不會被清掉。
  useEffect(() => {
    if (!CAN_EDIT) return undefined;
    const onSynced = (event) => {
      const { pendingDeletes } = event.detail;
      // 背景時跳 confirm,瀏覽器可能不等人就回 false(會把剛刪的那件拿回來):先不問,回到前景的同步會再偵測一次
      if (pendingDeletes && document.visibilityState === "hidden") return;
      if (pendingDeletes) {
        // 這台一次少了好幾件:問清楚是真的刪了,還是資料被瀏覽器清掉了。這次打開網站後自己按刪除的不算在裡面(sync.js 的 deliberate)
        const push = window.confirm(`這台少了 ${pendingDeletes} 件自己加的衣服,不是剛剛在這裡按刪除的。可能是瀏覽器把資料清掉了,也可能是之前刪的還沒同步。\n\n按「確定」:其他裝置和雲端也一起刪掉。\n按「取消」:從雲端把這 ${pendingDeletes} 件拿回來。`);
        setTimeout(() => syncNow({ deletes: push ? "push" : "restore" }), 0);   // 等這一輪同步收尾
        return;
      }
      // 只有衣服本身(拉到別台的衣服)、名稱顏色(edits)、隱藏(deleted)變了才重讀衣櫃。收藏、微調、穿著紀錄
      // 由搭配頁自己重讀;要是也重讀衣櫃,入口的圓環和今日推薦會在使用者看的時候整個重洗。
      // 單品頁開著時也要重讀:別台改的名稱、顏色不跟上的話(rebaseDraft),這台一存就用舊值蓋掉別台的修改。
      // 同步半途失敗時也重讀一次:可能已經寫進一部分衣服。
      const keys = event.detail.keys || [];
      if (event.detail.pulled || keys.includes(STORAGE_KEY) || keys.includes(DELETED_STORAGE_KEY) || (event.detail.error && !event.detail.stopped)) refresh();
      setSyncAlert(Boolean(syncNotice() || lastSyncError()));
    };
    // 網路恢復就補推:斷線時改的東西不用等下次切 app(審查 F40)
    const onOnline = () => { if (syncCode()) syncNow(); };
    const onVisibility = () => {
      if (!syncCode()) return;
      if (document.visibilityState === "visible") syncNow();
      else hasLocalChanges().then((dirty) => { if (dirty) syncNow(); }).catch(() => {});
    };
    window.addEventListener("wardrobe-synced", onSynced);
    window.addEventListener("wardrobe-local-change", scheduleSync);
    document.addEventListener("visibilitychange", onVisibility);
    // iOS 從主畫面的 app 切回來,舊版有時不發 visibilitychange;從快取還原頁面時再補一次
    const onPageShow = (event) => { if (event.persisted && syncCode()) syncNow(); };
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    if (syncCode()) syncNow();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("wardrobe-synced", onSynced);
      window.removeEventListener("wardrobe-local-change", scheduleSync);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [refresh]);

  // 單品頁開著時那件被別台刪掉或隱藏:不直接關掉(打到一半的字會跟著消失),留著最後看到的那份、標示已經不在
  const lastSelectedRef = useRef(null);
  const liveSelected = items.find((item) => item.id === selectedId) || null;
  if (liveSelected) lastSelectedRef.current = liveSelected;
  const selectedItem = liveSelected || (selectedId && lastSelectedRef.current?.id === selectedId ? lastSelectedRef.current : null);
  const selectedGone = Boolean(selectedItem && !liveSelected);

  // 訪客的衣櫃跟站主的分開:自己加的是「我的衣櫃」,站主那批的一小份樣本是「示範衣櫃」,推薦只在同一個衣櫃裡配。
  // 站主(?edit)照舊看全部;?public 只看示範。訪客一進來就是自己的衣櫃(還沒有衣服就是歡迎畫面),示範要自己點
  // (2026-10-05 本人:給朋友試用,入口不要都是站主的衣服;舊版沒有衣服的訪客直接落在示範衣櫃)。
  const mineCount = useMemo(() => items.filter((item) => item.isLocal && !item.wishlist).length, [items]);
  const hasMine = useMemo(() => items.some((item) => item.isLocal), [items]);
  const closet = CAN_EDIT ? "all" : !CAN_ADD ? "demo" : closetChoice || "mine";
  const closetItems = useMemo(
    () => (closet === "all" ? items : items.filter((item) => Boolean(item.isLocal) === (closet === "mine"))),
    [items, closet],
  );
  const demoItems = useMemo(() => items.filter((item) => !item.isLocal), [items]);   // 歡迎畫面的示範穿搭用
  const demoCount = demoItems.length;

  // 自己加、按了「已經買了」的衣服沒有保暖度,推薦引擎會整件跳過;從品名補一個。想買的不補,免得被當成已經有的拿去配
  const wearItems = useMemo(() => closetItems.map((item) => !item.wishlist && item.warmth === undefined ? { ...item, warmth: guessWarmth(item) } : item), [closetItems]);
  const ownedItems = useMemo(() => wearItems.filter((item) => !item.wishlist), [wearItems]);
  // 還沒買的分兩層(2026-10-08):想買的 = 近期會買;夢想 = 很想要、還沒打算買。兩層都不算進衣櫃、不拿去配
  const unownedCount = closetItems.length - ownedItems.length;
  const dreamCount = useMemo(() => closetItems.filter((item) => item.wishlist && item.dream).length, [closetItems]);
  const wishCount = unownedCount - dreamCount;
  // 垃圾桶跟著衣櫃走:站主看全部,訪客只看自己加的(示範衣櫃刪不了)
  const trashItems = useMemo(() => (closet === "all" ? trash : closet === "mine" ? trash.filter((item) => item.isLocal) : []), [trash, closet]);
  const trashCount = trashItems.length;
  const favCount = useMemo(() => closetItems.filter((item) => favorites.has(item.id)).length, [closetItems, favorites]);
  const onToggleFavorite = (id) => {
    const next = toggleFavorite(id);
    setFavorites(next);
    const name = items.find((item) => item.id === id)?.name || "這件";
    say(next.has(id) ? `「${name}」加到最愛了。` : `「${name}」從最愛拿掉了。`);
  };
  // 別台改了最愛(同步拉下來):重讀
  useEffect(() => {
    const onSynced = (event) => { if ((event.detail?.keys || []).includes(FAVORITES_KEY)) setFavorites(readFavorites()); };
    window.addEventListener("wardrobe-synced", onSynced);
    return () => window.removeEventListener("wardrobe-synced", onSynced);
  }, []);

  const [query, setQuery] = useState("");
  const searchTerms = useMemo(() => searchTermsOf(query), [query]);
  const searching = searchTerms.length > 0 && activeType !== "trash";
  const visibleItems = useMemo(() => {
    const filtered = searching ? closetItems.filter((item) => { const text = searchTextOf(item); return searchTerms.every((term) => termMatches(text, term)); })
      : activeType === "all" ? ownedItems
      : activeType === "wishlist" ? closetItems.filter((item) => item.wishlist && !item.dream)
      : activeType === "dream" ? closetItems.filter((item) => item.wishlist && item.dream)
      : activeType === "favorites" ? closetItems.filter((item) => favorites.has(item.id))
      : brandFilterOf(activeType) !== null ? closetItems.filter((item) => (brandOf(item) || "") === brandFilterOf(activeType))
      : closetItems.filter((item) => item.part === activeType);
    return [...filtered].sort((a, b) => {
      // 自己加的排最前面,越新越前面;站主那批沒有建立時間,接在後面照原本的類型順序
      if (a.createdAt || b.createdAt) {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return b.createdAt.localeCompare(a.createdAt);
      }
      if (searching || activeType === "all" || activeType === "wishlist" || activeType === "dream" || activeType === "favorites" || brandFilterOf(activeType) !== null) {
        const typeDifference = (TYPE_ORDER[a.part] ?? 99) - (TYPE_ORDER[b.part] ?? 99);
        if (typeDifference) return typeDifference;
      }
      return a.id.localeCompare(b.id);
    });
  }, [activeType, closetItems, ownedItems, favorites, searching, searchTerms]);

  // 帶進搭配頁的那套只用一次:離開搭配頁就清掉,不然回來時又被套回入口那套,蓋掉後來自己換的
  useEffect(() => {
    if (view !== "styling") { setPendingOutfit(null); setPendingDaily(null); }
  }, [view]);

  // 帶一套進搭配頁:先記成「身上這套」,進去後手動重新整理也穿得回來。daily = 入口今日推薦的天氣和理由
  const wearOutfit = (outfit, daily = null) => {
    if (daily) noteRecommendation(outfit);   // 入口的今日推薦按「穿上看看」:算看過一套推薦(taste.js)
    rememberWearing(outfit, closet);
    setPendingOutfit(outfit);
    setPendingDaily(daily);
  };

  // 訪客的衣服沒有同步(同步只給站主),全靠這個瀏覽器存著:加了衣服沒備份就提醒,之後每多 3 件再提醒一次
  // (2026-10-05 前只提醒一次,按了「知道了」就再也不出現)。匯出鈕直接放在提醒裡,不用再跑去搭配頁最下面找。
  const [keepTick, setKeepTick] = useState(0);
  const keepHint = useMemo(
    () => (!CAN_EDIT && CAN_ADD && hasMine ? backupReminder(items.filter((item) => item.isLocal)) : null),
    [items, hasMine, keepTick],   // eslint-disable-line react-hooks/exhaustive-deps
  );
  const dismissKeepHint = () => { snoozeBackupHint(); setKeepTick((n) => n + 1); };
  const exportFromHint = async () => {
    try {
      const count = await downloadBackupZip();
      say(`已匯出備份:${count} 件衣服,在你的下載裡。換手機或衣服不見時,按「匯入備份」選這個檔。`);
    } catch { say("匯出失敗,再試一次"); }
    setKeepTick((n) => n + 1);
  };
  // 有自己的衣服了:跟瀏覽器要「不要自動清」
  useEffect(() => { if (hasMine) requestPersist(); }, [hasMine]);

  // 訪客自己的衣櫃還空著、人在入口:歡迎畫面。這時把件數和衣櫃切換收起來(都是 0,示範從歡迎畫面的按鈕進去)
  const showWelcome = !error && !loading && !ownedItems.length && !unownedCount && view === "landing" && closet === "mine";

  // 「新增第一件」「去新增」:換到衣櫃(新增鈕在那裡的標題列),叫新增自己打開
  const requestAdd = () => {
    setView("closet");
    setAddRequest((count) => count + 1);
  };

  const chooseType = (typeId) => {
    setActiveType(typeId);
    setSelectedId(null);
    setQuery("");   // 點分類 = 回到逛分類,搜尋清掉
  };

  // 存進想買的、或從空狀態點過來:切到衣櫃的「想買的」。「全部」只列已經有的,不切過去會以為沒存成功。
  const showWishlist = (type = "wishlist") => {
    setView("closet");
    setActiveType(type);
    setSelectedId(null);
    setQuery("");
  };

  // 亮著的分類一律露出來:手機上「想買的」在分類列最右邊要橫滑才看得到,
  // 停在它上面卻看不到哪顆亮著,會以為衣服不見了(切去搭配再回來時分類列也會捲回最左邊)。
  // 只動分類列自己的橫向捲動;不用 scrollIntoView,它會連整頁一起捲,在格子中間刪一件就被拉回頂端
  // 目錄每一類的件數:點進去看到幾件就寫幾件(分類頁連想買的一起列)
  const partCounts = useMemo(() => {
    const counts = {};
    for (const item of closetItems) counts[item.part] = (counts[item.part] || 0) + 1;
    return counts;
  }, [closetItems]);
  // 品牌的件數(跟分類一樣,連想買的一起算);沒寫的另外數
  const brandCounts = useMemo(() => {
    const counts = new Map();
    let none = 0;
    for (const item of closetItems) {
      const brand = brandOf(item);
      if (brand) counts.set(brand, (counts.get(brand) || 0) + 1); else none += 1;
    }
    return { list: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })), none };
  }, [closetItems]);
  const brandOptions = useMemo(() => brandSuggestions(closetItems), [closetItems]);
  // 有價錢的才顯示總價那行;站主一律顯示(才知道可以填)
  const anyPrice = useMemo(() => closetItems.some((item) => Number(item.price) > 0), [closetItems]);

  // 想買的全買了或刪光,那顆分類就消失了;停在上面會一片空白、沒有任何一顆亮著,退回「全部」
  useEffect(() => {
    if (!loading && activeType === "wishlist" && !wishCount) setActiveType("all");
    if (!loading && activeType === "dream" && !dreamCount && !wishCount) setActiveType("all");
    if (!loading && activeType === "trash" && !trashCount) setActiveType("all");
    if (!loading && activeType === "favorites" && !favCount) setActiveType("all");
    // 那個品牌的衣服都改掉、刪掉了:退回全部
    if (!loading && brandFilterOf(activeType) !== null && !visibleItems.length) setActiveType("all");
  }, [loading, activeType, wishCount, dreamCount, trashCount, favCount, visibleItems.length]);

  const chooseCloset = (next) => {
    setClosetChoice(next);
    setActiveType("all");
    setSelectedId(null);
    setPendingOutfit(null);
  };

  // 訪客才有的切換;站主看全部、?public 只看示範,都不需要
  const closetSwitch = closet !== "all" && CAN_ADD && (
    <nav className="view-nav closet-switch" aria-label="切換衣櫃">
      <button type="button" className={closet === "mine" ? "active" : ""} aria-pressed={closet === "mine"} onClick={() => chooseCloset("mine")}>
        我的衣櫃 <small>{mineCount}</small>
      </button>
      <button type="button" className={closet === "demo" ? "active" : ""} aria-pressed={closet === "demo"} onClick={() => chooseCloset("demo")}>
        示範衣櫃 <small>{demoCount}</small>
      </button>
    </nav>
  );

  const saveItem = (updatedItem, { quiet = false } = {}) => {
    setItems((current) => current.map((item) => item.id === updatedItem.id ? updatedItem : item));
    if (!quiet) say(`「${updatedItem.name || "這件"}」存好了。`);   // 單品頁存完就關掉,「存好了」改在上方講
    // 原本的樣子 = 還沒套任何編輯的那份(站主的從 wardrobe.json、自己加的從 IndexedDB)
    const original = [...(servedRef.current || []), ...(localRef.current || [])].find((item) => item.id === updatedItem.id);
    persistEdit(updatedItem, original);
  };

  // 商品網址留著:之後再貼同一件的連結,才認得出已經有了(審查 F31)。按完講一聲,不然畫面只是安靜地變成編輯表單(F55)
  // 價錢從網址找到時直接存(跟手動編輯走同一條:edits,開了同步會傳到每一台)。用最新的那份衣服,不用畫面當下那份
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const setItemPrice = useCallback((id, price) => {
    const target = itemsRef.current.find((item) => item.id === id);
    if (!target || !price?.amount) return;
    const updated = { ...target, price: price.amount, priceCurrency: price.currency || "TWD" };
    setItems((current) => current.map((item) => (item.id === id ? updated : item)));
    const original = [...(servedRef.current || []), ...(localRef.current || [])].find((item) => item.id === id);
    persistEdit(updated, original);
  }, []);

  // 想買的、有網址、還沒標價的:背景一件一件去找(這次打開網站每件只試一次,讀不到就留給人自己填)
  const priceTried = useRef(new Set());
  useEffect(() => {
    if (!CAN_ADD || loading) return undefined;
    const todo = items.filter((item) => item.wishlist && item.sourceUrl && !item.price && !priceTried.current.has(item.id));
    if (!todo.length) return undefined;
    let cancelled = false;
    (async () => {
      for (const item of todo.slice(0, 8)) {
        if (cancelled) return;
        priceTried.current.add(item.id);
        const price = await fetchPriceForUrl(item.sourceUrl).catch(() => null);
        if (price) setItemPrice(item.id, price);   // 中途衣櫃重讀過也照存(用最新的那份);只是不再開始找下一件
      }
    })();
    return () => { cancelled = true; };
  }, [items, loading, setItemPrice]);

  const markBought = async (id) => {
    const target = items.find((item) => item.id === id);
    await updateLocalItem(id, { wishlist: false, dream: false });
    await refresh();
    say(`「${target?.name || "這件"}」放進衣櫃了。`);
  };

  /* 想買的 ↔ 夢幻逸品一次搬幾件(2026-10-09 本人:「我想把想買的一些轉移到這裡」,29 件一件件點開太慢)。
     按「挑幾件移到夢幻逸品」進挑選模式:點格子是勾選,底下一條列寫勾了幾件、按鈕搬過去。換分類、換頁就結束挑選 */
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const stopPicking = useCallback(() => { setPicking(false); setPicked(new Set()); }, []);
  useEffect(() => { stopPicking(); }, [activeType, view, closet, stopPicking]);
  const togglePicked = (id) => setPicked((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const [moving, setMoving] = useState(false);
  const movePicked = async () => {
    const toDream = activeType === "wishlist";
    const ids = [...picked];
    if (!ids.length) return;
    setMoving(true);
    try {
      for (const id of ids) await updateLocalItem(id, { dream: toDream });
      await refresh();
    } finally {
      setMoving(false);
    }
    stopPicking();
    const target = toDream ? "dream" : "wishlist";
    say(`${ids.length} 件移到${toDream ? "夢幻逸品" : "想買的"}了。`, { label: "去看", run: () => showWishlist(target) });
  };

  // 想買的 ↔ 夢幻逸品(2026-10-08):跟「已經買了」一樣改這件自己的紀錄,開了同步會跟著走
  const setDream = async (id, dream) => {
    const target = items.find((item) => item.id === id);
    await updateLocalItem(id, { dream });
    await refresh();
    say(`「${target?.name || "這件"}」移到${dream ? "夢幻逸品" : "想買的"}了。`);
  };

  const setWishUrl = async (id, sourceUrl) => {
    await updateLocalItem(id, { sourceUrl });
    await refresh();
  };

  // 刪除:先進垃圾桶,不再先問(2026-10-06 本人要的:刪錯了要能復原)。按錯了按回饋那行的「復原」,
  // 或到衣櫃的「垃圾桶」。自己加的 30 天後才真的刪;站主衣櫃的只是隱藏(本機版以前會直接刪檔,現在也只隱藏,
  // 要真的刪到垃圾桶按「永久刪除」)。開了同步,垃圾桶也跟著同步。
  const settleRefresh = () => {
    appliedSeq.current = ++refreshSeq.current;   // 還在跑的 refresh 讀的是改之前的本機清單,作廢,免得那件又冒出來
    localSeq.current = appliedSeq.current;        // 它也不能拿來當備用清單
    return refresh();                              // 再補一次讀改過的
  };
  // name:從刪除後那行的「復原」呼叫時,這裡的 trash 還是刪除前的,找不到那件,名字由呼叫端帶
  const restoreItem = async (id, name = trash.find((item) => item.id === id)?.name) => {
    if (id.startsWith("local-")) await updateLocalItem(id, { trashedAt: null });
    else unpersistDeletedItem(id);
    await settleRefresh();
    say(`「${name || "這件"}」放回衣櫃了。`);
  };
  const deleteItem = async (id) => {
    const target = items.find((item) => item.id === id);
    if (id.startsWith("local-")) {
      await updateLocalItem(id, { trashedAt: new Date().toISOString() });
      // 訪客刪掉自己唯一一件時留在「我的衣櫃」(空的那個),不要自動跳去示範衣櫃,像站主的衣服跑進來
      if (!CAN_EDIT) setClosetChoice("mine");
    } else {
      persistDeletedItem(id);
    }
    setItems((current) => current.filter((item) => item.id !== id));
    setSelectedId(null);
    await settleRefresh();
    say(`「${target?.name || "這件"}」移到垃圾桶了。`, { label: "復原", run: () => restoreItem(id, target?.name) });
  };
  // 合併同款(2026-10-06):另一張移到垃圾桶,留下的那張數量加上去;「復原」把另一張拿回來、數量改回去
  const setQuantity = (id, quantity) => {
    const target = itemsRef.current.find((item) => item.id === id);
    if (!target) return;
    const updated = { ...target, quantity: qtyOf(quantity) };
    setItems((current) => current.map((item) => (item.id === id ? updated : item)));
    const original = [...(servedRef.current || []), ...(localRef.current || [])].find((item) => item.id === id);
    persistEdit(updated, original);
  };
  const mergeAway = async (other, kept, keptBefore) => {
    if (other.id.startsWith("local-")) await updateLocalItem(other.id, { trashedAt: new Date().toISOString() });
    else persistDeletedItem(other.id);
    setItems((current) => current.filter((item) => item.id !== other.id));
    await settleRefresh();
    const total = Math.min(99, keptBefore + qtyOf(other.quantity));
    say(`併成一格了:「${kept.name || "這件"}」×${total}。另一張在垃圾桶。`, {
      label: "復原",
      run: async () => { setQuantity(kept.id, keptBefore); await restoreItem(other.id, other.name); },
    });
  };

  // 永久刪除:只在垃圾桶裡,這時才問。站主衣櫃的只有本機版刪得了(真的刪檔),線上只能一直隱藏
  const canPurge = (item) => Boolean(item.isLocal) || IS_LOCALHOST;
  const purgeItem = async (id) => {
    const target = trash.find((item) => item.id === id);
    const note = syncCode() ? "\n開了同步,其他裝置也會一起刪掉。" : "";
    if (!window.confirm(`永久刪除「${target?.name || "這件"}」?刪了就救不回來。${note}`)) return;
    if (id.startsWith("local-")) {
      noteDeliberateDelete(id);   // 同步不用再問一次「這台少了幾件」
      await deleteLocalItem(id);
    } else if (IS_LOCALHOST) {
      try { await fetch(`/api/import/wardrobe/${id}`, { method: "DELETE" }); } catch { /* 沒有開發伺服器就算了,照舊隱藏 */ }
      removePersistedEdit(id);
      if (target?.overridden) { noteDeliberateDelete(`override-${id}`); await deleteLocalItem(`override-${id}`); }
    }
    await settleRefresh();
  };
  // 放超過 30 天的自己加的:打開網站時真的刪掉(一次瀏覽只做一次)
  const purgedOldRef = useRef(false);
  useEffect(() => {
    if (loading || purgedOldRef.current) return;
    purgedOldRef.current = true;
    const cutoff = Date.now() - TRASH_DAYS * 864e5;
    const expired = trash.filter((item) => item.isLocal && item.trashedAt && Date.parse(item.trashedAt) < cutoff);
    if (!expired.length) return;
    (async () => {
      for (const item of expired) { noteDeliberateDelete(item.id); await deleteLocalItem(item.id); }
      settleRefresh();
    })();
  }, [loading, trash]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 2026-10-06 加了皮帶、項鍊、戒指、隨身小物。之前只能放「其他配件」的,照品名搬過去(每台做一次,改了會跟著同步)
  const partsMigratedRef = useRef(false);
  useEffect(() => {
    // 這台的衣服真的讀到了才做(讀失敗的那次記成「做過了」,之後就永遠不搬)
    // 還沒有任何自己的衣服也先不記:空衣櫃記成「做過了」,之後放進「其他配件」的皮帶就永遠不搬(正式站實測抓到)
    if (loading || partsMigratedRef.current || !localRef.current?.length) return;
    partsMigratedRef.current = true;
    try { if (localStorage.getItem("open-wardrobe-parts-v2") === "1") return; } catch { return; }
    const moves = [...items, ...trash]
      .filter((item) => item.isLocal && item.part === "accessories_up")
      .map((item) => ({ item, part: partFromName(item.name) }))
      .filter(({ part }) => ["belt", "necklace", "ring", "carry"].includes(part));
    (async () => {
      for (const { item, part } of moves) await updateLocalItem(item.id, { part });
      try { localStorage.setItem("open-wardrobe-parts-v2", "1"); } catch { /* 存不了就下次再看一次,搬過的不會再搬 */ }
      if (!moves.length) return;
      await settleRefresh();
      const where = [...new Set(moves.map(({ part }) => PARTS[part].label))].join("、");
      say(`${moves.length} 件「其他配件」照品名搬到「${where}」了。`);
    })();
  }, [loading, items]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 換一張圖(2026-10-06):自己加的直接換掉那件的圖;站主衣櫃的另存一張 override-<id>(跟著同步),可以換回原圖
  const [replaceRequest, setReplaceRequest] = useState(null);
  const replaceImage = async (item, blob) => {
    if (item.isLocal) await updateLocalItem(item.id, { blob });
    else await putLocalRecord({ id: `override-${item.id}`, overrideFor: item.id, blob, createdAt: new Date().toISOString() });
    await settleRefresh();
    say(`「${item.name || "這件"}」換好新圖了。`);
  };
  const restoreOriginalImage = async (item) => {
    noteDeliberateDelete(`override-${item.id}`);
    await deleteLocalItem(`override-${item.id}`);
    await settleRefresh();
    say(`「${item.name || "這件"}」換回原本的圖了。`);
  };

  return (
    <div className={`app-shell${selectedItem ? " has-selection" : ""}`}>
      <main className="gallery-pane">
        {view === "landing" && !loading && !!ownedItems.length && (
          <LandingRing
            title={closet === "demo" && CAN_ADD ? "示範衣櫃" : "我的衣櫃"}
            note={closet === "demo" && CAN_ADD ? (
              <>
                <span className="landing-pitch">把自己的衣服<span className="landing-pitch-more">拍照、或貼 GU、UNIQLO 的連結</span>放進來,每天照台中的天氣配一套。<span className="landing-pitch-more">下面是從站主衣櫃挑出來的幾件,先拿來示範。</span></span>
                <button type="button" className="landing-make" onClick={() => { chooseCloset("mine"); if (mineCount) setView("closet"); else requestAdd(); }}>
                  {mineCount ? "回我的衣櫃" : "建立我的衣櫃"}
                </button>
              </>
            ) : null}
            items={ownedItems}
            onSync={CAN_ADD ? () => setSyncOpen(true) : null}
            syncAlert={syncAlert}
            onUpdates={() => setUpdatesOpen(true)}
            updatesUnseen={updatesUnseen}
            onOpen={setSelectedId}
            onEnter={setView}
            onAdd={CAN_ADD ? requestAdd : null}
            onWearOutfit={(outfit, daily) => { wearOutfit(outfit, daily); setView("styling"); }}
          />
        )}
        {view === "landing" && loading && <p className="status">衣櫃載入中</p>}

        {updatesOpen && <UpdatesSheet onClose={closeUpdates} />}

        {/* 同步放在入口:手機第一眼就找得到。?public 不出現 */}
        {syncOpen && (
          <div className="add-overlay" role="dialog" aria-modal="true" aria-label="同步" ref={sheetRef} onClick={(event) => { if (event.target === event.currentTarget) closeSync(); }}>
            <div className="sync-sheet">
              <button type="button" className="add-close" onClick={closeSync} aria-label="關閉">
                <X size={20} weight="light" aria-hidden="true" />
              </button>
              <h2>同步</h2>
              <SyncPanel canStart={CAN_EDIT} />
            </div>
          </div>
        )}
        {syncOpen && (
          <ScrollRail target={sheetRef} watch={syncOpen} />
        )}

        {(view !== "landing" || (!loading && !ownedItems.length)) && (
        // 歡迎畫面時頂端只留同步那些:件數、新增、三個分頁都收起來(衣櫃、搭配點進去是空的;新增就是歡迎畫面那顆大按鈕)
        <header className={showWelcome ? "gallery-header is-quiet" : "gallery-header"}>
          <h1 className="visually-hidden">{view === "styling" ? "搭配" : "衣櫃"}</h1>
          <div className="gallery-meta-row">
            {/* 衣櫃頁的件數、想買的在目錄第一行,這裡只在搭配頁出現 */}
            <p className="piece-count" hidden={showWelcome || view === "closet"}>{ownedItems.length} 件單品{wishCount > 0 && <span className="piece-count-wish"> · 想買 {wishCount}</span>}</p>
            <div className="header-tools">
              {CAN_ADD && (
                <AddGarment
                  existing={closet === "all" ? items : items.filter((item) => item.isLocal)}
                  onAddOne={(item) => {
                    setQuantity(item.id, qtyOf(item.quantity) + 1);
                    say(`沒有另存:「${item.name || "那件"}」改成 ×${qtyOf(item.quantity) + 1}。`);
                  }}
                  openRequest={addRequest}
                  onOpenHandled={() => setAddRequest(0)}
                  onAdded={async (wishlist, name, dream = false) => {
                    if (!CAN_EDIT) { setClosetChoice("mine"); setPendingOutfit(null); }   // 換到我的衣櫃:示範衣櫃帶進來的那套不要跟過去
                    await refresh();
                    if (wishlist) showWishlist(dream ? "dream" : "wishlist");
                    say(wishlist ? `「${name}」放進${dream ? "夢幻逸品" : "想買的"}了。` : `「${name}」加進衣櫃了。`);
                  }}
                />
              )}
              <nav className="view-nav" aria-label="切換頁面" hidden={showWelcome}>
                <button type="button" onClick={() => setView("landing")}>入口</button>
                <button type="button" className={view === "closet" ? "active" : ""} aria-current={view === "closet" ? "page" : undefined} onClick={() => setView("closet")}>衣櫃</button>
                <button type="button" className={view === "styling" ? "active" : ""} aria-current={view === "styling" ? "page" : undefined} onClick={() => setView("styling")}>搭配</button>
              </nav>
            </div>
          </div>
          {!showWelcome && closetSwitch}
          {/* 搜尋放在目錄上面:手機上品牌那行很長,放下面要先滑過整個目錄才找得到 */}
          {view === "closet" && activeType !== "trash" && !!closetItems.length && (
            <ClosetSearch query={query} onChange={setQuery} count={searching ? visibleItems.length : null} />
          )}
          {view === "closet" && (
            <ClosetIndex
              activeType={activeType}
              onChoose={chooseType}
              counts={partCounts}
              total={ownedItems.length}
              favCount={favCount}
              wishCount={wishCount}
              dreamCount={dreamCount}
              trashCount={trashCount}
              brands={brandCounts}
            />
          )}
          {view === "closet" && activeType !== "trash" && (CAN_EDIT || anyPrice) && <ClosetTotal items={visibleItems} />}
          {/* 想買的 ↔ 夢幻逸品一次搬幾件:按了進挑選模式(動作列在畫面底下) */}
          {view === "closet" && CAN_ADD && !searching && !picking && (activeType === "wishlist" || activeType === "dream") && visibleItems.some(canEditItem) && (
            <div className="pick-start">
              <button type="button" className="secondary-button" onClick={() => setPicking(true)}>
                {activeType === "wishlist" ? "挑幾件移到夢幻逸品" : "挑幾件移回想買的"}
              </button>
            </div>
          )}
        </header>
        )}

        {keepHint && view === "closet" && (() => {
          const app = inAppBrowser();
          return (
            <p className="keep-hint" role="note">
              {keepHint.backedUp && `上次備份之後又加了 ${keepHint.fresh} 件。`}
              {app
                ? `你現在是在 ${app} 裡面開的,這些衣服只存在 ${app} 裡,改用 Safari 或 Chrome 打開會是空的。之後請固定從同一個地方打開,或先留一份備份。`
                : isIos() && !isStandalone()
                  ? "iPhone 的 Safari 大約一週沒開這個網站,就可能把這些衣服清掉(加到主畫面的不會)。先留一份備份;之後想改用主畫面版,在那邊按「匯入備份」選這個檔就搬過去了。"
                  : "你的衣服只存在這台裝置的這個瀏覽器裡,清除瀏覽資料或換手機就會不見。留一份備份,不見了可以匯入回來。"}
              <span className="keep-hint-actions">
                <button type="button" className="is-main" onClick={exportFromHint}>匯出備份</button>
                <button type="button" onClick={dismissKeepHint}>知道了</button>
              </span>
            </p>
          );
        })()}
        {CAN_EDIT && ownerLocked && view !== "landing" && (
          <p className="keep-hint" role="note">
            你的衣櫃要用同步碼打開:這台還沒輸入同步碼(或碼已經換新的),現在看到的是示範衣櫃。
            <span className="keep-hint-actions">
              <button type="button" className="is-main" onClick={() => setSyncOpen(true)}>輸入同步碼</button>
            </span>
          </p>
        )}
        {/* 浮在畫面上方:入口頁是滿版的、單品頁在手機上蓋滿整個畫面,放在頁面裡會看不到(審查抓到) */}
        {notice && (
          <p className={noticeAction ? "app-notice has-action" : "app-notice"} role="status">
            {notice}
            {noticeAction && (
              <button type="button" onClick={() => { const { run } = noticeAction; setNotice(""); setNoticeAction(null); run(); }}>{noticeAction.label}</button>
            )}
          </p>
        )}
        {error && <p className="status error">{error}</p>}
        {view !== "landing" && !error && loading && <p className="status">衣櫃載入中</p>}
        {/* 只看「想買的」分頁時它自己會列出來;入口、搭配、其他分頁仍要講,不然空白一片 */}
        {/* 訪客自己的衣櫃還空著:入口給一個歡迎畫面,不是直接攤開站主的衣服 */}
        {showWelcome && (
          <Welcome
            demoItems={demoItems}
            onAdd={requestAdd}
            onDemo={() => chooseCloset("demo")}
            onSync={() => setSyncOpen(true)}
            onUpdates={() => setUpdatesOpen(true)}
            trashCount={trashCount}
            onOpenTrash={() => { setView("closet"); setActiveType("trash"); }}
            onImportFile={async (file) => {
              const message = await importBackupFile(file, Boolean(syncCode()));
              if (message) say(message);
            }}
          />
        )}
        {!error && !loading && !ownedItems.length && !(view === "closet" && (activeType === "wishlist" || activeType === "dream") && unownedCount) && !(view === "closet" && activeType === "trash" && trashCount) && !searching && !showWelcome && (
          unownedCount ? (
            <p className="status empty">
              你加的 {unownedCount} 件{wishCount && dreamCount ? "在「想買的」和「夢幻逸品」裡" : dreamCount ? "在「夢幻逸品」裡" : "在「想買的」裡"}。還沒買的不算進衣櫃,買了以後點開那件按「已經買了」。
              <br />
              {wishCount > 0 && <button type="button" className="secondary-button" onClick={() => showWishlist("wishlist")}>看想買的</button>}
              {dreamCount > 0 && <button type="button" className="secondary-button" onClick={() => showWishlist("dream")}>看夢幻逸品</button>}
            </p>
          ) : (
            <p className="status empty">
              {/* 不講方位:iPhone 上新增在左上,桌機在右上(審查 F53)。直接給一顆按鈕 */}
              {CAN_ADD ? "你的衣櫃還是空的。貼 GU、UNIQLO 的商品連結,或拍一張平放的衣服。" : "這個衣櫃還沒有單品。"}
              {CAN_ADD && (
                <>
                  <br />
                  <button type="button" className="secondary-button" onClick={requestAdd}>新增第一件</button>
                  {closet === "mine" && <button type="button" className="secondary-button welcome-demo" onClick={() => chooseCloset("demo")}>先看看示範</button>}
                </>
              )}
            </p>
          )
        )}

        {view === "styling" && !loading && !!ownedItems.length && (
          <OutfitStudio key={closet} closet={closet} items={wearItems} initialOutfit={pendingOutfit} initialDaily={pendingDaily} onOpenItem={setSelectedId} itemMatches={itemMatchesQuery} />
        )}

        {/* 示範衣櫃的眼鏡、手錶這幾類是 0 件,點下去整頁空白(審查 F52) */}
        {view === "closet" && !!ownedItems.length && !visibleItems.length && !searching && activeType !== "wishlist" && activeType !== "dream" && activeType !== "trash" && (
          <p className="status empty">這一類還沒有單品。</p>
        )}
        {view === "closet" && activeType === "dream" && !searching && !visibleItems.length && (
          <p className="status empty">
            夢幻逸品還是空的。很想要、但還沒打算買的放這裡:到「想買的」按「挑幾件移到夢幻逸品」,或新增時選「夢幻逸品」。
            {wishCount > 0 && (
              <>
                <br />
                <button type="button" className="secondary-button" onClick={() => showWishlist("wishlist")}>去想買的挑</button>
              </>
            )}
          </p>
        )}
        {picking && (
          <div className="pick-dock" role="region" aria-label="挑選要搬的衣服">
            <span className="pick-dock-count" aria-live="polite">{picked.size ? `勾了 ${picked.size} 件` : "點衣服勾選"}</span>
            <button type="button" className="secondary-button" onClick={stopPicking} disabled={moving}>取消</button>
            <button type="button" className="primary-button" onClick={movePicked} disabled={!picked.size || moving}>
              {moving ? "搬移中" : activeType === "wishlist" ? "移到夢幻逸品" : "移回想買的"}
            </button>
          </div>
        )}
        {view === "closet" && searching && !visibleItems.length && (
          <p className="status empty search-empty">找不到「{query.trim()}」。試試品牌、顏色或分類,例如「GU」「黑」「短褲」。</p>
        )}
        {view === "closet" && activeType === "trash" && !!trashCount && (
          <TrashGrid items={trashItems} onRestore={restoreItem} onPurge={purgeItem} canPurge={canPurge} />
        )}
        {view === "closet" && !!closetItems.length && activeType !== "trash" && (
          <section className="gallery-grid" aria-label={searching ? `「${query.trim()}」的搜尋結果` : `${activeType === "wishlist" ? "想買的" : activeType === "dream" ? "夢幻逸品的" : activeType === "favorites" ? "最愛的" : brandFilterOf(activeType) !== null ? brandFilterOf(activeType) || "沒寫品牌的" : TYPE_MAP[activeType]?.label || "全部"}衣物`}>
            {visibleItems.map((item) => (
              <GalleryItem
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                onOpen={setSelectedId}
                onDelete={deleteItem}
                favorite={favorites.has(item.id)}
                picking={picking}
                picked={picked.has(item.id)}
                onPick={togglePicked}
              />
            ))}
          </section>
        )}
      </main>

      {CAN_ADD && (
        <AddGarment hideButton replaceRequest={replaceRequest} onReplaced={replaceImage} onAdded={() => {}} />
      )}

      {selectedItem && (
        <ItemViewer
          brandOptions={brandOptions}
          item={selectedItem}
          gone={selectedGone}
          owned={ownedItems}
          onOpen={setSelectedId}
          onWearOutfit={(outfit) => { wearOutfit(outfit); setSelectedId(null); setView("styling"); }}
          onClose={() => setSelectedId(null)}
          onSave={saveItem}
          onDelete={deleteItem}
          onWear={(item) => { wearOutfit({ [item.part]: item }); setSelectedId(null); setView("styling"); }}
          onBought={markBought}
          onSetDream={setDream}
          onSetUrl={setWishUrl}
          onSetPrice={setItemPrice}
          onReplaceImage={CAN_ADD && canEditItem(selectedItem) ? (item) => setReplaceRequest({ item, n: Date.now() }) : null}
          onRestoreImage={restoreOriginalImage}
          favorite={favorites.has(selectedItem.id)}
          onToggleFavorite={onToggleFavorite}
          onMergeAway={canEditItem(selectedItem) ? mergeAway : null}
        />
      )}
    </div>
  );
}
