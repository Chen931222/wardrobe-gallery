// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
// tools/export-static.mjs — 匯出唯讀靜態版衣櫃(給 Vercel)
// 原理:前端啟動只 GET /data/wardrobe.json(= data/library.json)和
// /data/library/*.webp(= data/imported/),把它們照路徑擺成靜態檔即可。
// 不放 api/ 底下:Vercel 把 api/ 保留給 functions,靜態檔放那裡可能不出(未實測,避開就好)。
// 用法:npx vite build && node tools/export-static.mjs → 產出 wardrobe-gallery/
// 上線只能從 wardrobe-gallery/ 用 CLI 部署。repo 沒有 data/,Git 建置出來的站是空的,
// 所以 vercel.json 關掉了 Git 自動部署(2026-09 線上版兩次被 push 觸發的建置蓋掉)。
import { cp, mkdir, rm, readdir, readFile, copyFile, writeFile } from "node:fs/promises";
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
// 唯一的 Vercel function:貼 GU／UNIQLO 連結時查品名(瀏覽器被對方 CORS 擋,只能從伺服器問)
await mkdir(join(OUT, "api"), { recursive: true });
await copyFile(join(ROOT, "functions", "brand-product.mjs"), join(OUT, "api", "brand-product.mjs"));
// 同步:sync.mjs 是路由,_sync-core.mjs 底線開頭不會變成路由。function 要用 @vercel/blob,
// 所以輸出資料夾放一份只列這個套件的 package.json,Vercel 部署時會自己裝。
await copyFile(join(ROOT, "functions", "sync.mjs"), join(OUT, "api", "sync.mjs"));
await copyFile(join(ROOT, "functions", "_sync-core.mjs"), join(OUT, "api", "_sync-core.mjs"));
const blobVersion = JSON.parse(await readFile(join(ROOT, "node_modules", "@vercel", "blob", "package.json"), "utf8")).version;
await writeFile(join(OUT, "package.json"), JSON.stringify({ private: true, type: "module", dependencies: { "@vercel/blob": blobVersion } }, null, 2) + "\n");

// 安全標頭(2026-10-03,審查報告的資安項)。同步碼存在瀏覽器裡,萬一哪天被塞進一段腳本,
// CSP 讓它只能連到下面這幾個地方,碼送不出去。每一條都對得到用途,加新的外部服務要記得補:
//   api.open-meteo.com           今日推薦的天氣
//   staticimgly.com              去背模型(第一次約 80MB)與它的 WASM 執行檔
//   www.gu-global.com/uniqlo.com 貼連結挑圖:縮圖要顯示、大圖要下載回來去背
//   blob: / data:                自己加的衣服(IndexedDB 的圖)、去背中間結果、匯入備份檔裡的圖;
//                                字型的 data: 是 Vite 把小於 4KB 的字型檔直接內嵌進 CSS
//   'wasm-unsafe-eval' + blob:   去背的 WASM 執行檔是先下載成 blob 再載入的(onnxruntime-web)
//   'unsafe-eval'                去背套件裡的 ndarray 用 new Function 產生建構函式;不給的話去背直接失敗
//                                (2026-10-03 本機掛同一組標頭實測)。網站自己的程式沒有 eval;
//                                主要的防線(不准內嵌 <script>、不准從別的網域載程式、只能連上面這幾個地方)都還在
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data: https://api.open-meteo.com https://staticimgly.com https://www.gu-global.com https://www.uniqlo.com",
  "img-src 'self' blob: data: https://www.gu-global.com https://www.uniqlo.com",
  "style-src 'self'",
  "font-src 'self' data:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 麥克風給搭配頁的「用說的」。相機不關:新增衣服的選照片在 Android 上會給「拍照」,不確定會不會被這條擋到
  { key: "Permissions-Policy", value: "geolocation=(), payment=(), usb=(), microphone=(self)" },
];
await writeFile(join(OUT, "vercel.json"), JSON.stringify({
  git: { deploymentEnabled: false },
  headers: [{ source: "/(.*)", headers: SECURITY_HEADERS }],
}, null, 2) + "\n");

const dataDir = join(OUT, "data");
await mkdir(join(dataDir, "library"), { recursive: true });
await copyFile(join(ROOT, "data", "library.json"), join(dataDir, "wardrobe.json"));
for (const f of assets) {
  await copyFile(join(ROOT, "data", "imported", f), join(dataDir, "library", f));
}
console.log(`匯出完成:wardrobe-gallery/(${library.length} 件、${assets.length} 個圖檔)→ cd wardrobe-gallery && vercel deploy --prod --yes`);
