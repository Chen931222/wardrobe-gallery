// [本 fork 新增] 備份/還原:把這台瀏覽器裡的衣櫃紀錄打包成一個檔,方便在 PC 與 iPhone 之間搬,
// 或防 iOS 對久未造訪的網站清掉 storage。涵蓋所有 open-wardrobe-* 的 localStorage(穿著紀錄、收藏、
// 微調、編輯、隱藏、身上這套)＋ 自己在網頁加的衣服(IndexedDB,含去背圖)。全程本機,零上傳。
//
// 2026-10-04 起匯出成 ZIP(本人要的):「衣櫃備份.json」放紀錄,「衣服/品名.png」每件一張去背圖,
// 解開就能直接拿圖去用;同一個 ZIP 也能「匯入」。舊的 .json 備份(圖用 base64 塞在 JSON 裡)照樣能匯入。
import { dumpLocalRecords, putLocalRecord } from "./localWardrobe.js";
import { createZip, isZip, readZip } from "./zip.js";
import { markBackedUp } from "./keepSafe.js";

const FORMAT = "open-wardrobe-backup";
const LS_PREFIX = "open-wardrobe-";
const SYNC_PREFIX = "open-wardrobe-sync-";
// 「這台的去背模型已經下載過」只對這台成立;帶到新裝置會把「第一次要下載 80MB」的提示藏掉
// 「備份過沒」也只對這台成立(open-wardrobe-backup-mark-v1)
// 站主衣櫃存在這台的那份(App.jsx 的 CLOSET_CACHE_KEY)只是快取,也不進備份
const DEVICE_ONLY = new Set(["open-wardrobe-bgmodel-v1", "open-wardrobe-keep-hint-v1", "open-wardrobe-backup-mark-v1", "open-wardrobe-closet-cache-v1"]);
const JSON_NAME = "衣櫃備份.json";

/* 加密備份(2026-10-06 資安盤點:備份 ZIP 裡有每件衣服的圖和紀錄,沒加密)。可選的:一般的 ZIP 照舊,
   解開就有 PNG(本人 10-04 要的);加密的那份還是一個 ZIP(iPhone 的「檔案」認得、選得到),
   裡面只有一份說明和一團密文,要回網站「匯入備份」輸入密碼才解得開。
   密碼 → PBKDF2-SHA256 60 萬次 → AES-GCM。密碼忘了就打不開,網站作者也救不回來。 */
const LOCKED_NAME = "衣櫃備份.加密";
const LOCKED_README = "這是加了密碼的衣櫃備份。\n到 https://wardrobe-gallery.vercel.app 搭配頁最下面按「匯入備份」選這個檔,再輸入匯出時設的密碼。\n密碼忘了就打不開,誰都救不回來(包括網站作者)。\n";
const LOCK_MAGIC = new TextEncoder().encode("WRDLOCK1");
const LOCK_ROUNDS = 600000;

async function lockKey(password, salt) {
  const raw = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: LOCK_ROUNDS }, raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function lockBytes(bytes, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await lockKey(password, salt), bytes));
  const out = new Uint8Array(LOCK_MAGIC.length + 16 + 12 + sealed.length);
  out.set(LOCK_MAGIC); out.set(salt, 8); out.set(iv, 24); out.set(sealed, 36);
  return out;
}
async function unlockBytes(bytes, password) {
  if (bytes.length < 36 || !LOCK_MAGIC.every((byte, index) => bytes[index] === byte)) throw new Error("這份加密備份壞了");
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(24, 36) }, await lockKey(password, bytes.slice(8, 24)), bytes.slice(36)));
  } catch {
    throw new Error("密碼不對");
  }
}

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
      // 讀不到的圖(iPhone Safari 的 WebKit bug 235687)跳過那一張,紀錄照樣留著;不讓整份備份失敗
      try {
        const data = new Uint8Array(await (await asPng(blob)).arrayBuffer());
        imageFile = fileNameFor(rest.name, used);
        files.push({ name: imageFile, data });
      } catch { /* 這張讀不到 */ }
    }
    items.push({ ...rest, imageFile });
  }
  const json = { format: FORMAT, version: 2, exportedAt: new Date().toISOString(), local: collectLocal(), items };
  return { zip: createZip([{ name: JSON_NAME, data: new TextEncoder().encode(JSON.stringify(json, null, 1)) }, ...files]), count: files.length };
}

/** 觸發下載備份 ZIP(檔名帶日期)。回傳裡面有幾張衣服的圖。password:加密備份(見上面 LOCKED_NAME) */
export async function downloadBackupZip({ password = null } = {}) {
  const built = await buildBackupZip();
  const count = built.count;
  const zip = password
    ? createZip([
      { name: "請先讀我.txt", data: new TextEncoder().encode(LOCKED_README) },
      { name: LOCKED_NAME, data: await lockBytes(new Uint8Array(await built.zip.arrayBuffer()), password) },
    ])
    : built.zip;
  const url = URL.createObjectURL(zip);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `wardrobe-backup-${new Date().toISOString().slice(0, 10)}${password ? "-加密" : ""}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);   // iPhone 要等它真的開始下載才能釋放,立刻釋放會下載失敗
  markBackedUp();
  return count;
}

/** 讀使用者選的備份檔(.zip 或舊的 .json):回 { backup, files }。加密的那種用 askPassword() 要密碼 */
export async function readBackupFile(file, askPassword = null) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isZip(bytes)) return { backup: JSON.parse(new TextDecoder().decode(bytes)), files: null };
  let files = await readZip(bytes);
  if (files.has(LOCKED_NAME)) {
    const password = askPassword ? await askPassword() : null;
    if (!password) throw new Error("沒輸入密碼,沒有匯入");
    files = await readZip(await unlockBytes(files.get(LOCKED_NAME), password));
  }
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
  markBackedUp();   // 剛匯入的這份檔就是備份,不用馬上又提醒
}

/** 匯入一個使用者選的備份檔:先講清楚會發生什麼、問過才寫。回傳要顯示的一句話;按取消回 null。
 *  搭配頁的「匯入備份」和空衣櫃的歡迎畫面共用(換手機的朋友衣櫃還空著,沒有搭配頁可以按)。
 *  @param syncOn 這台開了同步沒(開了的話,匯入的東西會傳到每一台) */
export async function importBackupFile(file, syncOn = false) {
  // 講清楚會發生的三件事(審查 F42):舊版只說「這台瀏覽器」,開了同步其實會傳到每一台
  const synced = syncOn ? "\n・開了同步,這些會傳到你的每一台裝置。" : "";
  if (!window.confirm(`匯入這份備份?\n・備份裡的衣服會加回來,包括之後刪掉的。\n・穿著紀錄、收藏、微調會換回備份當時的版本。${synced}`)) return null;
  try {
    const { backup, files } = await readBackupFile(file, async () => window.prompt("這份備份加了密碼。輸入匯出時設的密碼:"));
    await restoreBackup(backup, files);
    setTimeout(() => window.location.reload(), 800);
    return "已還原,重新整理讓紀錄生效…";
  } catch (cause) {
    return `匯入失敗:${cause?.message || "檔案格式不對"}`;
  }
}
