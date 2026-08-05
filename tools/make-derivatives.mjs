// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
// tools/make-derivatives.mjs — 產生縮圖與顯示尺寸的 WebP,並把 library.json 指向它們。
//
// 為什麼需要:去背後的 PNG 是相機原始解析度(常見 4000x7000、單張 10-27MB),
// 但畫廊格子只顯示約 180px。原本 thumbnail 和 image 都指向原檔,等於一次下載數百 MB。
// OptimizedImage 對 /api/ 路徑會跳過 IPX,靜態部署也沒有 IPX 伺服器,所以只能預先產檔。
//
// 產出(與原檔放在一起):
//   {id}-thumb.webp  最長邊 460px   → 畫廊格子、搭配頁衣架
//   {id}-view.webp   最長邊 1400px  → 單品檢視、人形試穿
// 原始 PNG 保留為真實來源,但不會部署上線。
//
// 用法:每次跑完 import-to-wardrobe.mjs 之後執行一次
//   node tools/make-derivatives.mjs
import sharp from "sharp";
import { readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";

const DIR = "data/imported";
const THUMB = 460;
const VIEW = 1400;

const lib = JSON.parse(await readFile("data/library.json", "utf8"));
let before = 0, after = 0, made = 0;

for (const item of lib) {
  const source = `${DIR}/${item.id}-garment.png`;
  if (!existsSync(source)) { console.warn("缺少原檔:", item.name); continue; }
  before += (await stat(source)).size;

  const thumbName = `${item.id}-thumb.webp`;
  const viewName = `${item.id}-view.webp`;

  // withoutEnlargement:小圖不要被放大,免得糊掉又變大
  await sharp(source).resize(THUMB, THUMB, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90 }).toFile(`${DIR}/${thumbName}`);
  await sharp(source).resize(VIEW, VIEW, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 86, alphaQuality: 92 }).toFile(`${DIR}/${viewName}`);

  after += (await stat(`${DIR}/${thumbName}`)).size + (await stat(`${DIR}/${viewName}`)).size;
  item.thumbnail = `/api/import/library/${thumbName}`;
  item.image = `/api/import/library/${viewName}`;
  made += 1;
}

await writeFile("data/library.json", JSON.stringify(lib, null, 2));
const mb = (n) => (n / 1024 / 1024).toFixed(1) + " MB";
console.log(`${made} 件:原檔 ${mb(before)} → 衍生檔 ${mb(after)}(${(100 - after / before * 100).toFixed(1)}% 縮減)`);
