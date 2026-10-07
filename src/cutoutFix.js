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

/** 直接改 out(RGBA)的 alpha 和顏色;src 是原照片同尺寸的 RGBA。回傳改了幾個像素。 */
export function solidify(out, src, W, H, { strong = false } = {}) {
  const N = W * H;
  const alpha = new Uint8Array(N);
  for (let i = 0; i < N; i += 1) alpha[i] = out[i * 4 + 3];
  const edge = strong ? STRONG_EDGE : WEAK;
  const weak = (i) => alpha[i] < edge;
  const stack = new Int32Array(N);

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

  let changed = 0;
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
