// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
/* 去背:載模型、排隊、在哪裡算。2026-10-07 從 AddGarment.jsx 搬出來。
 *
 * 搬出來的原因(2026-10-07 本人回報「在等待去背時不能寫入細節,例如產品價格」):表單在等去背時本來就開著,
 * 但去背套件只有 WebGPU 能用時才會把運算丟到 Worker(它的 proxyToWorker 只認 WebGPU),iPhone 走 CPU,
 * 推論直接在主執行緒跑 —— 那 10–20 秒整頁凍住,欄位看得到卻打不了字、鍵盤也叫不出來。
 * 現在整個去背在自己的 Worker(cutoutWorker.js)裡算,主執行緒只收進度和結果。
 * 舊 Safari 開不了 module Worker、或 Worker 裡沒有 OffscreenCanvas 2D(Safari 16.4 以前)的,照舊在主執行緒算。 */

/* 去背模型有 80MB 左右,第一次用會下載。動態 import / Worker 讓它不進主 bundle,
   沒按「新增」的人完全不會付這個成本。 */
const MODEL_READY_KEY = "open-wardrobe-bgmodel-v1";   // 這台成功去背過一次 = 模型已經在瀏覽器快取裡
export const modelReady = () => { try { return localStorage.getItem(MODEL_READY_KEY) === "1"; } catch { return false; } };

/* 進度回呼要是同一個函式:去背套件把設定(連 progress 一起)照第一次呼叫的樣子快取起來,之後每次都叫第一次那個。
   每次給新的回呼的話,第二件開始進度文字不動、下載看門狗也收不到進度,算到一半就被當成卡住(2026-10-03 審查抓到)。
   所以回呼固定一個,真正要通知誰放在 currentProgress。Worker 那邊也是固定一個,進度用訊息傳回來再交給這裡。 */
let currentProgress = null;
let downloading = false;
const onModelProgress = (key, current, total) => {
  if (!currentProgress) return;
  if (key === "retry") {   // 對比太低,拉開再算一次(cutoutFix.js 的 retryLowContrast)
    currentProgress("衣服跟背景太像,拉高對比再算一次…", false);
    return;
  }
  if (key.startsWith("fetch") && current < total) {
    downloading = true;
    // 「已經下載過」的記號不可靠:Safari 會把這麼大的快取清掉,隔天又要重抓。下載中就講明多大、建議 Wi-Fi
    currentProgress(`下載去背模型 ${Math.round((current / total) * 100)}%(約 80MB,建議用 Wi-Fi)`, true);
  } else if (key.startsWith("fetch")) {
    // 下載到 100% 之後要算 7–9 秒,先講清楚接下來在做什麼(審查 F33)
    currentProgress(downloading ? "模型下載好了,開始去背,約 10–20 秒…" : "去背中,約 10–20 秒…", false);
  } else {
    currentProgress("去背中,約 10–20 秒…", false);
  }
};

/* 去背套件把「初始化」照設定內容記起來,失敗的也記:模型下載斷過一次,同一頁之後怎麼按都立刻失敗,
   網路恢復了也一樣,只能重新整理(2026-10-05 實測;本人 iPhone 4G 去背一直失敗多半就是這個)。
   它記的鍵是設定轉成的字串,所以失敗後把設定改一個不影響結果的小數(PNG 不看 quality),下一次就會重新初始化。 */
let modelAttempt = 0;
const quality = () => 0.9 + modelAttempt * 1e-6;
const modelConfig = () => ({ output: { format: "image/png", quality: quality() }, progress: onModelProgress });

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

function inWorker(type, payload = {}) {
  if (!worker) {
    try {
      worker = new Worker(new URL("./cutoutWorker.js", import.meta.url), { type: "module" });
    } catch (error) {
      dropWorker(String(error?.message || error));
      return Promise.reject(new WorkerUnavailable("Worker 開不起來"));
    }
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") { onModelProgress(data.key, data.current, data.total); return; }
      const job = jobs.get(data.id);
      if (!job) return;
      jobs.delete(data.id);
      if (data.type === "done") job.resolve(data.blob);
      else if (data.unsupported) { job.reject(new WorkerUnavailable(data.message)); dropWorker(data.message); }   // Worker 裡缺東西(畫布之類):這次和之後都回主執行緒
      else job.reject(new Error(data.message));
    };
    // 連 Worker 都起不來(舊 Safari 不支援 module Worker 之類):之後都回主執行緒算
    worker.onerror = (event) => { event.preventDefault?.(); dropWorker(event.message || "Worker 起不來"); };
  }
  const id = ++jobSeq;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    worker.postMessage({ id, type, quality: quality(), ...payload });
  });
}

/** 一打開新增視窗就在背景先載模型(2026-10-05 本人要的:朋友第一次用,選照片、框衣服的這段時間就載完了),
 *  選好照片時再叫一次(前一次斷了會重來,載好了的話什麼都不做)。開了省流量模式、或網路是 2G 等級就不先載。 */
export function preloadModel() {
  const connection = typeof navigator !== "undefined" ? navigator.connection : null;
  if (connection?.saveData || /2g/.test(connection?.effectiveType || "")) return;
  const attempt = modelAttempt;
  const onMain = () => import("@imgly/background-removal").then(({ preload }) => preload(modelConfig()));
  const run = workerBroken ? onMain() : inWorker("preload").catch((error) => {
    if (error instanceof WorkerUnavailable) return onMain();
    throw error;
  });
  run.catch(() => { if (attempt === modelAttempt) modelAttempt += 1; });
}

// 一次只算一張:取消只是不看結果,模型那邊停不下來;馬上再按一次去背,兩張一起算,iPad 的記憶體會撐不住
let previousRun = Promise.resolve();
let pending = 0;   // 排隊中加上正在算的張數

/** 去背,回傳模型給的 PNG Blob(還沒補洞,補洞用 fixCutout)。@param onProgress (文字, 是否在下載) */
export async function removeBg(file, onProgress) {
  const waitFor = previousRun;
  let release;
  previousRun = new Promise((resolve) => { release = resolve; });
  pending += 1;
  try {
    if (pending > 1) onProgress("上一張還在算,等它結束…", false);
    await waitFor;
    downloading = false;
    currentProgress = onProgress;
    const attempt = modelAttempt;
    try {
      let result;
      if (!workerBroken) {
        try {
          result = await inWorker("cut", { file });
        } catch (error) {
          if (!(error instanceof WorkerUnavailable)) throw error;
        }
      }
      if (!result) {
        const { removeBackground } = await import("@imgly/background-removal");
        result = await removeBackground(file, modelConfig());
        const { retryLowContrast } = await import("./cutoutFix.js");
        result = await retryLowContrast(file, result, (leveled) => { onModelProgress("retry", 0, 1); return removeBackground(leveled, modelConfig()); });
      }
      try { localStorage.setItem(MODEL_READY_KEY, "1"); } catch { /* 存不了就每次都顯示第一次的提示 */ }
      return result;
    } catch (error) {
      if (attempt === modelAttempt) modelAttempt += 1;   // 下一次重新初始化,不沿用失敗的那次
      throw error;
    }
  } finally {
    if (currentProgress === onProgress) currentProgress = null;
    pending -= 1;
    release();
  }
}

/** 白衣服白底被模型吃掉的補回來(規則見 cutoutFix.js)。input 是送去背的那張、cut 是 removeBg 的結果。
 *  strong = 人按了「補滿」。也在 Worker 裡算(大圖要掃好幾遍),不行就在這裡算。 */
export async function fixCutout(input, cut, { part = "", strong = false } = {}) {
  if (!workerBroken) {
    try {
      return await inWorker("fix", { file: input, cut, part, strong });
    } catch (error) {
      if (!(error instanceof WorkerUnavailable)) throw error;
    }
  }
  return (await import("./cutoutFix.js")).solidifyCutout(input, cut, { part, strong });
}

/** 測試用:現在是不是在 Worker 裡算 */
export const cutoutInWorker = () => !workerBroken;
