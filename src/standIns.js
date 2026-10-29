// [本 fork 新增] 代表款(2026-10-29 本人:用過的人說連拍照都懶,「先弄一個預覽網站給我看」)。
//
// 不拍照也能開始:點一類(短袖 T 恤、牛仔褲…)、選顏色,就拿示範衣櫃裡同一類那件的去背圖,換成那個顏色,
// 存成自己衣櫃的一件(standIn: true)。點個五件就配得出一套;之後點開那件按「換圖」換成自己拍的,標記就拿掉。
// 用的是示範衣櫃那 20 件(本來就公開),站主其他衣服不會露出來。
// 跟 10-26「我的衣櫃只用自己的衣服」的界線:那次拿掉的是系統偷偷借來湊的;這裡是使用者自己點「我有一件像這樣的」,
// 衣櫃格子標「代表款」,不會跟自己拍的分不出來。
//
// 換色:量整件的平均亮度,每一點跟平均差多少就是皺褶、車線的明暗;換成目標色以後把這個明暗加回去,
// 往暗的那邊按目標色剩多少暗的空間縮放,往亮的那邊按剩多少亮的空間縮放(白換黑時皺褶不會變成一塊灰)。
// 原圖的花色、水洗紋會跟著變色留下來;印花、撞色會變成同一個顏色(推論:示範那幾件都是素的,所以挑它們當底)。

export const STAND_IN_COLORS = {
  white: { label: "白色", hex: "#f1efea" },
  black: { label: "黑色", hex: "#1d1d20" },
  gray: { label: "灰色", hex: "#8e9094" },
  navy: { label: "深藍", hex: "#26314a" },
  blue: { label: "藍色", hex: "#56728f" },
  khaki: { label: "卡其", hex: "#ad9670" },
  beige: { label: "米色", hex: "#ddd2bd" },
  olive: { label: "軍綠", hex: "#545c3d" },
  brown: { label: "咖啡", hex: "#5a4333" },
  wine: { label: "酒紅", hex: "#682b33" },
};

// base:示範衣櫃那一件的 id(src/demoCloset.js)。name 照引擎認得的字寫(wishCheck guessWarmth 看「長袖」「毛衣」「短褲」猜保暖度)
export const STAND_INS = [
  { key: "tee", label: "短袖 T 恤", noun: "短袖T恤", part: "upperbody", base: "import-694650a4-f2fb-40f4-b68a-c8fccc2cddd2", colors: ["white", "black", "gray", "navy", "beige", "olive", "wine"] },
  { key: "longtee", label: "長袖 T 恤", noun: "長袖T恤", part: "upperbody", base: "import-b7b7008a-6b86-4e7b-8079-1c716894171a", colors: ["white", "black", "gray", "navy", "beige", "olive"] },
  { key: "shirt", label: "襯衫", noun: "長袖襯衫", part: "upperbody", base: "import-a397925c-5639-4377-9b93-62cd34a0d567", colors: ["white", "blue", "black", "beige", "olive"] },
  { key: "sweat", label: "大學 T", noun: "大學T", part: "upperbody", base: "import-edf302da-c12b-493e-a9ca-c2c6b6b37ff3", colors: ["gray", "black", "navy", "beige", "olive", "wine"] },
  { key: "knit", label: "毛衣", noun: "針織毛衣", part: "upperbody", base: "import-96009ee3-ddab-4eb9-9c7c-38517eef7725", colors: ["navy", "black", "gray", "beige", "brown", "wine"] },
  { key: "jacket", label: "外套", noun: "連帽外套", part: "wholebody_up", base: "import-6677979f-0212-433d-9c9d-a1b5a3d8b9f1", colors: ["black", "navy", "gray", "khaki", "olive"] },
  { key: "denimjacket", label: "牛仔外套", noun: "牛仔外套", part: "wholebody_up", base: "import-27d0fd02-3ba6-4db0-91bc-1e94549142d0", colors: ["blue", "navy", "black"] },
  { key: "jeans", label: "牛仔褲", noun: "牛仔褲", part: "lowerbody", base: "import-2c84275b-6dde-48a4-9f91-b5c2817762ed", colors: ["blue", "navy", "black", "gray", "white"] },
  { key: "pants", label: "長褲", noun: "休閒長褲", part: "lowerbody", base: "import-b433fbef-efd5-45a7-af92-5bedc8ad01d2", colors: ["black", "khaki", "gray", "navy", "beige", "olive"] },
  { key: "shorts", label: "短褲", noun: "短褲", part: "lowerbody", base: "import-8cd1cfa3-7f8e-4f43-9ee2-11c0dad23c7c", colors: ["khaki", "black", "gray", "navy", "olive", "blue"] },
  { key: "sneakers", label: "球鞋", noun: "球鞋", part: "shoes", base: "import-9a5fc2a3-c5c0-4220-b018-cb4a974c09a5", colors: ["white", "black", "gray", "navy"] },
  { key: "canvas", label: "帆布鞋", noun: "帆布鞋", part: "shoes", base: "import-719b4862-b21c-4137-85e4-b9d61ac0fa22", colors: ["white", "black", "beige", "navy"] },
  { key: "leather", label: "皮鞋", noun: "皮鞋", part: "shoes", base: "import-47d9abaf-d6c9-4531-96f1-dbb801789d03", colors: ["black", "brown"] },
  { key: "backpack", label: "後背包", noun: "後背包", part: "bag", base: "import-0f200539-74a5-4378-bd43-37c213e3efd3", colors: ["black", "gray", "navy", "khaki"] },
];

export const standInName = (kind, colorKey) => `${STAND_IN_COLORS[colorKey].label}${kind.noun}`;

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** 把一張去背圖(ImageData)換成 hex 那個顏色,留住明暗。直接改 imageData */
export function recolor(imageData, hex) {
  const d = imageData.data;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { sum += lum(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255); n += 1; }
  if (!n) return imageData;
  const mean = sum / n;
  const target = toRgb(hex);
  const tl = lum(...target);
  // 暗的那邊最多壓到 0、亮的那邊最多推到 1;倍數上限 1.6,免得深色底換淺色時把水洗紋放大成斑
  const down = Math.min(1.6, Math.max(0.35, tl / Math.max(mean, 0.05)));
  const up = Math.min(1.6, Math.max(0.35, (1 - tl) / Math.max(1 - mean, 0.05)));
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const rel = lum(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255) - mean;
    const shade = rel * (rel < 0 ? down : up);
    for (let c = 0; c < 3; c += 1) d[i + c] = Math.round(Math.min(1, Math.max(0, target[c] + shade)) * 255);
  }
  return imageData;
}

/** 讀一張圖、換色、回 Blob。maxSide:小圖(選色時的預覽)給小一點 */
export async function makeStandInBlob(src, hex, maxSide = 1200) {
  const blob = await (await fetch(src)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    context.putImageData(recolor(context.getImageData(0, 0, canvas.width, canvas.height), hex), 0, 0);
    // Safari 存不了 webp 會自己給 png,兩種都收
    const out = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
    if (!out) throw new Error("做不出代表款的圖");
    return out;
  } finally {
    bitmap.close?.();
  }
}
