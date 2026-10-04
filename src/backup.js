// [本 fork 新增] 備份/還原:把這台瀏覽器裡的衣櫃紀錄打包成一個檔,方便在 PC 與 iPhone 之間搬,
// 或防 iOS 對久未造訪的網站清掉 storage。涵蓋所有 open-wardrobe-* 的 localStorage(穿著紀錄、收藏、
// 微調、編輯、隱藏、身上這套)＋ 自己在網頁加的衣服(IndexedDB,含去背圖)。全程本機,零上傳。
//
// 2026-10-04 起匯出成 ZIP(本人要的):「衣櫃備份.json」放紀錄,「衣服/品名.png」每件一張去背圖,
// 解開就能直接拿圖去用;同一個 ZIP 也能「匯入」。舊的 .json 備份(圖用 base64 塞在 JSON 裡)照樣能匯入。
import { dumpLocalRecords, putLocalRecord } from "./localWardrobe.js";
import { createZip, isZip, readZip } from "./zip.js";

const FORMAT = "open-wardrobe-backup";
const LS_PREFIX = "open-wardrobe-";
const SYNC_PREFIX = "open-wardrobe-sync-";
// 「這台的去背模型已經下載過」只對這台成立;帶到新裝置會把「第一次要下載 80MB」的提示藏掉
const DEVICE_ONLY = new Set(["open-wardrobe-bgmodel-v1"]);
const JSON_NAME = "衣櫃備份.json";

function collectLocal() {
  const local = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    // 同步碼不進備份檔:檔案傳來傳去,碼跟著外流就等於把衣櫃交出去
    if (key && key.startsWith(LS_PREFIX) && !key.startsWith(SYNC_PREFIX) && !DEVICE_ONLY.has(key)) local[key] = localStorage.getItem(key);
  }
  return local;
}

/* 檔名:拿品名,去掉檔案系統不收的字,太長截掉;同名的加 -2、-3 */
function fileNameFor(name, used) {
  const base = (String(name || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim() || "單品").slice(0, 50);
  let candidate = base, n = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${base}-${n++}`;
  used.add(candidate.toLowerCase());
  return `衣服/${candidate}.png`;
}

/* 自己加的衣服幾乎都是去背後存的 PNG;不是的(很舊的資料、別處匯入的)轉成 PNG,解開才都能直接用 */
async function asPng(blob) {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** 收集這台瀏覽器的全部衣櫃紀錄,打包成 ZIP Blob。 */
export async function buildBackupZip() {
  const records = await dumpLocalRecords();
  const used = new Set();
  const files = [];
  const items = [];
  for (const { blob, ...rest } of records) {
    let imageFile = null;
    if (blob) {
      imageFile = fileNameFor(rest.name, used);
      files.push({ name: imageFile, data: new Uint8Array(await (await asPng(blob)).arrayBuffer()) });
    }
    items.push({ ...rest, imageFile });
  }
  const json = { format: FORMAT, version: 2, exportedAt: new Date().toISOString(), local: collectLocal(), items };
  return { zip: createZip([{ name: JSON_NAME, data: new TextEncoder().encode(JSON.stringify(json, null, 1)) }, ...files]), count: files.length };
}

/** 觸發下載備份 ZIP(檔名帶日期)。回傳裡面有幾張衣服的圖。 */
export async function downloadBackupZip() {
  const { zip, count } = await buildBackupZip();
  const url = URL.createObjectURL(zip);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `wardrobe-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);   // iPhone 要等它真的開始下載才能釋放,立刻釋放會下載失敗
  return count;
}

/** 讀使用者選的備份檔(.zip 或舊的 .json):回 { backup, files }。 */
export async function readBackupFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isZip(bytes)) return { backup: JSON.parse(new TextDecoder().decode(bytes)), files: null };
  const files = await readZip(bytes);
  const jsonName = files.has(JSON_NAME) ? JSON_NAME : [...files.keys()].find((name) => name.endsWith(".json"));
  if (!jsonName) throw new Error("ZIP 裡沒有備份紀錄(衣櫃備份.json)");
  return { backup: JSON.parse(new TextDecoder().decode(files.get(jsonName))), files };
}

/** 把備份寫回這台瀏覽器(覆蓋同名紀錄)。呼叫端負責之後 reload 讓畫面吃到新資料。 */
export async function restoreBackup(backup, files = null) {
  if (!backup || backup.format !== FORMAT) throw new Error("這不是衣櫃備份檔");
  if (backup.local && typeof backup.local === "object") {
    for (const [key, value] of Object.entries(backup.local)) {
      if (key.startsWith(LS_PREFIX) && !key.startsWith(SYNC_PREFIX) && !DEVICE_ONLY.has(key) && typeof value === "string") localStorage.setItem(key, value);
    }
  }
  for (const item of backup.items || []) {
    const { blobDataUrl, imageFile, ...rest } = item;
    let blob = null;
    if (imageFile && files?.has(imageFile)) blob = new Blob([files.get(imageFile)], { type: "image/png" });
    else if (blobDataUrl) blob = await (await fetch(blobDataUrl)).blob();   // 舊的 .json 備份
    if (!blob) continue;
    await putLocalRecord({ ...rest, blob });
  }
}
