// tools/close-alpha.mjs — 對 alpha 遮罩做形態學閉運算(先膨脹再侵蝕),補起「細縫狀」的破洞。
//
// 為什麼需要:白色/淺色衣服去背時,模型常常只把深色細節(條紋、車線、印花)判為前景,
// 中間的白布 alpha 低到被當背景清掉,成品變成一條一條的破布。這種洞不是封閉的孤島
// (fill-holes.mjs 補不到,它們往往從下襬開口通到外面),但寬度很小 —— 只要膨脹半徑
// 大於縫寬就會被橋接起來,再侵蝕回去,輪廓幾乎不變。
//
// 用法:node tools/close-alpha.mjs --slug padres-white-pinstripe-jersey --radius 20
//   --radius 要略大於縫寬(白條紋球衣的條紋間距約 12px → 用 20)。
//   半徑太大會把袖子和身體之間的空隙也黏起來,改完一定要目視驗收。
import sharp from "sharp";
import { rename } from "node:fs/promises";

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};

const slug = arg("slug");
const radius = Number(arg("radius", 20));
const path = arg("path", slug ? `work/items/${slug}.png` : null);
if (!path) { console.error("需要 --slug 或 --path"); process.exit(1); }

const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;

// 以 1 byte/px 的二值遮罩運算,比在 RGBA 上跑快得多
let mask = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) mask[i] = data[i * 4 + 3] > 127 ? 1 : 0;

// 可分離的膨脹/侵蝕:先做橫向再做縱向,等同於方形結構元素,複雜度從 O(N·r²) 降到 O(N·r)
const sweep = (src, take) => {
  const tmp = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let v = src[row + x];
      for (let d = 1; d <= radius; d++) {
        if (x - d >= 0) v = take(v, src[row + x - d]);
        if (x + d < W) v = take(v, src[row + x + d]);
      }
      tmp[row + x] = v;
    }
  }
  const out = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let v = tmp[y * W + x];
      for (let d = 1; d <= radius; d++) {
        if (y - d >= 0) v = take(v, tmp[(y - d) * W + x]);
        if (y + d < H) v = take(v, tmp[(y + d) * W + x]);
      }
      out[y * W + x] = v;
    }
  }
  return out;
};

const before = mask.reduce((n, v) => n + v, 0);
mask = sweep(mask, Math.max);   // 膨脹:縫隙被橋接
mask = sweep(mask, Math.min);   // 侵蝕:輪廓縮回原尺寸
const after = mask.reduce((n, v) => n + v, 0);

// 被補起來的像素沒有原始顏色可用(它們原本是背景)。用「從原有前景向外 BFS 擴散」補色,
// 每個新像素抄離它最近的原始像素 —— 等同最近鄰補色。
// 別用全域平均色:白條紋球衣試過,整個下半身被填成 #b1aa9d 的髒灰,一眼就看得出來。
const needColor = new Uint8Array(W * H);
let filled = 0;
for (let i = 0; i < W * H; i++) {
  if (mask[i] && data[i * 4 + 3] <= 127) { needColor[i] = 1; filled++; }
  data[i * 4 + 3] = mask[i] ? 255 : 0;
}

const queue = new Int32Array(W * H);
let head = 0, tail = 0;
for (let i = 0; i < W * H; i++) if (mask[i] && !needColor[i]) queue[tail++] = i;   // 原始前景當種子
while (head < tail) {
  const p = queue[head++];
  const x = p % W, y = (p / W) | 0;
  for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
    if (q < 0 || !needColor[q]) continue;
    needColor[q] = 0;
    data[q * 4] = data[p * 4]; data[q * 4 + 1] = data[p * 4 + 1]; data[q * 4 + 2] = data[p * 4 + 2];
    queue[tail++] = q;
  }
}

await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toFile(`${path}.tmp`);
await rename(`${path}.tmp`, path);
const pct = (v) => (100 * v / (W * H)).toFixed(1) + "%";
console.log(`${path.split("/").pop()}  半徑 ${radius}:覆蓋 ${pct(before)} → ${pct(after)},最近鄰補色 ${filled} px`);
