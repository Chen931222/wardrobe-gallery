// tools/shoe-check.mjs — 只檢查這批鞋的去背成品:實心度 + 併一張聯絡表方便肉眼看。
// 淺色鞋(米白帆布、米白麂皮)在灰白磨石子地上是高風險組合,所以先量再入庫。
import sharp from "sharp";
import { existsSync } from "node:fs";

const SLUGS = [
  "tods-black-leather-sneaker", "nike-red-mesh-runner", "nike-cream-suede-retro",
  "adidas-burgundy-suede-court", "nb-1000-grey-runner", "cream-canvas-zip-hightop",
  "ua-project-rock-slide",
];

const CELL = 300;
const tiles = [];
console.log("成品".padEnd(30), "尺寸".padEnd(12), "不透明%", "半透明%", "邊緣", "判定");

for (const slug of SLUGS) {
  const path = `work/items/${slug}.png`;
  if (!existsSync(path)) { console.log(slug.padEnd(30), "  — 還沒產出"); continue; }
  const img = sharp(path);
  const { width: w, height: h } = await img.metadata();
  const { data } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaque = 0, partial = 0, edge = 0;
  const total = w * h;
  for (let i = 0; i < total; i++) {
    const a = data[i * 4 + 3];
    if (a > 240) opaque++; else if (a > 25) partial++;
  }
  for (let x = 0; x < w; x++) { if (data[x * 4 + 3] > 200) edge++; if (data[((h - 1) * w + x) * 4 + 3] > 200) edge++; }
  for (let y = 0; y < h; y++) { if (data[y * w * 4 + 3] > 200) edge++; if (data[(y * w + w - 1) * 4 + 3] > 200) edge++; }
  const op = 100 * opaque / total, pa = 100 * partial / total;
  const ghost = op < 12 || pa > op * 0.8;
  console.log(slug.padEnd(30), `${w}x${h}`.padEnd(12), op.toFixed(1).padStart(6), pa.toFixed(1).padStart(7),
    String(edge).padStart(5), ghost ? "  ✗ 鬼影/殘缺" : "  ✓ 實心");

  // 聯絡表格子:鋪中灰底,淺色鞋才看得出破洞
  tiles.push(await sharp({ create: { width: CELL, height: CELL, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 1 } } })
    .composite([{ input: await sharp(path).resize(CELL - 20, CELL - 20, { fit: "inside" }).png().toBuffer(), gravity: "center" }])
    .png().toBuffer());
}

if (tiles.length) {
  const cols = 4, rows = Math.ceil(tiles.length / cols);
  await sharp({ create: { width: cols * CELL, height: rows * CELL, channels: 4, background: { r: 40, g: 40, b: 40, alpha: 1 } } })
    .composite(tiles.map((input, i) => ({ input, left: (i % cols) * CELL, top: Math.floor(i / cols) * CELL })))
    .jpeg({ quality: 82 }).toFile("work/shoe-sheet.jpg");
  console.log("\n聯絡表:work/shoe-sheet.jpg");
}
