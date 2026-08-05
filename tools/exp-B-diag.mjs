// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
// exp-B 診斷:量測床單 vs 衣物在 LAB 各通道的實際距離
import sharp from "sharp";

const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const fLab = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export function rgb2lab(r, g, b) {
  const R = srgbToLin(r / 255), G = srgbToLin(g / 255), B = srgbToLin(b / 255);
  let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let Y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1.0;
  let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const file = process.argv[2];
const samples = JSON.parse(process.argv[3] || "[]"); // [[nx,ny,label],...]

const { data, info } = await sharp(file).rotate().resize({ width: 1000 })
  .removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
console.log("resized", W, "x", H);

const patch = (nx, ny, rad = 12) => {
  const cx = Math.round(nx * W), cy = Math.round(ny * H);
  let L = 0, A = 0, Bv = 0, n = 0;
  for (let y = cy - rad; y <= cy + rad; y++)
    for (let x = cx - rad; x <= cx + rad; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = (y * W + x) * 3;
      const [l, a, b] = rgb2lab(data[i], data[i + 1], data[i + 2]);
      L += l; A += a; Bv += b; n++;
    }
  return [L / n, A / n, Bv / n];
};

for (const [nx, ny, label] of samples) {
  const [l, a, b] = patch(nx, ny);
  console.log(`${label.padEnd(14)} L=${l.toFixed(1).padStart(6)} a=${a.toFixed(2).padStart(6)} b=${b.toFixed(2).padStart(6)}`);
}

// 全圖 b* 直方圖,看是否雙峰
const hist = new Array(60).fill(0);
for (let i = 0; i < W * H; i++) {
  const [, , b] = rgb2lab(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
  const bin = Math.max(0, Math.min(59, Math.round(b) + 10));
  hist[bin]++;
}
console.log("\nb* histogram (bin = b*+10):");
const max = Math.max(...hist);
hist.forEach((c, i) => {
  if (c > max * 0.01) console.log(String(i - 10).padStart(4), "#".repeat(Math.round(60 * c / max)), (100 * c / (W * H)).toFixed(1) + "%");
});
