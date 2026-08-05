// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
/* localWardrobe.js — 使用者自己在網頁上新增的衣物,存在瀏覽器的 IndexedDB。
 *
 * 為什麼是 IndexedDB 而不是 localStorage:去背後的 PNG 動輒數百 KB,
 * localStorage 只有 5MB 且只能存字串,存兩三件就爆掉。IndexedDB 可以直接存 Blob。
 *
 * 這一層只管「使用者自己加的」衣物;Claude 匯入的那批仍然來自 data/library.json,
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

async function tx(mode, run) {
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
  }
}

/** 讀出全部本機衣物,轉成和伺服器格式一致的物件(image 為 object URL)。 */
export async function loadLocalItems() {
  if (typeof indexedDB === "undefined") return [];
  try {
    const records = await tx("readonly", (store) => store.getAll());
    return (records || []).map((record) => ({
      ...record,
      image: URL.createObjectURL(record.blob),
      thumbnail: URL.createObjectURL(record.blob),
      isLocal: true,
    }));
  } catch {
    return [];
  }
}

export async function saveLocalItem({ id, name, part, color, secondaryColor, tags, blob }) {
  await tx("readwrite", (store) => store.put({
    id, name, part, color, secondaryColor: secondaryColor || null,
    tags: tags || [], blob, createdAt: new Date().toISOString(),
  }));
}

export async function deleteLocalItem(id) {
  await tx("readwrite", (store) => store.delete(id));
}

/* ---------- 影像處理:去背後的收尾 ---------- */

/** 裁掉四周全透明的邊,並留一點內距 —— 和 Node 端 tools/cutout-one.mjs 的 trim 行為對齊,
 *  這樣網頁新增的衣物和 Claude 匯入的擺在一起才不會大小不一。 */
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
