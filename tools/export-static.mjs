// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
// tools/export-static.mjs — 匯出唯讀靜態版衣櫃(給 Vercel)
// 原理:前端啟動只 GET /data/wardrobe.json(= data/library.json)和
// /data/library/*.webp(= data/imported/),把它們照路徑擺成靜態檔即可。
// 不放 api/ 底下:Vercel 把 api/ 保留給 functions,靜態檔放那裡可能不出(未實測,避開就好)。
// 用法:npx vite build && node tools/export-static.mjs → 產出 wardrobe-gallery/
// 上線只能從 wardrobe-gallery/ 用 CLI 部署。repo 沒有 data/,Git 建置出來的站是空的,
// 所以 vercel.json 關掉了 Git 自動部署(2026-09 線上版兩次被 push 觸發的建置蓋掉)。
import { cp, mkdir, rm, readdir, readFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "wardrobe-gallery");
const ASSET_PREFIX = "/data/library/";

// 只帶 .webp 衍生檔上線 —— 原始 PNG 是相機解析度(全部約 800MB),留在本機當來源就好。
// 衍生檔由 tools/make-derivatives.mjs 產生,匯出前請先跑過。
const assets = (await readdir(join(ROOT, "data", "imported"))).filter((f) => f.endsWith(".webp"));
if (!assets.length) {
  console.error("找不到任何 .webp 衍生檔,請先執行:node tools/make-derivatives.mjs");
  process.exit(1);
}

// 先對帳再動手:衣櫃裡每個圖片網址都要對得到一個會被匯出的檔案,
// 否則線上就是破圖。對不上就停在這裡,不要蓋掉上一份可用的輸出。
const library = JSON.parse(await readFile(join(ROOT, "data", "library.json"), "utf8"));
const exported = new Set(assets);
const broken = [];
for (const item of library) {
  for (const key of ["image", "thumbnail", "modeledImage"]) {
    const url = item[key];
    if (!url) continue;
    if (!url.startsWith(ASSET_PREFIX) || !exported.has(url.slice(ASSET_PREFIX.length))) {
      broken.push(`${item.name}(${key}):${url}`);
    }
  }
}
if (broken.length) {
  console.error(`有 ${broken.length} 個圖片網址上線後會 404(必須是 ${ASSET_PREFIX}*.webp 且檔案存在):`);
  for (const line of broken.slice(0, 10)) console.error("  " + line);
  if (broken.length > 10) console.error(`  …還有 ${broken.length - 10} 個`);
  console.error("請先執行:node tools/make-derivatives.mjs");
  process.exit(1);
}

// 清空內容、不刪資料夾本身:Windows 上只要有終端機或檔案總管停在這個資料夾,rmdir 就會 EBUSY。
// .vercel 留著,部署時才不用重新連結專案。
await mkdir(OUT, { recursive: true });
for (const entry of await readdir(OUT)) {
  if (entry !== ".vercel") await rm(join(OUT, entry), { recursive: true, force: true });
}
await cp(join(ROOT, "dist"), OUT, { recursive: true });

const dataDir = join(OUT, "data");
await mkdir(join(dataDir, "library"), { recursive: true });
await copyFile(join(ROOT, "data", "library.json"), join(dataDir, "wardrobe.json"));
for (const f of assets) {
  await copyFile(join(ROOT, "data", "imported", f), join(dataDir, "library", f));
}
console.log(`匯出完成:wardrobe-gallery/(${library.length} 件、${assets.length} 個圖檔)→ cd wardrobe-gallery && vercel deploy --prod --yes`);
