// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
/* 去背:載模型、排隊、在哪裡算。2026-10-07 從 AddGarment.jsx 搬出來。
 *
 * 2026-10-27 換引擎:@imgly 的 isnet(AGPL、第一次下載約 100MB、訓練資料說不清能不能商用)
 * → Google MediaPipe 的 MagicTouch v2(model card 寫 Apache-2.0;模型 30.5MB＋運算程式 13MB,都放在這個網站的 /cutout/)。
 * 實測 20 張站主照片(work/cutout-compare-2026-10-27/):點框的正中央,多數一次就乾淨;成雙的鞋只選到一隻、
 * 沙發床單偶爾滲進來,點一下「這也是」「這不是」就修好(正、負筆觸;舊版 v1 點背景再扣掉會連衣服一起扣光,不用)。
 * 怎麼算見 cutoutEngine.js。
 *
 * 在 Worker 裡算(2026-10-07 本人回報「在等待去背時不能寫入細節」:主執行緒算的那幾秒整頁凍住,欄位打不了字);
 * 舊 Safari 開不了 module Worker、或 Worker 裡沒有 OffscreenCanvas、載不了 MediaPipe 的,照舊在主執行緒算。 */
import { MODEL_BYTES, WASM_BYTES } from "./cutoutAssets.js";

const MODEL_READY_KEY = "open-wardrobe-bgmodel-v2";   // v2(2026-10-27):換了模型,舊的「下載過」不算數
export const modelReady = () => { try { return localStorage.getItem(MODEL_READY_KEY) === "1"; } catch { return false; } };

const mb = (bytes) => Math.round(bytes / 1e6);
export const MODEL_MB = mb(MODEL_BYTES + WASM_BYTES);   // 新增視窗的提示「第一次要下載約 N MB」

/* 進度:currentProgress 是正在等的那一件的回呼 (文字, 是否在下載)。字一秒最多換一次
   (狀態行是 aria-live,一直換讀屏會一直念);AddGarment 的看門狗只看「是否在下載」重新計時 */
let currentProgress = null;
let shownText = "";
let shownAt = 0;
const reportDownload = (loaded, total) => {
  if (!currentProgress) return;
  if (loaded >= total) { currentProgress("模型下載好了,去背中…", false); return; }
  const now = Date.now();
  if (!shownText || now - shownAt >= 1000) {
    shownText = `下載去背模型 ${Math.floor((loaded / total) * 100)}%(${mb(loaded)} / ${mb(total)} MB,建議用 Wi-⁠Fi)`;   // ⁠:「Wi-」「Fi」不要拆成兩行
    shownAt = now;
  }
  currentProgress(shownText, true);
};

// 模型載好了(Worker 或主執行緒):看門狗停掉、狀態改「去背中」。點選修正時沒有人在等(currentProgress 是空的),不報
const reportLoaded = () => { currentProgress?.("去背中…", false); };

/** 筆觸:kind "add" = 這也是衣服(正)、"remove" = 這不是(負);x、y 是照片的比例 0–1 */
export const strokeAt = (kind, x, y) => ({ brushMode: kind === "remove" ? 2 : 1, point: [{ x, y }], isCompleted: true });
export const CENTER = strokeAt("add", 0.5, 0.5);

/* ---------- 主執行緒的退路 ---------- */

let engine = null;
const mainEngine = async () => {
  if (!engine) {
    engine = await import("./cutoutEngine.js");
    engine.onDownload(reportDownload);
  }
  return engine;
};

/* ---------- Worker ---------- */

class WorkerUnavailable extends Error {}

function offscreen2d() {
  try { return typeof OffscreenCanvas !== "undefined" && Boolean(new OffscreenCanvas(1, 1).getContext("2d")); }
  catch { return false; }
}
let workerBroken = typeof Worker === "undefined" || !offscreen2d();
let worker = null;
const jobs = new Map();   // id → { resolve, reject }
let jobSeq = 0;

function dropWorker(reason) {
  workerBroken = true;
  const waiting = [...jobs.values()];
  jobs.clear();
  worker?.terminate();
  worker = null;
  for (const job of waiting) job.reject(new WorkerUnavailable(reason));
}

function inWorker(payload) {
  if (!worker) {
    try {
      worker = new Worker(new URL("./cutoutWorker.js", import.meta.url), { type: "module" });
    } catch (error) {
      dropWorker(String(error?.message || error));
      return Promise.reject(new WorkerUnavailable("Worker 開不起來"));
    }
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") { reportDownload(data.loaded, data.total); return; }
      if (data.type === "loaded") { reportLoaded(); return; }
      const job = jobs.get(data.id);
      if (!job) return;
      jobs.delete(data.id);
      if (data.type === "done") job.resolve(data.blob);
      else if (data.unsupported) { job.reject(new WorkerUnavailable(data.message)); dropWorker(data.message); }   // Worker 裡缺東西:這次和之後都回主執行緒
      else job.reject(new Error(data.message));
    };
    // 連 Worker 都起不來(舊 Safari 不支援 module Worker 之類):之後都回主執行緒算
    worker.onerror = (event) => { event.preventDefault?.(); dropWorker(event.message || "Worker 起不來"); };
  }
  const id = ++jobSeq;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    worker.postMessage({ id, ...payload });
  });
}

/** Worker 能用就在 Worker 算,不能用(這次或之前)就在主執行緒算 */
async function run(payload, onMain) {
  if (!workerBroken) {
    try {
      return await inWorker(payload);
    } catch (error) {
      if (!(error instanceof WorkerUnavailable)) throw error;
    }
  }
  return onMain();
}

/** 下載停住、看門狗把去背停掉之後叫(AddGarment):把 Worker 整個砍掉,正在等它的工作全部回「停住了」。
 *  不砍的話,卡住的下載還掛在 Worker 裡,去背一次只算一張(previousRun),再按「再試一次」就卡在
 *  「上一張還在算,等它結束…」(2026-10-25 驗收)。下一次開新的 Worker、從頭載;已經下載完的在瀏覽器快取裡。 */
export function abandonCutout() {
  engine?.abandonLoad();
  if (!worker) return;
  const waiting = [...jobs.values()];
  jobs.clear();
  worker.terminate();
  worker = null;
  for (const job of waiting) job.reject(new Error("去背模型下載停住,這次停掉了"));
}

/** 這台會不會先載(省流量、2G 不先載)。新增視窗的提示照這個講「打開就開始下載」還是「去背時才下載」 */
export function preloadsEarly() {
  const connection = typeof navigator !== "undefined" ? navigator.connection : null;
  return !(connection?.saveData || /2g/.test(connection?.effectiveType || ""));
}

/** 一打開新增視窗就在背景先載模型(2026-10-05 本人要的:選照片、框衣服的這段時間就載完了)。省流量、2G 不先載 */
export function preloadModel() {
  if (!preloadsEarly()) return;
  run({ type: "preload" }, async () => (await mainEngine()).loadSegmenter()).catch(() => { /* 真的去背時會再試、再報錯 */ });
}

/* ---------- 去背與點選修正 ---------- */

// 每張送去背的照片一個編號:傳進 Worker 的 Blob 每次都是新複製的,Worker 靠編號認出是同一張、不用重新解碼
const keys = new WeakMap();
let keySeq = 0;
const keyOf = (file) => { if (!keys.has(file)) keys.set(file, ++keySeq); return keys.get(file); };

const select = (file, strokes) => {
  const key = keyOf(file);
  return run({ type: "cut", file, key, strokes }, async () => {
    const main = await mainEngine();
    await main.loadSegmenter();
    reportLoaded();
    return main.segment(file, strokes, key);
  });
};

// 一次只算一張:馬上再按一次去背,兩張一起算,iPad 的記憶體會撐不住
let previousRun = Promise.resolve();
let pending = 0;   // 排隊中加上正在算的張數

/** 去背,回傳 PNG Blob(還沒補洞,補洞用 fixCutout)。點框的正中央。@param onProgress (文字, 是否在下載) */
export async function removeBg(file, onProgress) {
  const waitFor = previousRun;
  let release;
  previousRun = new Promise((resolve) => { release = resolve; });
  pending += 1;
  try {
    if (pending > 1) onProgress("上一張還在算,等它結束…", false);
    await waitFor;
    shownText = "";
    currentProgress = onProgress;
    // 「是否在下載」給 true:模型還沒載好前看門狗照樣計時(給 false 會把它停掉,下載一開始就卡住的話永遠停在這句,
    // 2026-10-27 審查抓到);載好了 reportLoaded 才停
    onProgress("準備去背…", true);
    const result = await select(file, [CENTER]);
    try { localStorage.setItem(MODEL_READY_KEY, "1"); } catch { /* 存不了就每次都顯示第一次的提示 */ }
    return result;
  } finally {
    if (currentProgress === onProgress) currentProgress = null;
    pending -= 1;
    release();
  }
}

/** 點選修正:同一張照片(file 是送去背的那張)照 strokes 重新選。回傳新的 PNG Blob */
export const refineCutout = (file, strokes) => select(file, strokes);

/** 白衣服白底被模型吃掉的補回來(規則見 cutoutFix.js)。input 是送去背的那張、cut 是 removeBg 的結果。
 *  strong = 人按了「補滿」。 */
export const fixCutout = (input, cut, { part = "", strong = false } = {}) => run(
  { type: "fix", file: input, cut, part, strong },
  async () => (await import("./cutoutFix.js")).solidifyCutout(input, cut, { part, strong }),
);

/** 測試用:現在是不是在 Worker 裡算 */
export const cutoutInWorker = () => !workerBroken;
