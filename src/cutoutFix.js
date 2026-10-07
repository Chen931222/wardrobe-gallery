// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
/* 去背後補洞、補實(2026-10-07 本人回報「背景為白色時去背不好去」)。在去背的 Worker 裡跑,不能用 document。
 *
 * 實測(白床單、白牆合成圖 15 張,衣服的正確範圍已知):白帽T放在白床單上,模型把輪廓抓對了,
 * 但身體中間三成判成半透明(衣服只留 69%);放到網站的深色底上就是一件灰灰髒髒、會透的衣服。
 * 被吃掉的那塊都被衣服的輪廓圍住,模型給的不透明度平均 39(中位數 28)—— 它自己也不確定;
 * 包包背帶圈出來的真的洞,模型給的平均只有 2–3、九成是 0。所以自動做的(一般模式):
 *   ① 被輪廓圍住、模型不確定的(平均不透明度 ≥ 12)→ 補成實心,顏色用原照片的
 *   ② 被圍住但模型很確定是空的(背帶圈、兩隻袖子中間)→ 留著當洞
 *   ③ 輪廓裡面、離邊緣有一段距離的半透明 → 補成實心;邊緣那一圈留著模型給的柔邊
 * 眼鏡不自動做(鏡片本來就是透的,補實會把後面的床單變成鏡片)。
 *
 * 更白的(白衣服幾乎跟床單同色):模型連口袋那一大塊都很有把握地判成背景(不透明度 0),
 * 跟包包真的洞從數字上分不出來,自動補一定會把包包的洞也補起來。這種交給人按「補滿」(強力模式):
 *   輪廓有一點點(不透明度 ≥ 24)就算邊,斷掉的小缺口先接起來,圍住的全部補滿。 */

const WEAK = 128;            // 一般模式:不透明度低於這個算「不是衣服」
const STRONG_EDGE = 24;      // 補滿模式:模型給一點點不透明的就算衣服的邊
const UNSURE_MEAN = 12;      // 被圍住的那塊平均不透明度到這個,算模型不確定 → 補
const SKIP_PARTS = new Set(["eyewear"]);
const INF = 1 << 28;

/** 兩趟 chamfer(3-4)距離,原地改:0 的是起點,其他算到最近起點的距離(單位:3 = 一格) */
function chamfer(dist, W, H) {
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (!dist[i]) continue;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 3);
      if (y > 0) {
        d = Math.min(d, dist[i - W] + 3);
        if (x > 0) d = Math.min(d, dist[i - W - 1] + 4);
        if (x < W - 1) d = Math.min(d, dist[i - W + 1] + 4);
      }
      dist[i] = d;
    }
  }
  for (let y = H - 1; y >= 0; y -= 1) {
    for (let x = W - 1; x >= 0; x -= 1) {
      const i = y * W + x;
      if (!dist[i]) continue;
      let d = dist[i];
      if (x < W - 1) d = Math.min(d, dist[i + 1] + 3);
      if (y < H - 1) {
        d = Math.min(d, dist[i + W] + 3);
        if (x < W - 1) d = Math.min(d, dist[i + W + 1] + 4);
        if (x > 0) d = Math.min(d, dist[i + W - 1] + 4);
      }
      dist[i] = d;
    }
  }
  return dist;
}

/** 從四邊出發,只走 pass(i) 為真的像素,走得到的標 1 */
function floodFromBorder(pass, W, H, stack) {
  const N = W * H;
  const reached = new Uint8Array(N);
  let top = 0;
  const visit = (i) => { if (!reached[i] && pass(i)) { reached[i] = 1; stack[top++] = i; } };
  for (let x = 0; x < W; x += 1) { visit(x); visit((H - 1) * W + x); }
  for (let y = 0; y < H; y += 1) { visit(y * W); visit(y * W + W - 1); }
  while (top) {
    const i = stack[--top];
    const x = i % W;
    if (x > 0) visit(i - 1);
    if (x < W - 1) visit(i + 1);
    if (i >= W) visit(i - W);
    if (i < N - W) visit(i + W);
  }
  return reached;
}

/* 整件都很淡(鬼影,2026-10-07 本人換 Massimo Dutti 白襯衫的圖,兩次截圖):模型抓到的形狀是對的,
   但不透明度很低,而且不平均 —— 袖子、領口大概六七成,身體只有一兩成。
   第一版「圍住的才補」對它沒用(補滿只圍到領口一小塊、補成一塊白);
   第二版照比例拉開、本體三成以下當影子歸零 → 袖子變實心,身體被清掉(第二張截圖)。
   現在:衣服本體(不透明度 ≥ 8 的第 90 百分位)不到 192 就當鬼影,改成先定形狀再上不透明度 ——
   ① 從最有把握的地方(本體一半以上)出發,沿著「比背景雜訊明顯高一點」的像素長出去,連在一起的都是衣服;
      背景裡零星的雜訊沒連上,不算
   ② 形狀裡全部不透明,邊緣模糊一兩個像素當柔邊。正常的去背不動。 */
const GHOST_HI = 192;
function liftGhost(alpha, W, H, stack) {
  const N = W * H;
  const hist = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < N; i += 1) if (alpha[i] >= 8) { hist[alpha[i]] += 1; count += 1; }
  if (count < N * 0.005) return false;   // 幾乎什麼都沒抓到:放大的只是雜訊
  let hi = 255;
  for (let v = 8, seen = 0; v < 256; v += 1) { seen += hist[v]; if (seen >= count * 0.9) { hi = v; break; } }
  if (hi >= GHOST_HI) return false;
  // 四邊一圈(2%)是背景:它的第 99 百分位當雜訊的底
  const frame = Math.max(1, Math.round(Math.min(W, H) * 0.02));
  const edgeHist = new Uint32Array(256);
  let edgeCount = 0;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (y >= frame && y < H - frame && x >= frame && x < W - frame) continue;
      edgeHist[alpha[y * W + x]] += 1; edgeCount += 1;
    }
  }
  let floor = 0;
  for (let v = 0, seen = 0; v < 256; v += 1) { seen += edgeHist[v]; if (seen >= edgeCount * 0.99) { floor = v; break; } }
  const low = floor + Math.max(3, Math.round((hi - floor) * 0.1));
  const seedLevel = Math.max(low + 1, Math.round(hi * 0.5));
  if (seedLevel <= low) return false;

  // ① 從有把握的地方長出去
  const shape = new Uint8Array(N);
  let top = 0, size = 0;
  for (let i = 0; i < N; i += 1) if (alpha[i] >= seedLevel) { shape[i] = 1; stack[top++] = i; size += 1; }
  while (top) {
    const i = stack[--top];
    const x = i % W;
    const grow = (j) => { if (!shape[j] && alpha[j] >= low) { shape[j] = 1; stack[top++] = j; size += 1; } };
    if (x > 0) grow(i - 1);
    if (x < W - 1) grow(i + 1);
    if (i >= W) grow(i - W);
    if (i < N - W) grow(i + W);
  }
  if (size > N * 0.9) return false;   // 幾乎整張都連成一片:背景雜訊也長進來了,不做

  // ② 形狀裡全部不透明,邊緣兩趟方框模糊當柔邊
  const r = Math.max(1, Math.round(Math.max(W, H) * 0.0015));
  const row = new Float32Array(N);
  for (let y = 0; y < H; y += 1) {
    let sum = 0;
    for (let x = -r; x <= r; x += 1) sum += shape[y * W + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x += 1) {
      row[y * W + x] = sum;
      sum += shape[y * W + Math.min(W - 1, x + r + 1)] - shape[y * W + Math.max(0, x - r)];
    }
  }
  const area = (2 * r + 1) * (2 * r + 1);
  for (let x = 0; x < W; x += 1) {
    let sum = 0;
    for (let y = -r; y <= r; y += 1) sum += row[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y += 1) {
      alpha[y * W + x] = Math.round((sum / area) * 255);
      sum += row[Math.min(H - 1, y + r + 1) * W + x] - row[Math.max(0, y - r) * W + x];
    }
  }
  return true;
}

/** 直接改 out(RGBA)的 alpha 和顏色;src 是原照片同尺寸的 RGBA。回傳改了幾個像素。 */
export function solidify(out, src, W, H, { strong = false } = {}) {
  const N = W * H;
  const alpha = new Uint8Array(N);
  for (let i = 0; i < N; i += 1) alpha[i] = out[i * 4 + 3];
  const stack = new Int32Array(N);
  // 鬼影先定形狀,整張的不透明度和顏色都換成新的(很淡的像素存 PNG 時顏色會糊掉,用原照片的)
  let changed = 0;
  if (liftGhost(alpha, W, H, stack)) {
    for (let i = 0; i < N; i += 1) {
      if (out[i * 4 + 3] === alpha[i]) continue;
      out[i * 4] = src[i * 4];
      out[i * 4 + 1] = src[i * 4 + 1];
      out[i * 4 + 2] = src[i * 4 + 2];
      out[i * 4 + 3] = alpha[i];
      changed += 1;
    }
  }
  const edge = strong ? STRONG_EDGE : WEAK;
  const weak = (i) => alpha[i] < edge;

  // 外面 = 從四邊沿著「不是衣服」走得到的
  let outside;
  if (!strong) {
    outside = floodFromBorder(weak, W, H, stack);
  } else {
    // 輪廓斷掉的小缺口(< 2r)先接起來:離衣服邊 r 以內的不讓外面走進來;走完再往回長 r,邊上的縫也算外面
    const r3 = Math.max(4, Math.round(Math.max(W, H) * 0.012)) * 3;
    const toEdge = new Int32Array(N);
    for (let i = 0; i < N; i += 1) toEdge[i] = weak(i) ? INF : 0;
    chamfer(toEdge, W, H);
    const core = floodFromBorder((i) => toEdge[i] > r3, W, H, stack);
    const toCore = new Int32Array(N);
    for (let i = 0; i < N; i += 1) toCore[i] = core[i] ? 0 : INF;
    chamfer(toCore, W, H);
    outside = new Uint8Array(N);
    for (let i = 0; i < N; i += 1) outside[i] = weak(i) && toCore[i] <= r3 ? 1 : 0;
  }

  // 被圍住的「不是衣服」一塊一塊看:一般模式下模型確定是空的留著當洞;補滿模式全部補
  const hole = new Uint8Array(N);
  const fill = new Uint8Array(N);
  const seen = new Uint8Array(N);
  const region = [];
  for (let start = 0; start < N; start += 1) {
    if (outside[start] || seen[start] || !weak(start)) continue;
    region.length = 0;
    let top = 0, sum = 0;
    seen[start] = 1; stack[top++] = start;
    while (top) {
      const i = stack[--top];
      region.push(i); sum += alpha[i];
      const x = i % W;
      const open = (j) => { if (!seen[j] && !outside[j] && weak(j)) { seen[j] = 1; stack[top++] = j; } };
      if (x > 0) open(i - 1);
      if (x < W - 1) open(i + 1);
      if (i >= W) open(i - W);
      if (i < N - W) open(i + W);
    }
    const target = strong || sum / region.length >= UNSURE_MEAN ? fill : hole;
    for (const i of region) target[i] = 1;
  }

  // 離「外面」(含留著的洞)多遠;超過 band 的算衣服內部,半透明的補實
  const band3 = Math.max(3, Math.round(Math.max(W, H) * 0.006)) * 3;
  const toOutside = new Int32Array(N);
  for (let i = 0; i < N; i += 1) toOutside[i] = outside[i] || hole[i] ? 0 : INF;
  chamfer(toOutside, W, H);

  for (let i = 0; i < N; i += 1) {
    if (outside[i] || hole[i] || alpha[i] === 255) continue;
    if (!fill[i] && toOutside[i] <= band3) continue;   // 邊緣那一圈:留柔邊
    out[i * 4] = src[i * 4];
    out[i * 4 + 1] = src[i * 4 + 1];
    out[i * 4 + 2] = src[i * 4 + 2];
    out[i * 4 + 3] = 255;
    changed += 1;
  }
  return changed;
}

function canvasOf(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
async function pixels(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = canvasOf(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return { canvas, context, image: context.getImageData(0, 0, canvas.width, canvas.height) };
}
const encode = (canvas) => (canvas.convertToBlob
  ? canvas.convertToBlob({ type: "image/png" })
  : new Promise((resolve) => canvas.toBlob(resolve, "image/png")));

/* 對比太低的照片先拉開再算一次(2026-10-07 本人傳來的 Massimo Dutti 白襯衫商品圖):
   純白襯衫放在 238–249 的淺灰漸層上,整張照片亮度只差 20(第 1 到第 99 百分位)。模型只看得到左袖和領口,
   右半邊幾乎全給 0 —— 這不是補洞能救的,模型就是沒看到。把亮度拉開(第 1 百分位→0、第 99→255)再丟進去,
   整件都抓到了(不透明度 ≥ 224 的像素 1,409 → 34,896)。拿那次的形狀、配原照片的顏色。
   只在對比很低(亮度差 ≤ 48)時多算這一次;一般照片(白床單上的白衣服也有 60 以上)不會多等。
   合成的低對比測試圖拉開後結果跟原本一樣(0.99 上下),所以只有第二次的實心範圍明顯比較大(多 25%)才換。 */
const LOW_SPAN = 48;
async function solidArea(blob) {
  const { image } = await pixels(blob);
  let solid = 0;
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] >= 224) solid += 1;
  return { solid, total: image.data.length / 4 };
}
/** rerun(拉開對比的那張) → 模型的結果。不需要、或沒比較好,回傳原本的 cut。 */
export async function retryLowContrast(original, cut, rerun) {
  const source = await pixels(original);
  const data = source.image.data;
  const hist = new Uint32Array(256);
  const N = data.length / 4;
  for (let i = 0; i < data.length; i += 4) hist[Math.round((data[i] + data[i + 1] + data[i + 2]) / 3)] += 1;
  const at = (q) => { for (let v = 0, seen = 0; v < 256; v += 1) { seen += hist[v]; if (seen >= N * q) return v; } return 255; };
  const lo = at(0.01), hi = at(0.99);
  if (hi - lo > LOW_SPAN || hi - lo < 4) return cut;
  const first = await solidArea(cut);
  const keep = new Uint8ClampedArray(data);   // 原照片的顏色留一份,拉開的只給模型看
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) data[i + c] = ((data[i + c] - lo) * 255) / (hi - lo);
  }
  source.context.putImageData(source.image, 0, 0);
  const second = await rerun(await encode(source.canvas));
  const after = await solidArea(second);
  if (after.solid <= first.solid * 1.25 || after.solid > after.total * 0.9) return cut;
  const shape = await pixels(second);
  if (shape.canvas.width !== source.canvas.width || shape.canvas.height !== source.canvas.height) return cut;
  for (let i = 0; i < keep.length; i += 4) keep[i + 3] = shape.image.data[i + 3];
  source.image.data.set(keep);
  source.context.putImageData(source.image, 0, 0);
  return (await encode(source.canvas)) || cut;
}

/** 去背結果補洞補實。原照片和結果尺寸不同、或這類不自動做,原樣回傳。strong = 人按了「補滿」 */
export async function solidifyCutout(original, cut, { part = "", strong = false } = {}) {
  if (!strong && SKIP_PARTS.has(part)) return cut;
  const source = await pixels(original);
  const result = await pixels(cut);
  const { width: W, height: H } = result.canvas;
  if (source.canvas.width !== W || source.canvas.height !== H) return cut;
  if (!solidify(result.image.data, source.image.data, W, H, { strong })) return cut;
  result.context.putImageData(result.image, 0, 0);
  return (await encode(result.canvas)) || cut;
}
