// [本 fork 修改] 上游 tandpfun/wardrobe 既有檔案。本 fork 的改動:拿掉上游線上匯入用的開發 API(import-job-api 與 loadEnv),換成讀本機衣櫃資料的 wardrobeDataApi;另加 brandProductApi(貼連結抓品名)、syncApi(同步,開發時存本機 .sync-dev/)、productPageApi(其他品牌的商品頁與商品圖);
// 開發伺服器只聽本機(上游是 0.0.0.0,2026-10-06 改):開發版沒有任何驗證,站主完整的衣櫃、原圖、
// 會真的刪檔的端點都在上面;這台的 Windows 防火牆對 Node.js 在「公用網路」是允許連入,
// 在學校、咖啡廳的 Wi-Fi 開著,同一個網路的人連得到。要用手機連開發版時,臨時加 --host 就好。
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { responsiveImageApi } from "./scripts/responsive-image-api.mjs";
import { wardrobeDataApi } from "./scripts/wardrobe-data-api.mjs";
import { brandProductApi } from "./scripts/brand-product-api.mjs";
import { syncApi } from "./scripts/sync-api.mjs";
import { productPageApi } from "./scripts/product-page-api.mjs";

export default defineConfig(() => {
  return {
    optimizeDeps: {
      include: ["react", "react-dom/client"],
    },
    server: {
      host: "127.0.0.1",
      allowedHosts: ["terminal.local"],
      warmup: {
        clientFiles: ["./src/main.jsx"],
      },
    },
    // 去背的 Worker(src/cutoutWorker.js)裡有動態 import(onnxruntime),要用 ES module 格式打包
    worker: { format: "es" },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      allowedHosts: ["localhost"],
    },
    plugins: [react(), responsiveImageApi(), wardrobeDataApi(), brandProductApi(), syncApi(), productPageApi()],
  };
});
