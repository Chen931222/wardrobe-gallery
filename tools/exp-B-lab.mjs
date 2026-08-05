// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
// exp-B — 路線 B:LAB b* 通道放大去背
//
// 核心觀察(由 tools/exp-B-diag.mjs 量到):
//   IMG_4324 白 adidas:衣物 b*≈5,床單 b*≈23,L* 兩者都在 53~58 → 明度完全無法分,b* 差 18
//   IMG_4332 淺灰褲:衣物 b*≈2.5,床單 b*≈22,b* 直方圖在 7~16 之間是空的
// 所以 b* 是這兩張圖唯一乾淨的分離軸。
//
// 流程(分 phase 跑成獨立子程序,因為 sharp 0.34 與 @imgly 內建的 sharp 0.32 不能同載):
//   prep    (sharp)  原圖 → 縮到工作解析度 → 算 LAB → 產出
//                      enhanced.png:床單被塗成飽和綠幕、衣物保留原貌(給 ML 看語意)
//                      bsoft.png   :純 b* 軟遮罩(精準邊緣)
//   seg     (@imgly) enhanced.png → removeBackground → mlmask.png(語意遮罩,決定「哪一塊」是衣服)
//   combine (sharp)  bsoft ∧ dilate(mlmask) → 最大連通塊 → 填洞 → 放大 → 套回原圖
//
// 設計理由:ML 遮罩負責「語意」(哪個連通塊是衣服、排除床頭板與旁邊的雜物),
// b* 遮罩負責「幾何」(邊緣在哪,精準到像素)。兩者各補對方的短處。
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const TMP = join(ROOT, "work", "exp", "tmp");
const OUT = join(ROOT, "work", "exp");

const arg = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};

const phase = arg("phase");
const file = arg("file");
const tag = arg("tag");
const LO = Number(arg("lo", "9"));    // b* 低於此 → 100% 衣物
const HI = Number(arg("hi", "16"));   // b* 高於此 → 100% 床單
const WORK = Number(arg("work", "2000"));
const DILATE = Number(arg("dilate", "40")); // ML 遮罩膨脹半徑(工作解析度像素)
const FEATHER = Number(arg("feather", "1.2"));
const ERODE = Number(arg("erode", "12"));   // 形態學開運算半徑,用來切斷「衣物↔床頭板」的細連接
const USEML = process.argv.includes("--useml");
const TOPCUT = Number(arg("topcut", "0"));  // 由上方裁掉的比例(床頭板保險絲)
const LFLOOR = Number(arg("lfloor", "0"));  // L* 下限:低於此的暗物(木床頭板、黑褲)剔除;0=關閉
const LWIDTH = Number(arg("lwidth", "8"));  // L* 閘門的軟過渡寬度
// L 閘門只作用在畫面上緣 LTOP 比例內(床頭板/牆在最上方,那裡衣物只有純白帽子、
// 沒有深色縫線,所以不會誤傷)。0 = 全圖套用(通常會切爛縫線,別用)。
const LTOP = Number(arg("ltop", "0"));

const enhanced = join(TMP, `${tag}-enhanced.png`);
const bsoft = join(TMP, `${tag}-bsoft.png`);
const mlmask = join(TMP, `${tag}-mlmask.png`);
const final = join(OUT, `${tag}.png`);

// ---------- LAB ----------
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const fLab = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
function labOf(r, g, b) {
  const R = srgbToLin(r / 255), G = srgbToLin(g / 255), B = srgbToLin(b / 255);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1.0;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
  return [116 * fy - 16, 200 * (fy - fz)]; // [L*, b*]
}

// ---------- 形態學 / 連通塊 ----------
function dilateBin(src, W, H, r) {
  if (r <= 0) return src;
  // 用兩趟一維最大值(可分離),O(N) 不是 O(N·r²)
  const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let m = 0;
      for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < W && src[y * W + xx]) { m = 1; break; } }
      tmp[y * W + x] = m;
    }
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let m = 0;
      for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < H && tmp[yy * W + x]) { m = 1; break; } }
      out[y * W + x] = m;
    }
  }
  return out;
}

function erodeBin(src, W, H, r) {
  if (r <= 0) return src;
  const inv = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) inv[i] = src[i] ? 0 : 1;
  const d = dilateBin(inv, W, H, r);
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = d[i] ? 0 : 1;
  return out;
}

function largestComponent(bin, W, H) {
  const lab = new Int32Array(W * H).fill(-1);
  const stack = new Int32Array(W * H);
  let best = null, bestSize = 0, id = 0;
  for (let s = 0; s < W * H; s++) {
    if (!bin[s] || lab[s] !== -1) continue;
    let sp = 0, size = 0;
    stack[sp++] = s; lab[s] = id;
    const members = [];
    while (sp > 0) {
      const p = stack[--sp]; members.push(p); size++;
      const x = p % W, y = (p / W) | 0;
      if (x > 0 && bin[p - 1] && lab[p - 1] === -1) { lab[p - 1] = id; stack[sp++] = p - 1; }
      if (x < W - 1 && bin[p + 1] && lab[p + 1] === -1) { lab[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && bin[p - W] && lab[p - W] === -1) { lab[p - W] = id; stack[sp++] = p - W; }
      if (y < H - 1 && bin[p + W] && lab[p + W] === -1) { lab[p + W] = id; stack[sp++] = p + W; }
    }
    if (size > bestSize) { bestSize = size; best = members; }
    id++;
  }
  const out = new Uint8Array(W * H);
  if (best) for (const p of best) out[p] = 1;
  return { mask: out, size: bestSize };
}

// 填洞:從邊界灌水填「背景」,沒被灌到的 0 就是內部洞
function fillHoles(bin, W, H) {
  const outside = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let sp = 0;
  const push = (p) => { if (!bin[p] && !outside[p]) { outside[p] = 1; stack[sp++] = p; } };
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
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = bin[i] || !outside[i] ? 1 : 0;
  return out;
}

// ================= phases =================
if (!phase) {
  await mkdir(TMP, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const pass = ["--file", file, "--tag", tag, "--lo", String(LO), "--hi", String(HI),
    "--work", String(WORK), "--dilate", String(DILATE), "--feather", String(FEATHER),
    "--erode", String(ERODE), "--topcut", String(TOPCUT),
    "--lfloor", String(LFLOOR), "--lwidth", String(LWIDTH), ...(USEML ? ["--useml"] : [])];
  const run = (p) => execFileSync(process.execPath, [SELF, "--phase", p, ...pass], { stdio: "inherit" });
  run("prep");
  if (USEML) run("seg");
  run("combine");

} else if (phase === "prep") {
  const { default: sharp } = await import("sharp");
  const src = sharp(join(ROOT, "photos", file)).rotate();
  const meta = await src.metadata();
  const long = Math.max(meta.width, meta.height);
  const scale = WORK / long;
  const { data, info } = await sharp(join(ROOT, "photos", file)).rotate()
    .resize({ width: Math.round(meta.width * scale) })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;

  const rgb = Buffer.alloc(W * H * 3);
  const soft = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const [ls, bs] = labOf(r, g, b);
    // t=0 衣物 / t=1 床單(b* 軸:床單偏黃)
    const t = Math.max(0, Math.min(1, (bs - LO) / (HI - LO)));
    // L* 閘門:暗物(木床頭板 L*~35、黑褲 L*~27)剔除,衣物 L*>58 保留
    const gL = LFLOOR > 0 ? Math.max(0, Math.min(1, (ls - (LFLOOR - LWIDTH)) / LWIDTH)) : 1;
    soft[i] = Math.round((1 - t) * gL * 255);
    // 強化圖:床單 → 飽和綠幕(模型絕不會判成衣服),衣物 → 原色但稍微提對比
    const gr = [0, 190, 90];
    rgb[i * 3]     = Math.round(r * (1 - t) + gr[0] * t);
    rgb[i * 3 + 1] = Math.round(g * (1 - t) + gr[1] * t);
    rgb[i * 3 + 2] = Math.round(b * (1 - t) + gr[2] * t);
  }
  await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).png().toFile(enhanced);
  await sharp(soft, { raw: { width: W, height: H, channels: 1 } }).png().toFile(bsoft);
  console.log(`prep: ${W}x${H} lo=${LO} hi=${HI}`);

} else if (phase === "seg") {
  const { removeBackground } = await import("@imgly/background-removal-node");
  const { writeFile } = await import("node:fs/promises");
  const blob = await removeBackground(pathToFileURL(enhanced).href, {
    model: "medium", output: { format: "image/png", quality: 0.9 },
  });
  await writeFile(mlmask, Buffer.from(await blob.arrayBuffer()));
  console.log("seg: ok");

} else if (phase === "combine") {
  const { default: sharp } = await import("sharp");
  const bs = await sharp(bsoft).raw().toBuffer({ resolveWithObject: true });
  const W = bs.info.width, H = bs.info.height;
  // 地雷:sharp 存 1-channel PNG 讀回來可能是 3 channel,一定要照實際 stride 取樣,
  // 否則只會讀到影像的前 1/3(而且錯位)。
  const ch = bs.info.channels;
  const soft = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) soft[i] = bs.data[i * ch];

  // 1. b* 硬遮罩(這才是真正的分割器 —— ML 在這兩張圖上完全失效)
  const hard = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) hard[i] = soft[i] > 128 ? 1 : 0;
  // 保險絲:床頭板/牆面在畫面最上緣,b* 也偏中性,必要時直接切掉
  if (TOPCUT > 0) { const cut = Math.round(H * TOPCUT); for (let i = 0; i < cut * W; i++) hard[i] = 0; }

  // 2. 開運算:侵蝕切斷「衣物 ↔ 床頭板」的細連接,取最大塊,再膨脹回來
  const eroded = erodeBin(hard, W, H, ERODE);
  let seedPick = largestComponent(eroded, W, H);
  if (USEML) {
    // 用 ML 遮罩挑「哪一塊是衣服」(它的語意判斷可信,幾何不可信)
    const ml = await sharp(mlmask).resize(W, H, { fit: "fill" }).ensureAlpha().raw().toBuffer();
    let hit = 0;
    for (let i = 0; i < W * H; i++) if (seedPick.mask[i] && ml[i * 4 + 3] > 100) hit++;
    console.log(`combine: ML 與所選塊重疊 ${(100 * hit / Math.max(1, seedPick.size)).toFixed(1)}%`);
  }
  const grown = dilateBin(seedPick.mask, W, H, ERODE + 2);
  const kept = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) kept[i] = hard[i] && grown[i] ? 1 : 0;

  // 3. 只留與種子相連的部分,再填洞
  const cc = largestComponent(kept, W, H);
  const filled = fillHoles(cc.mask, W, H);

  // 4. 內部強制不透明(避免衣物上偏黃的皺褶/陰影變半透明),只有最外 2px 用 b* 軟邊做抗鋸齒
  const interior = erodeBin(filled, W, H, 2);
  const out = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) {
    out[i] = !filled[i] ? 0 : interior[i] ? 255 : Math.max(soft[i], 128);
  }

  console.log(`combine: seed ${(100 * seedPick.size / (W * H)).toFixed(1)}% → final ${(100 * cc.size / (W * H)).toFixed(1)}% of frame`);

  if (process.env.DEBUG_MASKS) {
    const dump = async (arr, name) => {
      const b = Buffer.alloc(W * H); for (let i = 0; i < W * H; i++) b[i] = arr[i] ? 255 : 0;
      await sharp(b, { raw: { width: W, height: H, channels: 1 } }).resize({ width: 480 }).png().toFile(join(OUT, `dbg-${tag}-${name}.png`));
    };
    await dump(hard, "hard"); await dump(seedPick.mask, "seed"); await dump(cc.mask, "cc"); await dump(filled, "filled");
    let cnt = 0; for (let i = 0; i < W * H; i++) if (hard[i]) cnt++;
    console.log(`DEBUG hard=${(100 * cnt / (W * H)).toFixed(1)}% filled=${(100 * (() => { let c = 0; for (let i = 0; i < W * H; i++) if (filled[i]) c++; return c; })() / (W * H)).toFixed(1)}%`);
  }

  if (process.env.DEBUG_MASKS) {
    let h = new Array(16).fill(0); for (let i = 0; i < W * H; i++) h[out[i] >> 4]++;
    console.log("DEBUG out hist:", h.map((c, i) => c > W * H * 0.02 ? `${i * 16}:${(100 * c / (W * H)).toFixed(0)}%` : null).filter(Boolean).join(" "));
    await sharp(out, { raw: { width: W, height: H, channels: 1 } }).png().toFile(join(OUT, `dbg-${tag}-out.png`));
  }

  // 組成「黑底 + alpha=遮罩」的 RGBA 圖。
  // 地雷(害我卡很久):sharp(rawBuf,{raw:channels:1}).raw().toBuffer() 會把單通道
  // 灌成 3 通道 sRGB(buffer 變 3 倍長)。若還用 alphaBuf[i] 讀,只會拿到最上面
  // 1/3 而且 RGB 交錯的亂碼 → 遮罩全毀。所以 alpha 直接用手上乾淨的 out;要羽化時
  // 才過 sharp,並且照實際 channels 取 stride。
  let alphaBuf = out;
  if (FEATHER > 0) {
    const b = await sharp(out, { raw: { width: W, height: H, channels: 1 } })
      .blur(FEATHER).toColourspace("b-w").raw().toBuffer({ resolveWithObject: true });
    const bch = b.info.channels;
    alphaBuf = Buffer.alloc(W * H);
    for (let i = 0; i < W * H; i++) alphaBuf[i] = b.data[i * bch];
  }
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) rgba[i * 4 + 3] = alphaBuf[i]; // RGB=0, A=mask
  const maskRGBA = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();

  // 5. 放大 RGBA 遮罩,blend:"dest-in" 用它的 alpha 去乘原圖。
  //    地雷:遮罩一定要帶 alpha 通道;灰階圖沒 alpha,dest-in 會當成全不透明(整張都留)。
  const meta = await sharp(join(ROOT, "photos", file)).rotate().metadata();
  const fullMask = await sharp(maskRGBA).resize(meta.width, meta.height, { fit: "fill" }).png().toBuffer();
  await sharp(join(ROOT, "photos", file)).rotate().ensureAlpha()
    .composite([{ input: fullMask, blend: "dest-in" }])
    .trim({ threshold: 5 })
    .extend({ top: 30, bottom: 30, left: 30, right: 30, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toFile(final);
  console.log(`combine: wrote ${final}`);
}
