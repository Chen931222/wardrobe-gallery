// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
// tools/D-solid.mjs — 只用 sharp。把 @imgly 給的「形狀對但半透明」遮罩實心化,
// 再用色度鍵(chroma key)修邊,最後貼回原圖。
//
// 為什麼要這樣做:模型對 keynavy 圖的輪廓判斷是準的,但衣物內部因為平坦無特徵,
// 信心值只有 90~160(/255),直接輸出就是鬼影。所以流程是:
//   1) 拉伸 → 二值化 → 補洞 → 取最大連通區  = 正確的實心剪影
//   2) 剪影往內縮 erode 得到「核心區」,核心區一律 255,保證衣服不會破洞
//   3) 剪影往外擴 dilate 得到「邊緣帶」,邊緣帶交給色度鍵決定,拿回模型切掉的邊
//   4) 邊緣帶外一律 0
// 這樣兼顧「內部絕不破洞」與「邊緣不殘留床單」。
import sharp from "sharp";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};
const has = (n) => process.argv.includes(`--${n}`);

const seg = arg("seg"), src = arg("src"), out = arg("out");
const LONG = +arg("long", 2600);
const FLOOR = +arg("floor", 25), CEIL = +arg("ceil", 110);
const ERODE = +arg("erode", 14), DILATE = +arg("dilate", 8);
const T0 = +arg("t0", 0.15), T1 = +arg("t1", 0.25);
const FEATHER = +arg("feather", 1.2);
const debug = arg("debug", null);

// ---- 載入原圖 ----
const rgbBuf = await sharp(src).rotate().resize({ height: LONG, fit: "inside" }).removeAlpha().toBuffer();
const { data: px, info } = await sharp(rgbBuf).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels, N = W * H;

// ---- 色度鍵:正規化 b*(黃-藍軸) ----
const k = new Float32Array(N);
for (let p = 0; p < N; p++) {
  const i = p * C, r = px[i], g = px[i + 1], b = px[i + 2];
  const L = Math.max(12, (r + g + b) / 3);
  const bs = ((r + g) / 2 - b) / L;
  k[p] = Math.min(1, Math.max(0, (bs - T0) / (T1 - T0)));
}

// ---- 模型 alpha → 拉伸 → 二值 ----
const a = await sharp(seg).ensureAlpha().extractChannel("alpha")
  .resize(W, H, { fit: "fill", kernel: "cubic" }).raw().toBuffer();
const bin = new Uint8Array(N);
for (let p = 0; p < N; p++) {
  const s = (a[p] - FLOOR) / (CEIL - FLOOR);
  bin[p] = s > 0.5 ? 1 : 0;
}

// ---- 最大連通區(4-連通 BFS),清掉零星雜點 ----
{
  const lab = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  let best = -1, bestSize = 0, cur = 0;
  for (let s = 0; s < N; s++) {
    if (bin[s] === 0 || lab[s] !== -1) continue;
    let sp = 0, size = 0;
    stack[sp++] = s; lab[s] = cur;
    while (sp > 0) {
      const p = stack[--sp]; size++;
      const x = p % W, y = (p / W) | 0;
      if (x > 0 && bin[p - 1] && lab[p - 1] === -1) { lab[p - 1] = cur; stack[sp++] = p - 1; }
      if (x < W - 1 && bin[p + 1] && lab[p + 1] === -1) { lab[p + 1] = cur; stack[sp++] = p + 1; }
      if (y > 0 && bin[p - W] && lab[p - W] === -1) { lab[p - W] = cur; stack[sp++] = p - W; }
      if (y < H - 1 && bin[p + W] && lab[p + W] === -1) { lab[p + W] = cur; stack[sp++] = p + W; }
    }
    if (size > bestSize) { bestSize = size; best = cur; }
    cur++;
  }
  for (let p = 0; p < N; p++) if (bin[p] && lab[p] !== best) bin[p] = 0;
  console.error(`largest component: ${(100 * bestSize / N).toFixed(1)}% of frame`);
}

// ---- 補洞:從邊框往內灌背景,灌不到的 0 像素就是內部破洞,補成 1 ----
{
  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  const push = (p) => { if (!seen[p] && bin[p] === 0) { seen[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (sp > 0) {
    const p = stack[--sp];
    const x = p % W, y = (p / W) | 0;
    if (x > 0) push(p - 1);
    if (x < W - 1) push(p + 1);
    if (y > 0) push(p - W);
    if (y < H - 1) push(p + W);
  }
  let filled = 0;
  for (let p = 0; p < N; p++) if (bin[p] === 0 && !seen[p]) { bin[p] = 1; filled++; }
  console.error(`holes filled: ${filled} px`);
}

// ---- 可分離的方形 min/max 濾波 = 侵蝕/膨脹 ----
function morph(srcArr, r, isMax) {
  if (r <= 0) return srcArr.slice();
  const pick = isMax ? Math.max : Math.min;
  const tmp = new Uint8Array(N), dst = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let v = srcArr[row + x];
      for (let d = -r; d <= r; d++) {
        const xx = x + d;
        if (xx >= 0 && xx < W) v = pick(v, srcArr[row + xx]);
      }
      tmp[row + x] = v;
    }
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let v = tmp[y * W + x];
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        if (yy >= 0 && yy < H) v = pick(v, tmp[yy * W + x]);
      }
      dst[y * W + x] = v;
    }
  }
  return dst;
}

// ---- 邊緣處理:填實後的剪影已經很乾淨,只需要小幅侵蝕把可能沾到的床單邊緣帶收回 ----
// 另外用色度鍵做保險:邊界帶(shape 但非 core)若強烈偏黃(k 高)就砍掉,避免床單殘留。
const shape = bin;                        // 已經是「最大連通區 + 補洞」的實心剪影
const core = morph(shape, ERODE, false);  // 內縮 ERODE:一定是衣服的核心,強制不透明
const alpha = Buffer.alloc(N);
for (let p = 0; p < N; p++) {
  if (!shape[p]) { alpha[p] = 0; continue; }
  if (core[p]) { alpha[p] = 255; continue; }   // 核心:實心
  // 邊界帶:預設保留,但明顯是床單黃(k 接近 1)就砍
  alpha[p] = k[p] > 0.6 ? 0 : 255;
}

// 羽化(選配):對 alpha 單通道做高斯模糊
let alphaFinal = alpha;
if (FEATHER > 0) {
  alphaFinal = await sharp(alpha, { raw: { width: W, height: H, channels: 1 } })
    .blur(FEATHER).raw().toBuffer();
}

if (debug) {
  await sharp(alphaFinal, { raw: { width: W, height: H, channels: 1 } })
    .jpeg({ quality: 85 }).toFile(debug);
}

// 直接組 RGBA:用原圖色彩 + 我們算出的 alpha,不靠 composite(避免灰階 PNG 無 alpha 通道的坑)
const rgba = Buffer.alloc(N * 4);
for (let p = 0; p < N; p++) {
  const s = p * C, d = p * 4;
  rgba[d] = px[s]; rgba[d + 1] = px[s + 1]; rgba[d + 2] = px[s + 2];
  rgba[d + 3] = alphaFinal[p];
}

await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
  .trim({ threshold: 12 })
  .extend({ top: 24, bottom: 24, left: 24, right: 24, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 }).toFile(out);

console.log("solid ->", out);
