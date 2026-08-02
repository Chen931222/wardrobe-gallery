// tools/depatch.mjs — 清掉去背成品裡「被背帶圈住而留下來的地板」。
//
// 病徵:包包平放拍攝時,背帶會圍出一個封閉區域,模型把那塊地板判成物體的一部分,
// 留下一塊完全不透明的米色補丁。因為它是實心的,調 alpha 門檻救不了。
//
// 解法分兩段:
//   1. --alpha N  先把半透明的地板霧氣切掉(alpha<N→0、>=N→255)
//   2. --lum N    再找「亮度 > N 的連通塊」,面積超過 --minarea 的整塊刪掉。
//      面積門檻是為了保住金屬扣環、拉鍊頭這種小亮點 —— 地板補丁一定很大。
//   --dark N 是 --lum 的反向,只在 --loop 模式有意義:清掉開口裡「比布料更暗」的東西,
//            例如衣架橫桿。試過用掃描線把開口整列填掉,結果把整條褲子吃光,別走那條路。
//
// 只適用「深色物件 + 淺色地板」。淺色包請單用 --alpha,別開 --lum。
//
// 用法:
//   node tools/depatch.mjs --slug washed-denim-crescent-shoulder-bag --lum 140 --minarea 0.004
//   node tools/depatch.mjs --slug cream-nylon-crescent-sling --alpha 230
import sharp from "sharp";

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};

const slug = arg("slug");
if (!slug) { console.error("需要 --slug"); process.exit(1); }
const alphaCut = Number(arg("alpha", 0));
const lumCut = Number(arg("lum", 0));
const darkCut = Number(arg("dark", 0));
const minArea = Number(arg("minarea", 0.004));
const dryRun = process.argv.includes("--dry-run");

const path = `work/items/${slug}.png`;
const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const N = W * H;
const out = Buffer.from(data);

let cutByAlpha = 0;
if (alphaCut > 0) {
  for (let i = 0; i < N; i++) {
    const a = data[i * 4 + 3];
    if (a === 0) continue;
    if (a < alphaCut) { out[i * 4 + 3] = 0; cutByAlpha++; } else out[i * 4 + 3] = 255;
  }
}

let cutByLoop = 0, loopBlobs = 0;
if (process.argv.includes("--loop")) {
  // 拓樸法:先從畫面邊界灌水找出「真正的外部」(相連的透明像素)。
  // 剩下的非外部區域 = 包本體 + 被背帶圈住的洞。把洞裡的「透明像素」和
  // 「淺色殘留」視為同一個連通塊 —— 殘留就算碎成小塊,也會被那個大洞帶著一起抓到,
  // 這是單純用面積門檻抓不到的。
  const OPAQUE = 128;
  const outside = new Uint8Array(N);
  const stack = new Int32Array(N);
  let top = 0;
  const push = (p) => { if (!outside[p] && out[p * 4 + 3] < OPAQUE) { outside[p] = 1; stack[top++] = p; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (top > 0) {
    const p = stack[--top];
    const x = p % W, y = (p / W) | 0;
    if (x > 0)     push(p - 1);
    if (x < W - 1) push(p + 1);
    if (y > 0)     push(p - W);
    if (y < H - 1) push(p + W);
  }

  const candidate = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (outside[i]) continue;
    const a = out[i * 4 + 3];
    if (a < OPAQUE) { candidate[i] = 1; continue; }          // 圈內的透明洞
    const lum = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
    if (lumCut > 0 && lum > lumCut) candidate[i] = 1;         // 洞邊緣的淺色殘留
    if (darkCut > 0 && lum < darkCut) candidate[i] = 1;       // 開口裡比布料更暗的東西(深色衣架)
  }

  const seen = new Uint8Array(N);
  const threshold = Math.max(1, Math.round(minArea * N));
  for (let start = 0; start < N; start++) {
    if (!candidate[start] || seen[start]) continue;
    let sp = 0, count = 0;
    stack[sp++] = start; seen[start] = 1;
    const members = [];
    while (sp > 0) {
      const p = stack[--sp];
      members.push(p); count++;
      const x = p % W, y = (p / W) | 0;
      if (x > 0     && candidate[p-1] && !seen[p-1]) { seen[p-1] = 1; stack[sp++] = p-1; }
      if (x < W - 1 && candidate[p+1] && !seen[p+1]) { seen[p+1] = 1; stack[sp++] = p+1; }
      if (y > 0     && candidate[p-W] && !seen[p-W]) { seen[p-W] = 1; stack[sp++] = p-W; }
      if (y < H - 1 && candidate[p+W] && !seen[p+W]) { seen[p+W] = 1; stack[sp++] = p+W; }
    }
    if (count >= threshold) {
      loopBlobs++;
      for (const p of members) { if (out[p * 4 + 3] !== 0) cutByLoop++; out[p * 4 + 3] = 0; }
    }
  }
}

let cutByLum = 0, blobs = 0;
if (lumCut > 0 && !process.argv.includes("--loop")) {
  // Rec.709 亮度;只看目前還不透明的像素
  const bright = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (out[i * 4 + 3] < 128) continue;
    const lum = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
    if (lum > lumCut) bright[i] = 1;
  }
  // 連通塊(4 鄰接,顯式堆疊避免遞迴爆掉)
  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  const threshold = Math.max(1, Math.round(minArea * N));
  for (let start = 0; start < N; start++) {
    if (!bright[start] || seen[start]) continue;
    let top = 0, count = 0;
    stack[top++] = start; seen[start] = 1;
    const members = [];
    while (top > 0) {
      const p = stack[--top];
      members.push(p); count++;
      const x = p % W, y = (p / W) | 0;
      if (x > 0     && bright[p-1] && !seen[p-1])     { seen[p-1] = 1;     stack[top++] = p-1; }
      if (x < W - 1 && bright[p+1] && !seen[p+1])     { seen[p+1] = 1;     stack[top++] = p+1; }
      if (y > 0     && bright[p-W] && !seen[p-W])     { seen[p-W] = 1;     stack[top++] = p-W; }
      if (y < H - 1 && bright[p+W] && !seen[p+W])     { seen[p+W] = 1;     stack[top++] = p+W; }
    }
    if (count >= threshold) {
      blobs++;
      for (const p of members) { out[p * 4 + 3] = 0; cutByLum++; }
    }
  }
}

const pct = (n) => `${((100 * n) / N).toFixed(2)}%`;
console.log(`${slug}: alpha 切掉 ${pct(cutByAlpha)},圈內清掉 ${pct(cutByLoop)}(${loopBlobs} 塊),亮塊切掉 ${pct(cutByLum)}(${blobs} 塊)`);

if (!dryRun) {
  // 重新 trim:刪掉補丁後外框會變,不重修邊會留一圈空白
  const buf = await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  await sharp(buf).trim({ threshold: 10 })
    .extend({ top: 40, bottom: 40, left: 40, right: 40, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toFile(path);
  console.log("→ 已覆寫", path);
}
