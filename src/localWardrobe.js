// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
/* localWardrobe.js — 使用者自己在網頁上新增的衣物,存在瀏覽器的 IndexedDB。
 *
 * 為什麼是 IndexedDB 而不是 localStorage:去背後的 PNG 動輒數百 KB,
 * localStorage 只有 5MB 且只能存字串,存兩三件就爆掉。IndexedDB 可以直接存 Blob。
 *
 * 這一層只管「使用者自己加的」衣物;離線流程匯入的那批仍然來自 data/library.json,
 * 兩者在 App 裡合併顯示。線上唯讀版也能用這條路新增,因為完全不碰伺服器。 */

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

/* 圖的 object URL 依 id 重用:同步後會常常重讀,每次都新建網址的話,舊的一直不釋放、
   格子和人台上的圖也會整批重新載入。圖換了(大小或格式不同)才換網址,不在清單裡的才釋放。 */
const urlCache = new Map();   // id → { size, type, url }

function urlFor(record) {
  const hit = urlCache.get(record.id);
  if (hit && hit.size === record.blob.size && hit.type === record.blob.type) return hit.url;
  if (hit) URL.revokeObjectURL(hit.url);
  const url = URL.createObjectURL(record.blob);
  urlCache.set(record.id, { size: record.blob.size, type: record.blob.type, url });
  return url;
}

/** 讀出全部本機衣物,轉成和伺服器格式一致的物件(image 為 object URL)。
 *  讀不到回 null,不是 []:呼叫端要分得出「沒有衣服」和「這次讀不到」,不然會把畫面上的衣服清光。 */
export async function loadLocalItems() {
  if (typeof indexedDB === "undefined") return [];
  try {
    const records = (await tx("readonly", (store) => store.getAll())) || [];
    const ids = new Set(records.map((record) => record.id));
    for (const [id, hit] of urlCache) {
      if (!ids.has(id)) { URL.revokeObjectURL(hit.url); urlCache.delete(id); }
    }
    return records.map((record) => {
      const url = urlFor(record);
      return { ...record, image: url, thumbnail: url, isLocal: true };
    });
  } catch {
    return null;
  }
}

export async function saveLocalItem({ id, name, part, color, secondaryColor, tags, blob, wishlist, sourceUrl }) {
  await tx("readwrite", (store) => store.put({
    id, name, part, color, secondaryColor: secondaryColor || null,
    tags: tags || [], blob, createdAt: new Date().toISOString(),
    wishlist: Boolean(wishlist), sourceUrl: sourceUrl || null,
  }));
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

/** 商品網址欄的錯誤訊息,沒問題回空字串。剪貼簿常常還留著衣櫃自己的網址(開 ?edit 時拷的),
 *  貼進來看起來像網址、點了卻回到衣櫃,所以要擋。 */
export function productUrlProblem(text) {
  if (!String(text || "").trim()) return "";
  const url = cleanUrl(text);
  if (!url) return "這不是網址,要 https:// 開頭";
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
  const record = await tx("readonly", (store) => store.get(id));
  if (record) await tx("readwrite", (store) => store.put({ ...record, ...patch }));
}

export async function deleteLocalItem(id, options) {
  await tx("readwrite", (store) => store.delete(id), options);
}

/** 讀一件的原始 record(含 blob);沒有就 undefined。同步寫回前用來確認這件在同步途中有沒有被改過。 */
export async function readLocalRecord(id) {
  return tx("readonly", (store) => store.get(id));
}

/** 備份匯出用:讀原始 record(含 blob),不像 loadLocalItems 轉成 objectURL。 */
export async function dumpLocalRecords() {
  if (typeof indexedDB === "undefined") return [];
  try { return (await tx("readonly", (store) => store.getAll())) || []; }
  catch { return []; }
}

/** 同步用:讀不到就丟錯。不能像 dumpLocalRecords 那樣回空陣列——同步會把「空的」當成「這台把衣服全刪了」,
 *  再把刪除推到雲端和其他裝置。 */
export async function readLocalRecords() {
  if (typeof indexedDB === "undefined") throw new Error("這個瀏覽器不能存衣服,先不同步");
  try {
    return (await tx("readonly", (store) => store.getAll())) || [];
  } catch {
    throw new Error("讀不到這台存的衣服,先不同步(免得把雲端當成全刪了)");
  }
}

/** 備份匯入用:把原始 record(含 blob)寫回 IndexedDB。 */
export async function putLocalRecord(record, options) {
  await tx("readwrite", (store) => store.put(record), options);
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
      if (data[((y * canvas.width) + x) * 4 + 3] > 12) {
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

/** 取出衣物的代表色(略過透明與極端明暗的像素,避免抓到陰影或反光)。 */
export async function dominantColor(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, 64, 64);
  const { data } = context.getImageData(0, 0, 64, 64);

  let red = 0, green = 0, blue = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const luma = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
    if (luma < 18 || luma > 242) continue;
    red += data[i]; green += data[i + 1]; blue += data[i + 2]; count += 1;
  }
  if (!count) return "#9a9286";
  const hex = (value) => Math.round(value / count).toString(16).padStart(2, "0");
  return `#${hex(red)}${hex(green)}${hex(blue)}`;
}

/** 依長寬比猜分類 —— 只是預設值,使用者可以在對話框改。 */
export function guessPart(width, height) {
  const ratio = width / height;
  if (ratio > 1.25) return "lowerbody";   // 橫躺的多半是褲子
  if (ratio > 0.95) return "shoes";
  if (ratio > 0.78) return "upperbody";
  return "lowerbody";
}
