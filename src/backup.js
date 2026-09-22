// [本 fork 新增] 備份/還原:把這台瀏覽器裡的衣櫃紀錄打包成一個 JSON 檔,方便在 PC 與 iPhone 之間搬,
// 或防 iOS 對久未造訪的網站清掉 storage。涵蓋所有 open-wardrobe-* 的 localStorage(穿著紀錄、收藏、
// 微調、編輯、隱藏、身上這套)＋ 自己在網頁加的衣服(IndexedDB,含去背圖 blob)。全程本機,零上傳。
import { dumpLocalRecords, putLocalRecord } from "./localWardrobe.js";

const FORMAT = "open-wardrobe-backup";
const LS_PREFIX = "open-wardrobe-";

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** 收集這台瀏覽器的全部衣櫃紀錄成一個可序列化物件。 */
export async function buildBackup() {
  const local = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(LS_PREFIX)) local[key] = localStorage.getItem(key);
  }
  const records = await dumpLocalRecords();
  const items = await Promise.all(records.map(async ({ blob, ...rest }) => ({
    ...rest,
    blobDataUrl: blob ? await blobToDataUrl(blob) : null,
  })));
  return { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), local, items };
}

/** 觸發下載一份備份檔(檔名帶日期)。 */
export function downloadBackup(backup) {
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `wardrobe-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** 把備份寫回這台瀏覽器(覆蓋同名紀錄)。呼叫端負責之後 reload 讓畫面吃到新資料。 */
export async function restoreBackup(backup) {
  if (!backup || backup.format !== FORMAT) throw new Error("這不是衣櫃備份檔");
  if (backup.local && typeof backup.local === "object") {
    for (const [key, value] of Object.entries(backup.local)) {
      if (key.startsWith(LS_PREFIX) && typeof value === "string") localStorage.setItem(key, value);
    }
  }
  for (const item of backup.items || []) {
    if (!item.blobDataUrl) continue;
    const { blobDataUrl, ...rest } = item;
    const blob = await (await fetch(blobDataUrl)).blob();
    await putLocalRecord({ ...rest, blob });
  }
}
