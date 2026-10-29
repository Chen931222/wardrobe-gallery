// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
/* localWardrobe.js — 使用者自己在網頁上新增的衣物,存在瀏覽器的 IndexedDB。
 *
 * 為什麼是 IndexedDB 而不是 localStorage:去背後的 PNG 動輒數百 KB,
 * localStorage 只有 5MB 且只能存字串,存兩三件就爆掉。IndexedDB 可以直接存 Blob。
 *
 * 這一層只管「使用者自己加的」衣物;離線流程匯入的那批仍然來自 data/library.json,
 * 兩者在 App 裡合併顯示。線上唯讀版也能用這條路新增,因為完全不碰伺服器。 */

import { cleanItem } from "./cleanFields.js";

const DB_NAME = "open-wardrobe-local";
const STORE = "items";
const VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function tx(mode, run, { fromSync = false } = {}) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const store = transaction.objectStore(STORE);
      const request = run(store);
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
    // 給同步用:這台的衣服變了,過幾秒推上去。fromSync = 同步自己把別台的衣服寫進來,不算這台改的
    if (mode === "readwrite" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("wardrobe-local-change", { detail: { fromSync } }));
    }
  }
}

/* iPhone Safari 的地雷(WebKit bug 235687,2026-10-06 本人回報「圖片有時候跑不出來」):
   從 IndexedDB 讀出來的 Blob 原封不動再存回去(改欄位、丟垃圾桶、搬分類都會整筆 put),之後這張圖就讀不到
   (WebKitBlobResource error 1),畫面出現「?」。電腦上的 Chrome 不會,所以自動測試一直沒抓到。兩道防線:
   ① 存回去之前先讀進記憶體做一份新的(updateLocalItem);② 畫面用的網址從記憶體那份做,不指向資料庫裡的檔。 */
async function freshCopy(blob) {
  return new Blob([await blob.arrayBuffer()], { type: blob.type });
}

/* Safari 無痕的地雷(2026-10-21 本人 iPad 無痕實測「存不進去」,按「加入衣櫃」沒反應):
   無痕分頁的 IndexedDB 常常收不下 Blob(WebKit bug 268037、188438:「Error preparing Blob/File data to be
   stored in object store」,Safari 一打開就直接進無痕分頁時最常見,好了又壞了好幾次)。
   存 Blob 失敗就改存原始位元組(ArrayBuffer)＋格式,讀出來再拼回 Blob。所有讀的地方都過 decode,
   呼叫端永遠只看到 record.blob,同步、備份、縮圖都不用改。一般分頁第一次就存成功,格式跟舊版一樣。 */
function decode(record) {
  if (!record || record.blob || !record.bytes) return record;
  const { bytes, blobType, ...rest } = record;
  return { ...rest, blob: new Blob([bytes], { type: blobType || "image/png" }) };
}

async function putRecord(record, options) {
  try {
    await tx("readwrite", (store) => store.put(record), options);
  } catch (error) {
    if (!(record.blob instanceof Blob)) throw error;
    const { blob, ...rest } = record;
    const bytes = await blob.arrayBuffer();
    await tx("readwrite", (store) => store.put({ ...rest, bytes, blobType: blob.type }), options);
  }
}

/* 讀不到的圖用這張代替(不是「?」),點開那件可以「換圖」;開了同步的會從雲端拿回原本那張 */
export const BROKEN_IMAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240"><rect x="1" y="1" width="198" height="238" fill="none" stroke="#5a4c3a" stroke-dasharray="6 6"/>'
  + '<text x="100" y="116" text-anchor="middle" font-family="serif" font-size="17" fill="#9b8c73">圖讀不到</text>'
  + '<text x="100" y="142" text-anchor="middle" font-family="serif" font-size="12" fill="#9b8c73">點開按「換圖」</text></svg>',
)}`;

/* 圖的 object URL 依 id 重用:同步後會常常重讀,每次都新建網址的話,舊的一直不釋放、
   格子和人台上的圖也會整批重新載入。圖換了(大小或格式不同)才換網址,不在清單裡的才釋放。
   網址是從記憶體裡的那份做的(見上面的地雷),所以資料庫那筆被重寫也不會壞。 */
const urlCache = new Map();   // id → { size, type, url, broken }    原圖
const thumbCache = new Map(); // id → { sig, url }                    縮圖(下面)
const sigOf = (blob) => `${blob.size}:${blob.type}`;

async function urlFor(record) {
  const hit = urlCache.get(record.id);
  if (hit && !hit.broken && hit.size === record.blob.size && hit.type === record.blob.type) return hit;
  if (hit?.url) URL.revokeObjectURL(hit.url);
  let next;
  try {
    next = { size: record.blob.size, type: record.blob.type, url: URL.createObjectURL(await freshCopy(record.blob)), broken: false };
  } catch {
    next = { size: record.blob.size, type: record.blob.type, url: null, broken: true };
  }
  urlCache.set(record.id, next);
  return next;
}

/* 縮圖與原圖分開(2026-10-06 本人回報「載入有點慢、有時候卡卡的」):
   格子、圓環、衣架上一格只有 ~170px 寬,舊版直接放原圖(長邊 1400px 上下的 PNG,一張動輒 1MB),
   打開時還要把每一張原圖讀進記憶體(上面的地雷②)。實測(Chromium、CPU 慢 4 倍):100 件自己加的衣服
   打開到看到衣櫃 1.1–1.8 秒,1 件時 0.3 秒;光是把原圖讀進記憶體就佔 0.5 秒,而且件數越多越慢。
   現在:格子用長邊 460px 的縮圖(跟站主衣櫃的縮圖一樣大),存在另一個資料庫 —— 衣服那個資料庫不動,
   同步、備份都碰不到;縮圖不見了、或圖換過,就從原圖重做一張。原圖等真的要用(點開那件、穿上人台、
   做穿搭卡)才讀進記憶體:清單裡的 image 先放縮圖、標 fullImageId,要原圖的地方用 useFullImage.js。 */
const THUMB_DB = "open-wardrobe-thumbs";
const THUMB_STORE = "thumbs";
const THUMB_SIDE = 460;

function thumbTx(mode, run) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(THUMB_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(THUMB_STORE)) request.result.createObjectStore(THUMB_STORE, { keyPath: "id" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      try {
        const transaction = db.transaction(THUMB_STORE, mode);
        const result = run(transaction.objectStore(THUMB_STORE));
        transaction.oncomplete = () => { db.close(); resolve(result?.result); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      } catch (error) {
        db.close();
        reject(error);
      }
    };
  });
}

async function readThumbs() {
  try {
    return new Map(((await thumbTx("readonly", (store) => store.getAll())) || []).map((thumb) => [thumb.id, thumb]));
  } catch {
    return new Map();   // 縮圖的資料庫打不開:全部當作沒有,用原圖(跟舊版一樣)
  }
}

/** 縮圖的網址。也從記憶體那份做(縮圖小,一件幾十 KB);沒有、跟原圖對不上、讀不到 → null,改用原圖並重做 */
async function thumbUrl(id, sig, stored) {
  const hit = thumbCache.get(id);
  if (hit && hit.sig === sig) return hit.url;
  if (!stored?.blob || stored.sig !== sig) return null;
  try {
    const url = URL.createObjectURL(await freshCopy(stored.blob));
    if (hit) URL.revokeObjectURL(hit.url);
    thumbCache.set(id, { sig, url });
    return url;
  } catch {
    return null;
  }
}

async function makeThumb(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, THUMB_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // WebP 小很多;iPhone 的 Safari 做不出 WebP,會默默給 PNG(看 type 才知道),那就用 PNG
    const webp = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.86));
    if (webp?.type === "image/webp") return webp;
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  } finally {
    bitmap.close?.();
  }
}

/* 背景做縮圖:一次一張、每張之間讓出主執行緒;做好的最多每 4 秒通知一次(wardrobe-thumbs-ready),App 重讀,
   格子一批批換成縮圖。這次打開做不出來的(原圖讀不到)記著,不一直重試。 */
const thumbWanted = new Map();   // id → record
const thumbFailed = new Set();
let thumbBusy = null;            // 正在做的那件
let thumbWork = null;

function scheduleThumbs(records) {
  for (const record of records) {
    if (record.id !== thumbBusy && !thumbFailed.has(record.id)) thumbWanted.set(record.id, record);
  }
  if (thumbWork || !thumbWanted.size) return;
  thumbWork = (async () => {
    let made = 0, told = Date.now();
    const tell = () => { made = 0; told = Date.now(); window.dispatchEvent(new Event("wardrobe-thumbs-ready")); };
    while (thumbWanted.size) {
      const [id, record] = thumbWanted.entries().next().value;
      thumbWanted.delete(id);
      thumbBusy = id;
      try {
        const blob = await makeThumb(record.blob);
        if (!blob) throw new Error("做不出縮圖");
        await thumbTx("readwrite", (store) => store.put({ id, sig: sigOf(record.blob), blob }));
        made += 1;
      } catch {
        thumbFailed.add(id);
      }
      thumbBusy = null;
      if (made && Date.now() - told > 4000) tell();
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    if (made) tell();
  })().finally(() => {
    thumbWork = null;
    if (thumbWanted.size) scheduleThumbs([]);
  });
}

/** 讀出全部本機衣物,轉成和伺服器格式一致的物件(image、thumbnail 為 object URL)。
 *  讀不到回 null,不是 []:呼叫端要分得出「沒有衣服」和「這次讀不到」,不然會把畫面上的衣服清光。 */
export async function loadLocalItems() {
  if (typeof indexedDB === "undefined") return [];
  try {
    // 備份、同步帶進來的紀錄型別可能不對(2026-10-26 破壞測試):id 不是字的讀不到也刪不掉,略過;其他欄位整理過再給畫面
    const [records, thumbs] = await Promise.all([tx("readonly", (store) => store.getAll()).then((list) => (list || []).map(decode).filter((record) => typeof record?.id === "string").map(cleanItem)), readThumbs()]);
    const ids = new Set(records.map((record) => record.id));
    for (const cache of [urlCache, thumbCache]) {
      for (const [id, hit] of cache) {
        if (!ids.has(id)) { if (hit.url) URL.revokeObjectURL(hit.url); cache.delete(id); }
      }
    }
    const orphans = [...thumbs.keys()].filter((id) => !ids.has(id));
    if (orphans.length) thumbTx("readwrite", (store) => { orphans.forEach((id) => store.delete(id)); }).catch(() => {});
    const missing = [];
    const items = await Promise.all(records.map(async (record) => {
      if (!record.blob) return { ...record, image: BROKEN_IMAGE, thumbnail: BROKEN_IMAGE, imageBroken: true, isLocal: true };
      const full = urlCache.get(record.id);
      const fullReady = full && !full.broken && full.size === record.blob.size && full.type === record.blob.type;
      const thumb = await thumbUrl(record.id, sigOf(record.blob), thumbs.get(record.id));
      if (thumb) {
        // 原圖這次已經讀過就直接給;還沒讀過先拿縮圖頂著
        return { ...record, image: fullReady ? full.url : thumb, thumbnail: thumb, ...(fullReady ? {} : { fullImageId: record.id }), isLocal: true };
      }
      // 還沒有縮圖(剛加的、這版之前加的、換過圖的):跟舊版一樣用原圖,背景做縮圖
      if (!thumbFailed.has(record.id)) missing.push(record);
      const { url, broken } = await urlFor(record);
      const image = broken ? BROKEN_IMAGE : url;
      return { ...record, image, thumbnail: image, ...(broken ? { imageBroken: true } : {}), isLocal: true };
    }));
    if (missing.length) scheduleThumbs(missing);
    return items;
  } catch {
    return null;
  }
}

/** 一件自己加的衣服的原圖網址,要用時才讀進記憶體(同一件同時要好幾次只讀一次)。讀不到回 null,呼叫的地方繼續用縮圖。 */
const fullPending = new Map();
export function localFullImage(id) {
  if (!fullPending.has(id)) {
    fullPending.set(id, (async () => {
      const record = await readLocalRecord(id);
      if (!record?.blob) return null;
      const { url, broken } = await urlFor(record);
      return broken ? null : url;
    })().catch(() => null).finally(() => fullPending.delete(id)));
  }
  return fullPending.get(id);
}

export async function saveLocalItem({ id, name, part, color, secondaryColor, tags, blob, wishlist, dream, sourceUrl, price, priceCurrency, brand, partGuessed = false, standIn = false }) {
  await putRecord({
    id, name, part, color, secondaryColor: secondaryColor || null,
    tags: tags || [], blob, createdAt: new Date().toISOString(),
    wishlist: Boolean(wishlist), sourceUrl: sourceUrl || null,
    // 夢想區(2026-10-08):想買的裡面另一層,很想要、還沒打算買。只有還沒買的才有
    ...(wishlist && dream ? { dream: true } : {}),
    price: price ?? null, priceCurrency: price ? priceCurrency || "TWD" : null,
    // 品牌:新增時填的或商品連結讀到的;沒填就不存這個欄位,之後看品名、網址猜(brands.js)
    ...(brand ? { brand } : {}),
    // 分類是猜的(2026-10-21,分類改選填):衣櫃格子標一下,點開那件改分類就清掉
    ...(partGuessed ? { partGuessed: true } : {}),
    // 代表款(2026-10-29,src/standIns.js):不是自己拍的,是示範衣櫃同一類換色;衣櫃格子標「代表款」,換圖就清掉
    ...(standIn ? { standIn: true } : {}),
  });
}

/** 只留 http(s) 網址,其他(javascript: 之類)一律丟掉,因為之後會被放進 <a href>。 */
export function cleanUrl(text) {
  try {
    const url = new URL(String(text || "").trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** 從一段文字裡找出網址:整段就是網址、分享文字裡夾著網址(「【GU】寬版牛仔褲 https://…」)、
 *  或少了 https:// 的(「m.gu-global.com/tw/product?pid=…」)都認。找不到回 null。 */
export function findUrl(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const direct = cleanUrl(raw);
  if (direct) return direct;
  const withScheme = raw.match(/https?:\/\/[^\s<>"'「」【】()（）]+/i);
  if (withScheme) return cleanUrl(withScheme[0]);
  const bare = raw.match(/(?:^|\s)((?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>"'「」【】()（）]*)/i);
  return bare ? cleanUrl(`https://${bare[1]}`) : null;
}

/** 商品網址欄的錯誤訊息,沒問題回空字串。剪貼簿常常還留著衣櫃自己的網址(開 ?edit 時拷的),
 *  貼進來看起來像網址、點了卻回到衣櫃,所以要擋。 */
export function productUrlProblem(text) {
  if (!String(text || "").trim()) return "";
  const url = findUrl(text);
  if (!url) return "這裡找不到網址。到品牌的商品頁按分享、拷貝連結再貼";
  if (typeof window !== "undefined" && new URL(url).host === window.location.host) {
    return "這是衣櫃自己的網址。到品牌的商品頁按分享、拷貝連結再貼";
  }
  return "";
}

/** 依正規化 0–1 的框裁切照片;截圖裡的狀態列、價格字樣不裁掉,去背會一起留下來。 */
export async function cropBlob(file, box) {
  const bitmap = await createImageBitmap(file);
  const sx = Math.round(box.x * bitmap.width);
  const sy = Math.round(box.y * bitmap.height);
  const sw = Math.max(1, Math.round(box.w * bitmap.width));
  const sh = Math.max(1, Math.round(box.h * bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export async function updateLocalItem(id, patch) {
  const record = decode(await tx("readonly", (store) => store.get(id)));
  if (!record) return;
  const next = { ...record, ...patch };
  // 圖沒換的話,先讀進記憶體做一份新的再存(WebKit bug 235687:讀出來的 Blob 原封不動存回去,之後就讀不到)。
  // 已經讀不到的就照舊存回去,不會更糟;開了同步的話,下次同步會從雲端拿回來
  if (!("blob" in patch) && record.blob) {
    try { next.blob = await freshCopy(record.blob); } catch { /* 已經壞了 */ }
  }
  await putRecord(next);
}

export async function deleteLocalItem(id, options) {
  await tx("readwrite", (store) => store.delete(id), options);
}

/** 讀一件的原始 record(含 blob);沒有就 undefined。同步寫回前用來確認這件在同步途中有沒有被改過。 */
export async function readLocalRecord(id) {
  return decode(await tx("readonly", (store) => store.get(id)));
}

/** 備份匯出用:讀原始 record(含 blob),不像 loadLocalItems 轉成 objectURL。 */
export async function dumpLocalRecords() {
  if (typeof indexedDB === "undefined") return [];
  try { return ((await tx("readonly", (store) => store.getAll())) || []).map(decode); }
  catch { return []; }
}

/** 同步用:讀不到就丟錯。不能像 dumpLocalRecords 那樣回空陣列——同步會把「空的」當成「這台把衣服全刪了」,
 *  再把刪除推到雲端和其他裝置。 */
export async function readLocalRecords() {
  if (typeof indexedDB === "undefined") throw new Error("這個瀏覽器不能存衣服,先不同步");
  try {
    return ((await tx("readonly", (store) => store.getAll())) || []).map(decode);
  } catch {
    throw new Error("讀不到這台存的衣服,先不同步(免得把雲端當成全刪了)");
  }
}

/** 備份匯入用:把原始 record(含 blob)寫回 IndexedDB。 */
export async function putLocalRecord(record, options) {
  await putRecord(record, options);
}

/* ---------- 影像處理:去背後的收尾 ---------- */

/** 裁掉四周全透明的邊,並留一點內距 —— 和 Node 端 tools/cutout-one.mjs 的 trim 行為對齊,
 *  這樣網頁新增的衣物和離線匯入的擺在一起才不會大小不一。 */
export async function trimTransparent(blob, maxSize = 1400) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      // 門檻 12→24(2026-10-25):商品圖整張去背,角落的品牌標誌會留一層幾乎看不見的殘影(alpha 最高 14),
      // 框就被撐到整張圖、衣服縮在一角。24 以下肉眼看不到;只是框收緊,像素不刪,外面還留 3% 邊
      if (data[((y * canvas.width) + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { blob, width: bitmap.width, height: bitmap.height };

  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.03);
  const sx = Math.max(0, minX - pad);
  const sy = Math.max(0, minY - pad);
  const sw = Math.min(canvas.width - sx, (maxX - minX) + 1 + (pad * 2));
  const sh = Math.min(canvas.height - sy, (maxY - minY) + 1 + (pad * 2));

  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  const out = document.createElement("canvas");
  out.width = Math.round(sw * scale);
  out.height = Math.round(sh * scale);
  out.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, out.width, out.height);

  const trimmed = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
  return { blob: trimmed, width: out.width, height: out.height };
}

async function pixelsOf(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  return { canvas, context, image: context.getImageData(0, 0, canvas.width, canvas.height) };
}

/** 補回被去背挖掉的淺色條紋。
 *
 *  去背模型分不出「米白」和「淺灰棚拍底」:GU 橘／米白條紋 T 的米白條紋整條被挖空,
 *  換最大的 isnet 模型也一樣(2026-10-01 實測,兩者不透明比例都是 19.8%)。
 *  補法:一段透明的縫,上下(或左右)兩端都是衣服、長度不超過圖的 8%,而且原圖在那裡的顏色
 *  明顯不是背景色,就從原圖把顏色補回來。腋下、褲襠那種長縫和真正的背景都不會被補。
 *  只在四邊是單色底(品牌平拍)時才做;截圖四周雜亂,直接原樣回傳。 */
export async function refillGaps(originalBlob, cutBlob) {
  const original = await pixelsOf(originalBlob);
  const cut = await pixelsOf(cutBlob);
  const { width: W, height: H } = cut.canvas;
  if (original.canvas.width !== W || original.canvas.height !== H) return cutBlob;
  const src = original.image.data;
  const out = cut.image.data;

  // 背景色:四邊像素的平均;太雜就不是棚拍底,不補
  let sum = [0, 0, 0], count = 0;
  const border = [];
  const step = Math.max(1, Math.floor(Math.min(W, H) / 200));
  for (let x = 0; x < W; x += step) border.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y += step) border.push(y * W, y * W + W - 1);
  for (const p of border) { for (let c = 0; c < 3; c += 1) sum[c] += src[p * 4 + c]; count += 1; }
  const bg = sum.map((value) => value / count);
  const distance = (p) => Math.hypot(src[p * 4] - bg[0], src[p * 4 + 1] - bg[1], src[p * 4 + 2] - bg[2]);
  const noisy = border.filter((p) => distance(p) > 18).length / border.length;
  if (noisy > 0.05) return cutBlob;

  const solid = (p) => out[p * 4 + 3] >= 128;
  const fill = new Uint8Array(W * H);
  const maxGap = Math.round(Math.max(W, H) * 0.08);
  const scan = (length, lines, index) => {
    for (let line = 0; line < lines; line += 1) {
      let lastSolid = -1;
      for (let i = 0; i < length; i += 1) {
        if (!solid(index(line, i))) continue;
        const gap = i - lastSolid - 1;
        if (lastSolid >= 0 && gap > 0 && gap <= maxGap) {
          for (let j = lastSolid + 1; j < i; j += 1) fill[index(line, j)] = 1;
        }
        lastSolid = i;
      }
    }
  };
  scan(H, W, (x, y) => y * W + x); // 直向:橫條紋
  scan(W, H, (y, x) => y * W + x); // 橫向:直條紋

  let filled = 0;
  for (let p = 0; p < W * H; p += 1) {
    if (!fill[p] || distance(p) <= 30) continue;
    out[p * 4] = src[p * 4];
    out[p * 4 + 1] = src[p * 4 + 1];
    out[p * 4 + 2] = src[p * 4 + 2];
    out[p * 4 + 3] = 255;
    filled += 1;
  }
  if (!filled) return cutBlob;
  cut.context.putImageData(cut.image, 0, 0);
  return new Promise((resolve) => cut.canvas.toBlob(resolve, "image/png"));
}

/** 取出衣物的主色和副色。
 *
 *  舊版把所有像素的 RGB 平均:深藍和橄欖綠的條紋衣,主色變成衣服上沒有的灰紫 #4D474B,
 *  被誤判成跟灰色衣服「同色」,副色也偵測不到(審查 F20)。改成先把像素分成色群:
 *  最大的那群當主色;第二群夠大(≥18%)、又跟主色差得夠遠,才當副色。
 *  只看完全不透明的像素:去背邊緣半透明的那圈混著背景和陰影,會被抓成一個假的副色。 */
export async function garmentColors(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, 64, 64);
  const { data } = context.getImageData(0, 0, 64, 64);

  const collect = (minAlpha) => {
    const buckets = new Map();
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < minAlpha) continue;
      const key = ((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5);   // 每色 8 階
      const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0 };
      bucket.r += data[i]; bucket.g += data[i + 1]; bucket.b += data[i + 2]; bucket.count += 1;
      buckets.set(key, bucket);
      total += 1;
    }
    return { buckets, total };
  };
  // 很小或很細的單品(手環、鞋帶)縮到 64×64 後幾乎沒有全不透明的像素,退一步收半透明的
  let { buckets, total } = collect(250);
  if (total < 40) ({ buckets, total } = collect(160));
  if (!total) return { color: "#9a9286", secondaryColor: null };

  const mean = (group) => ({ r: group.r / group.count, g: group.g / group.count, b: group.b / group.count });
  const gap = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  // 由多到少,每一格併進離它最近、在 48 以內的色群,不然自己開一群
  const clusters = [];
  for (const bucket of [...buckets.values()].sort((a, b) => b.count - a.count)) {
    const center = mean(bucket);
    const home = clusters.find((cluster) => gap(mean(cluster), center) < 48);
    if (home) { home.r += bucket.r; home.g += bucket.g; home.b += bucket.b; home.count += bucket.count; }
    else clusters.push({ ...bucket });
  }
  clusters.sort((a, b) => b.count - a.count);
  const hex = ({ r, g, b }) => `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
  const primary = mean(clusters[0]);
  const second = clusters.slice(1).find((cluster) => cluster.count / total >= 0.18 && gap(mean(cluster), primary) >= 60);
  return { color: hex(primary), secondaryColor: second ? hex(mean(second)) : null };
}

/** 雲端一張圖的上限是 3MB,加密前留一點餘裕。新增時和同步前都用這條線把圖縮小(審查 F5)。 */
export const SYNC_IMAGE_LIMIT = 2.5 * 1024 * 1024;

/** 圖超過 limit 就縮小長邊重存 PNG(不用 WebP:iOS 的 canvas.toBlob 不支援,會默默退回 PNG)。沒超過原樣回傳。 */
export async function shrinkImage(blob, limit = SYNC_IMAGE_LIMIT) {
  if (!blob || blob.size <= limit) return blob;
  const bitmap = await createImageBitmap(blob);
  let smallest = blob;
  for (const side of [1100, 900, 700]) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const out = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (out && out.size < smallest.size) smallest = out;
    if (out && out.size <= limit) return out;
  }
  return smallest;
}

/** 沒選分類時,看去背後的形狀猜一個 —— 只是預設值,衣櫃格子會標「分類是猜的」,點開改。
 *  2026-10-26 改(本人:吊著拍的帽 T 被猜成下身):舊版只看長寬比,「高的當褲子、方的當鞋子」,
 *  拿站主衣櫃 104 件實測,上衣 52 件錯 36 件(直長的帽 T、長袖猜成下身,平放的短袖 T 猜成鞋子),短褲 11 件錯 9 件。
 *  新的門檻是拿同一批調的(上衣、下身、鞋、外套 98 件對 95 件),沒有另外一批驗過;站主衣櫃沒有裙子,裙子那條只對過畫出來的剪影。
 *  現在把透明度縮成 64 寬的遮罩,量衣服本身(不含透明邊)的形狀:
 *  - 下半截中間有一道縫:褲管,或一雙鞋;鞋的縫一路通到最上面,褲子上面是褲頭連著。
 *    不過寬高差不多的(0.75–0.97)是外套敞開的前襟,不算褲管
 *  - 裙子:腰頭是平的(最上面就有一半寬、到 10% 高度幾乎不變),往下慢慢變寬,下襬最寬;
 *    上衣在肩膀、袖子那段(10%–30%)會一下子寬很多
 *  - 很窄(寬不到高的 0.52):長褲
 *  - 寬的(平放的短袖 T、短褲):最寬那一列在下半截是褲管,在上半截是袖子。
 *    平放的外套也常是上窄下寬,所以還要有褲子的樣子:下半截有縫,或最上面幾列分成兩塊以上(褲頭兩端、抽繩、腰扣)。
 *    2026-10-28 本人 iPad 那件外套、站主 13 件外套裡 2 件原本落在這條變下身;外套最上面是一塊領子、下半截縫最多 0.07,
 *    走到這條的 12 件短褲不是縫 ≥ 0.29 就是最上面分兩塊。同一批調的,門檻離短褲只差一格雜點,沒有另一批驗
 *  - 寬的而且上面那段偏一邊:側拍的一隻鞋(鞋口在腳跟那側);短褲的褲頭、T 恤的領口在正中間。
 *    靴子、高筒鞋寬高差不多,最寬的是鞋底,不先擋掉會被下一條當成短褲(2026-10-26 驗收)
 *    (推論:104 件裡沒有側拍單隻鞋的照片,只對過畫出來的剪影;衣服偏離中線最多 0.07,畫的鞋 0.28)。
 *    不用「很扁就是鞋」:橫著拍的衣服(整件轉 90 度)也很扁,站主的灰帽 T 照片就被這樣猜成鞋
 *  - 很扁(寬是高的 2 倍以上)又不像側拍的鞋:皮帶。2026-10-28 本人 iPad 上一條捲起來的皮帶被猜成下身,
 *    衣櫃裡就算多了一件「下身」,配出來是拿皮帶當褲子。站主 104 件最扁的是短褲、包 1.43,截圖剪出來的皮帶約 2.9。
 *    推論:橫著拍的長褲(轉 90 度約 2.2–2.5)、平放的墨鏡也會落在這裡;猜錯也只是配件,不會被當成褲子穿上去
 *  - 其他當上衣;外套也落在這裡(形狀分不出外套,上衣最接近)
 *  讀不到圖回 null,呼叫的那邊當上衣 */
export function guessPart(bitmap) {
  const W = 64;
  const H = Math.max(8, Math.round((bitmap.height / bitmap.width) * W));
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });   // 不用 OffscreenCanvas:iOS 16.4 以前沒有
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0, W, H);
  const alpha = context.getImageData(0, 0, W, H).data;
  return guessPartFromMask((x, y) => alpha[(y * W + x) * 4 + 3] > 128, W, H);
}

/** guessPart 的判斷本身:on(x, y) = 那一格有沒有衣服。分開寫,實測腳本才能直接拿遮罩跑 */
export function guessPartFromMask(on, W, H) {
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (on(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return null;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const ratio = bw / bh;
  const rowAt = (f) => y0 + Math.min(bh - 1, Math.round(f * (bh - 1)));
  const span = (y) => { let l = -1, r = -1; for (let x = x0; x <= x1; x++) if (on(x, y)) { if (l < 0) l = x; r = x; } return l < 0 ? 0 : r - l + 1; };
  // 這一列中間(30%–70%)有沒有一段空的,而且左右兩邊都有東西
  const L = x0 + Math.round(bw * 0.3), R = x0 + Math.round(bw * 0.7);
  const centerGap = (y) => {
    let left = false, right = false, gap = false;
    for (let x = x0; x < L; x++) if (on(x, y)) left = true;
    for (let x = R + 1; x <= x1; x++) if (on(x, y)) right = true;
    for (let x = L; x <= R; x++) if (!on(x, y)) gap = true;
    return left && right && gap;
  };
  const gapShare = (from, to, step) => { let hit = 0, n = 0; for (let f = from; f <= to + 1e-9; f += step) { n += 1; if (centerGap(rowAt(f))) hit += 1; } return hit / n; };
  const lowGap = gapShare(0.7, 0.96, 0.02);    // 下半截:褲管、兩隻鞋
  const topGap = gapShare(0.05, 0.3, 0.025);   // 上面:鞋才有縫,褲子是褲頭
  const widthAt = (f) => span(rowAt(f)) / bw;
  const [w3, w10, w30, w50, w95] = [0.03, 0.1, 0.3, 0.5, 0.95].map(widthAt);
  const skirt = w3 >= 0.5 && w10 - w3 <= 0.12 && w30 - w10 <= 0.14 && w95 >= w50 + 0.05 && w95 >= 0.9;
  // 上面那段(10%–25% 高度)的中點偏離整件中線多少,對寬
  let drift = 0;
  for (const f of [0.1, 0.15, 0.2, 0.25]) {
    const y = rowAt(f);
    let l = -1, r = -1;
    for (let x = x0; x <= x1; x++) if (on(x, y)) { if (l < 0) l = x; r = x; }
    if (l >= 0) drift += Math.abs((l + r) / 2 - (x0 + x1) / 2) / bw / 4;
  }
  let widest = 0, widestAt = 0;
  for (let f = 0; f <= 1 + 1e-9; f += 0.02) { const w = span(rowAt(f)); if (w > widest) { widest = w; widestAt = f; } }
  // 最上面 4 列最多分成幾塊(空 2 格以上才算斷開,去背邊緣的雜點不算)
  const pieces = (y) => { let n = 0, inside = false, run = 0; for (let x = x0; x <= x1; x++) { if (on(x, y)) { if (!inside) n += 1; inside = true; run = 0; } else if (++run >= 2) inside = false; } return n; };
  let topPieces = 0;
  for (let y = y0; y <= Math.min(y1, y0 + 3); y++) topPieces = Math.max(topPieces, pieces(y));

  if (lowGap >= 0.6 && topGap >= 0.5) return "shoes";
  if (ratio >= 2 && drift < 0.18) return "belt";
  if (lowGap >= 0.5 && (ratio < 0.75 || ratio > 0.97)) return "lowerbody";
  if (skirt) return "lowerbody";
  if (ratio < 0.52) return "lowerbody";
  if (ratio > 0.97 && drift >= 0.18) return "shoes";
  if (ratio > 0.97 && widestAt >= 0.6 && (lowGap >= 0.2 || topPieces >= 2)) return "lowerbody";
  return "upperbody";
}
