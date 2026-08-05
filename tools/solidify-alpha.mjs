// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
// 把半透明鬼影補實:alpha 曲線 a>=96 → 255、a<=25 → 0、中間線性放大。
// 直接改 data/imported/ 裡的正式檔(不動 library.json,id 不變)。
import sharp from "sharp";
import { readFile } from "node:fs/promises";

const NAMES = process.argv.slice(2);
const lib = JSON.parse(await readFile("data/library.json", "utf8"));

for (const key of NAMES) {
  const item = lib.find((i) => i.name.includes(key));
  if (!item) { console.error("找不到:", key); continue; }
  const path = `data/imported/${item.id}-garment.png`;
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let boosted = 0;
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    if (a >= 96) { if (a !== 255) { data[i] = 255; boosted++; } }
    else if (a <= 25) data[i] = 0;
    else { data[i] = Math.min(255, Math.round((a - 25) * 3.6)); boosted++; }
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png().toFile(path + ".tmp");
  const { rename } = await import("node:fs/promises");
  await rename(path + ".tmp", path);
  console.log(`✓ ${item.name} — 調整 ${boosted} 像素`);
}
