// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
/* 在 Worker 裡去背、點選修正、補洞補實(為什麼見 cutout.js 開頭):主執行緒才不會凍住,等的時候還能打字。
   下載進度用訊息傳回主執行緒。 */
import { solidifyCutout } from "./cutoutFix.js";
import { loadSegmenter, onDownload, segment } from "./cutoutEngine.js";

onDownload((loaded, total) => self.postMessage({ type: "progress", loaded, total }));

self.onmessage = async ({ data: { id, type, file, key, cut, strokes, part, strong } }) => {
  try {
    if (type === "preload") {
      await loadSegmenter();
      self.postMessage({ id, type: "done" });
    } else if (type === "fix") {
      // 白衣服白底被吃掉的補回來(cutoutFix.js);跟去背分開,按「補滿」時不用重算模型
      self.postMessage({ id, type: "done", blob: await solidifyCutout(file, cut, { part, strong }) });
    } else {
      await loadSegmenter();
      self.postMessage({ type: "loaded" });   // 模型好了:主執行緒的看門狗可以停,狀態改「去背中」
      self.postMessage({ id, type: "done", blob: await segment(file, strokes, key) });
    }
  } catch (error) {
    const message = String(error?.message || error);
    // Worker 裡缺畫布、沒有 document、載不了 MediaPipe 的 ES module 版、wasm 編譯不了(沒有 SIMD)這類
    // 「這台不能在 Worker 算」的:叫主執行緒改回自己算(主執行緒那邊會挑 nosimd 版)
    const unsupported = /OffscreenCanvas|getContext|createImageBitmap is not defined|ModuleFactory|dynamically imported module|import\(\)|WorkerGlobalScope|document|Can't find variable|CompileError|WebAssembly/i.test(message);
    self.postMessage({ id, type: "error", message, unsupported });
  }
};
