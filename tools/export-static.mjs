// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
// tools/export-static.mjs — 匯出唯讀靜態版衣櫃(給 Vercel)
// 原理:前端啟動只 GET /api/import/wardrobe(= data/library.json)和
// /api/import/library/*.png(= data/imported/),把它們照路徑擺成靜態檔即可。
// 用法:npx vite build && node tools/export-static.mjs → 產出 wardrobe-gallery/
import { cp, mkdir, rm, readdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "wardrobe-gallery");

await rm(OUT, { recursive: true, force: true });
await cp(join(ROOT, "dist"), OUT, { recursive: true });

const apiDir = join(OUT, "api", "import");
await mkdir(join(apiDir, "library"), { recursive: true });
await copyFile(join(ROOT, "data", "library.json"), join(apiDir, "wardrobe"));

// 只帶 .webp 衍生檔上線 —— 原始 PNG 是相機解析度(全部約 800MB),留在本機當來源就好。
// 衍生檔由 tools/make-derivatives.mjs 產生,匯出前請先跑過。
const assets = (await readdir(join(ROOT, "data", "imported"))).filter((f) => f.endsWith(".webp"));
if (!assets.length) {
  console.error("找不到任何 .webp 衍生檔,請先執行:node tools/make-derivatives.mjs");
  process.exit(1);
}
for (const f of assets) {
  await copyFile(join(ROOT, "data", "imported", f), join(apiDir, "library", f));
}
console.log(`匯出完成:wardrobe-gallery/(${assets.length} 個圖檔)→ cd wardrobe-gallery && vercel deploy --prod --yes`);
