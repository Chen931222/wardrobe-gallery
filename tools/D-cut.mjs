// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
// tools/D-cut.mjs — 只用 sharp。乾淨版:把 @imgly 遮罩 → 二值 → 最大連通區 → 補洞 → 收邊 → 羽化 → 套回原圖。
// 路線 D 的產出腳本。刻意不做花俏的色度鍵重組(那版會把 alpha 搞爛),
// 因為「二值化後補洞」的實心剪影已經正確;色度鍵只在 --keycut 時用來砍掉明顯偏黃的邊界床單。
//
//   node tools/D-cut.mjs --seg seg.png --src orig.JPG --out out.png
//     [--long 2600] [--bin 0.30] [--erode 4] [--feather 2] [--keycut 0.62] [--debug dbg.jpg]
import sharp from "sharp";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 && process.argv[i+1] && !process.argv[i+1].startsWith("--") ? process.argv[i+1] : d; };
const seg = arg("seg"), src = arg("src"), out = arg("out"), debug = arg("debug", null);
const LONG = +arg("long", 2600);
const BIN = +arg("bin", 0.30);        // 二值門檻:model alpha 正規化後 > BIN 當前景
const ERODE = +arg("erode", 4);       // 收邊 px:避免床單邊緣殘留
const FEATHER = +arg("feather", 2);
const KEYCUT = +arg("keycut", 0);     // >0 時,邊界帶 b* 正規化 > KEYCUT 直接砍(去床單黃邊)
const T0 = +arg("t0", 0.13), T1 = +arg("t1", 0.24);

// 原圖(EXIF 轉正)縮到長邊 LONG,取 raw RGB
const rgbBuf = await sharp(src).rotate().resize({ height: LONG, fit: "inside" }).removeAlpha().toBuffer();
const { data: px, info } = await sharp(rgbBuf).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels, N = W * H;

// model alpha → 對齊到 W×H(同長寬比,uniform 縮放)
const a = await sharp(seg).ensureAlpha().extractChannel("alpha").resize(W, H, { fit: "fill", kernel: "cubic" }).raw().toBuffer();

// 二值
const bin = new Uint8Array(N);
for (let p = 0; p < N; p++) bin[p] = a[p] / 255 > BIN ? 1 : 0;

// 最大連通區(4-連通)
{
  const lab = new Int32Array(N).fill(-1), st = new Int32Array(N);
  let best = -1, bestSize = 0, cur = 0;
  for (let s = 0; s < N; s++) {
    if (!bin[s] || lab[s] !== -1) continue;
    let sp = 0, size = 0; st[sp++] = s; lab[s] = cur;
    while (sp) { const p = st[--sp]; size++; const x = p % W, y = (p / W) | 0;
      if (x > 0 && bin[p-1] && lab[p-1]<0){lab[p-1]=cur;st[sp++]=p-1;}
      if (x < W-1 && bin[p+1] && lab[p+1]<0){lab[p+1]=cur;st[sp++]=p+1;}
      if (y > 0 && bin[p-W] && lab[p-W]<0){lab[p-W]=cur;st[sp++]=p-W;}
      if (y < H-1 && bin[p+W] && lab[p+W]<0){lab[p+W]=cur;st[sp++]=p+W;} }
    if (size > bestSize){bestSize=size;best=cur;} cur++;
  }
  for (let p = 0; p < N; p++) if (bin[p] && lab[p] !== best) bin[p] = 0;
  console.error(`largest component ${(100*bestSize/N).toFixed(1)}%`);
}

// 補洞:邊框往內灌背景,灌不到的 0 → 內部破洞 → 填 1
{
  const seen = new Uint8Array(N), st = new Int32Array(N); let sp = 0;
  const push = (p) => { if (!seen[p] && !bin[p]) { seen[p] = 1; st[sp++] = p; } };
  for (let x = 0; x < W; x++){push(x);push((H-1)*W+x);} for (let y = 0; y < H; y++){push(y*W);push(y*W+W-1);}
  while (sp){const p=st[--sp];const x=p%W,y=(p/W)|0; if(x>0)push(p-1);if(x<W-1)push(p+1);if(y>0)push(p-W);if(y<H-1)push(p+W);}
  let f = 0; for (let p = 0; p < N; p++) if (!bin[p] && !seen[p]){bin[p]=1;f++;}
  console.error(`holes filled ${f}px`);
}

// 可選:色度鍵砍床單黃邊(只砍前景像素中明顯偏黃者)
if (KEYCUT > 0) {
  let cut = 0;
  for (let p = 0; p < N; p++) {
    if (!bin[p]) continue;
    const i = p * C, r = px[i], g = px[i+1], b = px[i+2];
    const L = Math.max(12, (r + g + b) / 3);
    const kk = Math.min(1, Math.max(0, (((r + g) / 2 - b) / L - T0) / (T1 - T0)));
    if (kk > KEYCUT) { bin[p] = 0; cut++; }
  }
  console.error(`keycut removed ${cut}px`);
  // 砍完再取一次最大連通區,避免留下零散黃點
}

// 可分離方形侵蝕(收邊)
function erode(sarr, r) {
  if (r <= 0) return sarr;
  const t = new Uint8Array(N), d = new Uint8Array(N);
  for (let y = 0; y < H; y++){ const row=y*W; for (let x=0;x<W;x++){ let v=1; for(let k=-r;k<=r;k++){const xx=x+k; if(xx<0||xx>=W||!sarr[row+xx]){v=0;break;}} t[row+x]=v; } }
  for (let x = 0; x < W; x++){ for (let y=0;y<H;y++){ let v=1; for(let k=-r;k<=r;k++){const yy=y+k; if(yy<0||yy>=H||!t[yy*W+x]){v=0;break;}} d[y*W+x]=v; } }
  return d;
}
const finalBin = erode(bin, ERODE);

// 二值 → alpha buffer → 羽化(用 JS box blur,不用 sharp 的 blur:
// sharp 對 raw 單通道 buffer 做 .blur() 會把資料搞成整片漸層,實測會毀掉遮罩)
let alpha = new Float32Array(N);
for (let p = 0; p < N; p++) alpha[p] = finalBin[p] ? 255 : 0;
function boxBlur(src, r) {
  if (r <= 0) return src;
  const t = new Float32Array(N), d = new Float32Array(N), win = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    const row = y * W; let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(W - 1, Math.max(0, k))];
    for (let x = 0; x < W; x++) {
      t[row + x] = acc / win;
      const xout = Math.max(0, x - r), xin = Math.min(W - 1, x + r + 1);
      acc += src[row + xin] - src[row + xout];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += t[Math.min(H - 1, Math.max(0, k)) * W + x];
    for (let y = 0; y < H; y++) {
      d[y * W + x] = acc / win;
      const yout = Math.max(0, y - r), yin = Math.min(H - 1, y + r + 1);
      acc += t[yin * W + x] - t[yout * W + x];
    }
  }
  return d;
}
if (FEATHER > 0) { alpha = boxBlur(alpha, FEATHER); alpha = boxBlur(alpha, FEATHER); }
const alphaU8 = Buffer.alloc(N);
for (let p = 0; p < N; p++) alphaU8[p] = Math.round(Math.min(255, Math.max(0, alpha[p])));
alpha = alphaU8;

if (debug) await sharp(alpha, { raw: { width: W, height: H, channels: 1 } }).jpeg({ quality: 88 }).toFile(debug);

// 組 RGBA(原色 + alpha),trim
const rgba = Buffer.alloc(N * 4);
for (let p = 0; p < N; p++) { const s = p*C, d = p*4; rgba[d]=px[s];rgba[d+1]=px[s+1];rgba[d+2]=px[s+2];rgba[d+3]=alpha[p]; }
await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
  .trim({ threshold: 12 })
  .extend({ top: 24, bottom: 24, left: 24, right: 24, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 }).toFile(out);
console.log("cut ->", out);
