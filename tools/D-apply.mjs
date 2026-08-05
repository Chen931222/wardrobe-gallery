// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
// tools/D-apply.mjs --seg <去背結果.png> --src <原圖.JPG> --out <輸出.png> [--long 2600] [--gamma 1] [--floor 0] [--trim]
// 只用 sharp。從分割結果抽出 alpha,放大回目標尺寸,套回「原始色彩」的圖上。
import sharp from "sharp";

const arg = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};
const has = (n) => process.argv.includes(`--${n}`);

const seg = arg("seg"), src = arg("src"), out = arg("out");
const LONG = Number(arg("long", 2600));
const GAMMA = Number(arg("gamma", 1));      // <1 讓半透明變實心
const FLOOR = Number(arg("floor", 0));      // 低於此值直接歸零,清掉薄霧
const CEIL = Number(arg("ceil", 255));      // 高於此值直接補滿 255

// 目標尺寸:原圖 EXIF 轉正後縮到長邊 LONG
const target = sharp(src).rotate().resize({ height: LONG, fit: "inside" });
const rgb = await target.clone().removeAlpha().toBuffer();
const meta = await sharp(rgb).metadata();
const W = meta.width, H = meta.height;

// 分割結果的 alpha → 放大到 W x H
let alpha = await sharp(seg).ensureAlpha().extractChannel("alpha")
  .resize(W, H, { fit: "fill", kernel: "cubic" }).raw().toBuffer();

if (GAMMA !== 1 || FLOOR > 0 || CEIL < 255) {
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    let a = v / 255;
    a = Math.pow(a, GAMMA);
    let x = Math.round(a * 255);
    if (v <= FLOOR) x = 0;
    if (v >= CEIL) x = 255;
    lut[v] = x;
  }
  for (let i = 0; i < alpha.length; i++) alpha[i] = lut[alpha[i]];
}

const maskPng = await sharp(alpha, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();

let pipe = sharp(rgb).ensureAlpha().composite([{ input: maskPng, blend: "dest-in" }]);
if (has("trim")) {
  const trimmed = await pipe.png().toBuffer();
  pipe = sharp(trimmed).trim({ threshold: 12 }).extend({
    top: 30, bottom: 30, left: 30, right: 30,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
}
await pipe.png({ compressionLevel: 9 }).toFile(out);
console.log("apply ->", out, W + "x" + H);
