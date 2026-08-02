// 補內部破洞:從影像四邊做 flood fill 找出「真正的外部背景」,
// 凡是透明但連不到邊界的像素 = 衣物內部被誤挖的洞 → 填回不透明,
// 並用鄰近不透明像素的顏色補色(避免把背景色填進去)。
import sharp from "sharp";
import { rename } from "node:fs/promises";

for (const path of process.argv.slice(2)) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const N = W * H;

  const transparent = new Uint8Array(N);
  for (let p = 0; p < N; p++) if (data[p * 4 + 3] < 128) transparent[p] = 1;

  // 從邊界灌水,標記所有連得到外面的透明像素
  const outside = new Uint8Array(N);
  const queue = new Int32Array(N);
  let head = 0, tail = 0;
  const push = (p) => { if (transparent[p] && !outside[p]) { outside[p] = 1; queue[tail++] = p; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (head < tail) {
    const p = queue[head++];
    const x = p % W, y = (p / W) | 0;
    if (x > 0) push(p - 1);
    if (x < W - 1) push(p + 1);
    if (y > 0) push(p - W);
    if (y < H - 1) push(p + W);
  }

  // 內部洞 = 透明且非外部
  let holes = 0;
  const holeList = [];
  for (let p = 0; p < N; p++) if (transparent[p] && !outside[p]) { holeList.push(p); holes++; }

  // 補色:對每個洞取周圍 15px 內最近的不透明像素顏色
  for (const p of holeList) {
    const x0 = p % W, y0 = (p / W) | 0;
    let found = false;
    for (let r = 1; r <= 15 && !found; r++) {
      for (const [dx, dy] of [[r,0],[-r,0],[0,r],[0,-r],[r,r],[-r,-r],[r,-r],[-r,r]]) {
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const q = y * W + x;
        if (!transparent[q]) {
          data[p * 4] = data[q * 4];
          data[p * 4 + 1] = data[q * 4 + 1];
          data[p * 4 + 2] = data[q * 4 + 2];
          found = true;
          break;
        }
      }
    }
    data[p * 4 + 3] = 255;
  }

  await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toFile(path + ".tmp");
  await rename(path + ".tmp", path);
  console.log(`${path.split(/[\/]/).pop()}  填補內部破洞 ${holes} 像素 (${(holes / N * 100).toFixed(2)}%)`);
}
