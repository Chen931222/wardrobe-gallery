// [本 fork 修改] 上游 tandpfun/wardrobe 既有檔案。本 fork 的改動:拿掉上游線上匯入用的開發 API(import-job-api 與 loadEnv),換成讀本機衣櫃資料的 wardrobeDataApi。
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { responsiveImageApi } from "./scripts/responsive-image-api.mjs";
import { wardrobeDataApi } from "./scripts/wardrobe-data-api.mjs";

export default defineConfig(() => {
  return {
    optimizeDeps: {
      include: ["react", "react-dom/client"],
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      warmup: {
        clientFiles: ["./src/main.jsx"],
      },
    },
    preview: {
      host: "0.0.0.0",
      port: 4173,
      allowedHosts: ["localhost"],
    },
    plugins: [react(), responsiveImageApi(), wardrobeDataApi()],
  };
});
