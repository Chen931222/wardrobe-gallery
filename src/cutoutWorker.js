// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
/* 在 Worker 裡去背(為什麼見 cutout.js 開頭):主執行緒那 10–20 秒才不會凍住,等的時候還能打字。
   進度回呼固定一個(去背套件會把第一次的設定連回呼一起快取),進度用訊息傳回主執行緒。 */
import { preload, removeBackground } from "@imgly/background-removal";
import { retryLowContrast, solidifyCutout } from "./cutoutFix.js";

const progress = (key, current, total) => self.postMessage({ type: "progress", key, current, total });

self.onmessage = async ({ data: { id, type, file, cut, quality, part, strong } }) => {
  const config = { output: { format: "image/png", quality }, progress };
  try {
    if (type === "preload") {
      await preload(config);
      self.postMessage({ id, type: "done" });
    } else if (type === "fix") {
      // 白衣服白底被吃掉的補回來(cutoutFix.js);跟去背分開,按「補滿」時不用重算模型
      self.postMessage({ id, type: "done", blob: await solidifyCutout(file, cut, { part, strong }) });
    } else {
      const cut = await removeBackground(file, config);
      // 對比太低(白衣服、淺灰底的商品圖):拉開再算一次(cutoutFix.js)
      const blob = await retryLowContrast(file, cut, (leveled) => { progress("retry", 0, 1); return removeBackground(leveled, config); });
      self.postMessage({ id, type: "done", blob });
    }
  } catch (error) {
    const message = String(error?.message || error);
    // Worker 裡缺畫布這類「這台不能在 Worker 算」的:叫主執行緒改回自己算
    const unsupported = /OffscreenCanvas|getContext|createImageBitmap is not defined/.test(message);
    self.postMessage({ id, type: "error", message, unsupported });
  }
};
