// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
// tools/D-prep.mjs <srcPhoto> <outPrefix> — 只用 sharp。
// 路線 D:通道重映射 / 色相旋轉,把米黃床單與中性白衣物在 RGB 上推開。
//
// 核心判別量:正規化的 b*(黃-藍軸)= ((R+G)/2 - B) / L
//   實測 床單 0.18~0.35、adidas 布料 -0.03~0.09、zara 布料 0.05 左右。
//   用亮度正規化才不會被床單陰影騙(陰影處床單變暗但仍偏黃)。
//   用 b* 而非單純飽和度,是因為 adidas 的藍色包縫線/三線飽和度也很高,
//   但它們的 b* 是負的,這樣就不會被誤判成背景。
import sharp from "sharp";

const [src, prefix] = process.argv.slice(2);
const LONG = 2000;

const base = sharp(src).rotate().resize({ height: LONG, fit: "inside" }).removeAlpha();
const { data, info } = await base.raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;
const raw = { width: W, height: H, channels: 3 };
const clamp = (v, a = 0, b = 255) => (v < a ? a : v > b ? b : v);

// 每像素的「偏黃程度」0~1,t0 以下當衣物、t1 以上當床單,中間線性過渡
function keyField(t0, t1) {
  const k = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) {
    const i = p * C;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const L = Math.max(12, (r + g + b) / 3);
    const bstar = ((r + g) / 2 - b) / L;
    k[p] = Math.min(1, Math.max(0, (bstar - t0) / (t1 - t0)));
  }
  return k;
}

// 把 key 區域重新上色成 target(lum) 指定的顏色,保留原有的布料紋理明暗
function recolor(k, target) {
  const out = Buffer.alloc(W * H * 3);
  for (let p = 0; p < W * H; p++) {
    const i = p * C, o = p * 3;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const [tr, tg, tb] = target(lum);
    const f = k[p];
    out[o] = clamp((1 - f) * r + f * tr);
    out[o + 1] = clamp((1 - f) * g + f * tg);
    out[o + 2] = clamp((1 - f) * b + f * tb);
  }
  return out;
}

const write = (buf, name, ch = 3) =>
  sharp(buf, { raw: { width: W, height: H, channels: ch } })
    .toColourspace("srgb").jpeg({ quality: 95 }).toFile(`${prefix}-${name}.jpg`);

const k = keyField(0.11, 0.21);

// V0 基準:什麼都不做,只縮小
await write(Buffer.from(data), "plain");

// V1 床單→深海軍藍(保留紋理明暗),衣物原樣。看起來仍像「衣服放在深色毯子上」
await write(recolor(k, (l) => [18 + l * 0.10, 26 + l * 0.13, 62 + l * 0.30]), "keynavy");

// V2 床單→鮮綠幕。色相差最大但最不自然
await write(recolor(k, (l) => [l * 0.10, 150 + l * 0.30, l * 0.12]), "keygreen");

// V3 全域飽和度 x4:床單變鮮橘,中性衣物幾乎不動
await write(
  await sharp(Buffer.from(data), { raw }).modulate({ saturation: 4 }).raw().toBuffer(),
  "sat4",
);

// V4 色相轉 180 度 + 飽和度 x3:床單變藍,衣物仍灰白
await write(
  await sharp(Buffer.from(data), { raw }).modulate({ hue: 180, saturation: 3 }).raw().toBuffer(),
  "hue180sat3",
);

// V5 只取藍通道再做直方圖拉伸:床單 B 值低、衣物 B 值高,轉成明度對比
await write(
  await sharp(Buffer.from(data), { raw })
    .extractChannel("blue").normalise().raw().toBuffer(),
  "bluechan", 1,
);

console.log(JSON.stringify({ src, W, H, variants: ["plain", "keynavy", "keygreen", "sat4", "hue180sat3", "bluechan"] }));
