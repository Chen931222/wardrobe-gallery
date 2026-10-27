// [本 fork 新增] 去背的核心(2026-10-27):載 MagicTouch v2、算一張、照筆觸重選。Worker(cutoutWorker.js)和主執行緒(cutout.js 的退路)共用。
/* 用 CPU 算:GPU(WebGL2)快很多(每點一下 0.4 秒 vs 3.5 秒),但 tasks-vision 1.1.0、1.1.1 用 GPU 讀回來的遮罩幾乎是空的
   (2026-10-27 桌機 RTX 5070 實測:平均 0.001、正中央 0,CPU 是 0.52、正中央 1),選不到東西,先不用。
   CPU 每次 segment 都要整個重算(1.1.0 的 CPU 版沒有把 setImage 那段存起來),桌機約 3.5 秒、手機 unknown,
   所以放在 Worker 裡算,畫面不會凍住。 */
import { MODEL_BYTES, MODEL_PATH, WASM_BYTES, WASM_DIR } from "./cutoutAssets.js";

/* MediaPipe 每 60 秒把使用統計 POST 到 Google(odml.pa.googleapis.com;不含照片,套件 README:
   "MediaPipe Tasks APIs send metrics about the performance and utilization of the APIs in your app to Google"),
   沒有選項能關。在這裡擋下、回一個不是 200 的回應,它記下失敗就不再送(2026-10-27 讀打包後的程式)。
   正式站的 CSP 也沒放行這個網域,這是第二道。 */
const METRICS_HOST = "odml.pa.googleapis.com";
let metricsBlocked = false;
function blockMetrics() {
  if (metricsBlocked || typeof globalThis.fetch !== "function") return;
  metricsBlocked = true;
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    try {
      const url = typeof input === "string" ? input : input?.url || String(input);
      if (new URL(url, self.location.href).hostname === METRICS_HOST) return Promise.resolve(new Response(null, { status: 204 }));
    } catch { /* 網址解不開就照原樣送 */ }
    return realFetch(input, init);
  };
}

const inWorkerScope = typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;

let report = () => {};
/** 下載進度 (已下載位元組, 總位元組),最多每 250ms 一次,下載完那一下一定會報 */
export function onDownload(callback) { report = callback; }

let loading = null;        // Promise<InteractiveSegmenter>;失敗就清掉,下一次重來
let controller = null;
const downloaded = { model: 0, wasm: 0 };
const TOTAL = MODEL_BYTES + WASM_BYTES;

/** 自己抓、自己數位元組(瀏覽器快取裡有就很快);回傳整個檔案 */
async function fetchBytes(url, key, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`去背模型下載失敗(HTTP ${response.status})`);
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    downloaded[key] = bytes.length;
    return bytes;
  }
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  let lastSent = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.length;
    downloaded[key] = size;
    const now = Date.now();
    if (now - lastSent >= 250) { lastSent = now; report(downloaded.model + downloaded.wasm, TOTAL); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

export function loadSegmenter() {
  if (loading) return loading;
  controller = new AbortController();
  const { signal } = controller;
  downloaded.model = 0;
  downloaded.wasm = 0;
  blockMetrics();
  const attempt = (async () => {
    const { FilesetResolver, InteractiveSegmenter } = await import("@mediapipe/tasks-vision");
    // module Worker 裡 importScripts 不能用,要 ES module 版的載入程式;頁面上用一般版,沒有 WebAssembly SIMD 的用 nosimd
    const name = inWorkerScope ? "vision_wasm_module_internal"
      : (await FilesetResolver.isSimdSupported()) ? "vision_wasm_internal" : "vision_wasm_nosimd_internal";
    const [wasm, model] = await Promise.all([
      fetchBytes(`${WASM_DIR}/${name}.wasm`, "wasm", signal),
      fetchBytes(MODEL_PATH, "model", signal),
    ]);
    report(TOTAL, TOTAL);
    // 運算程式交給 MediaPipe 時用 blob 網址:已經抓好了,不要它再抓一次
    const binary = URL.createObjectURL(new Blob([wasm], { type: "application/wasm" }));
    try {
      return await InteractiveSegmenter.createFromOptions(
        { wasmLoaderPath: new URL(`${WASM_DIR}/${name}.js`, self.location.origin).href, wasmBinaryPath: binary },
        {
          baseOptions: { modelAssetBuffer: model, delegate: "CPU" },
          // 給它一張 OffscreenCanvas:不給的話它照 UA 判斷,iPhone 上的 Chrome、LINE、iOS 16 的 Safari 會去叫
          // document.createElement,Worker 裡沒有 document 就失敗(2026-10-27 審查讀打包後的程式抓到)
          ...(typeof OffscreenCanvas !== "undefined" ? { canvas: new OffscreenCanvas(1, 1) } : {}),
        },
      );
    } finally {
      URL.revokeObjectURL(binary);
    }
  })();
  loading = attempt;
  // 失敗就清掉讓下一次重來;中止後又開始載的那次不能被舊的失敗清掉
  attempt.catch(() => { if (loading === attempt) loading = null; });
  return attempt;
}

/** 下載停住被停掉:這次的下載整個停掉,下一次從頭來(已經抓到的在瀏覽器快取裡) */
export function abandonLoad() {
  controller?.abort();
  controller = null;
  loading = null;
}

/* ---------- 一張照片 ---------- */

function canvasOf(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
const encode = (canvas) => (canvas.convertToBlob
  ? canvas.convertToBlob({ type: "image/png" })
  : new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("去背結果存不出來"))), "image/png")));

async function toCanvas(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = canvasOf(bitmap.width, bitmap.height);
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return canvas;
}

/** 照片＋遮罩 → 去背 PNG(遮罩當透明度,跟舊模型給的一樣是一張帶透明的 PNG) */
function maskToBlob(canvas, mask) {
  const { width: w, height: h } = canvas;
  const float = mask.hasFloat32Array();
  const values = float ? mask.getAsFloat32Array() : mask.getAsUint8Array();
  const scale = float ? 255 : 1;
  const mw = mask.width;
  const mh = mask.height;
  const out = canvasOf(w, h);
  const context = out.getContext("2d");
  context.drawImage(canvas, 0, 0);
  const image = context.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y += 1) {
    const row = Math.min(mh - 1, Math.floor((y * mh) / h)) * mw;
    for (let x = 0; x < w; x += 1) {
      const value = values[row + Math.min(mw - 1, Math.floor((x * mw) / w))] * scale;
      image.data[(y * w + x) * 4 + 3] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
  mask.close?.();
  context.putImageData(image, 0, 0);
  return encode(out);
}

// 最近一次去背的照片:點選修正用同一張,不用重新解碼;模型現在設好的是哪一張(token)
let session = null;        // { key, canvas, token }
let imageOnModel = null;
let tokenSeq = 0;

/** 照 strokes 選:file 是送去背的那張,key 是主執行緒給它的編號(傳進 Worker 的 Blob 每次都是新複製的一份,
 *  不能拿它本身比)。同一張就沿用,換了一張才重新解碼、重新 setImage */
export async function segment(file, strokes, key = file) {
  const segmenter = await loadSegmenter();
  if (!session || session.key !== key) session = { key, canvas: await toCanvas(file), token: ++tokenSeq };
  if (imageOnModel !== session.token) {
    segmenter.setImage(session.canvas);
    imageOnModel = session.token;
  }
  return maskToBlob(session.canvas, segmenter.segment(strokes));
}
