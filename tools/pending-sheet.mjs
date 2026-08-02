// 待重拍清單對照表:左=原始照片(供辨認是哪一件),右=去背失敗的結果(說明問題)
import sharp from "sharp";

const ITEMS = [
  { photo: "IMG_4350.JPG", cut: "p4350-taupe-washed-sweatpants.png",        label: "1. 灰褐運動長褲" },
  { photo: "IMG_4351.JPG", cut: "p4351-gray-drawstring-pleated-trousers.png", label: "2. 灰色打褶西裝褲" },
  { photo: "IMG_4374.JPG", cut: "p4374-gray-pinstripe-shortsleeve-shirt.png", label: "3. 灰白直條紋短袖襯衫" },
  { photo: "IMG_4395.JPG", cut: "p4395-olive-drawstring-shorts.png",          label: "4. 軍綠抽繩短褲" },
];

const CELL = 560, HEAD = 46, ROW = CELL + HEAD;
const layers = [];

for (let i = 0; i < ITEMS.length; i++) {
  const it = ITEMS[i];
  const y = i * ROW;

  const photo = await sharp(`photos/${it.photo}`).rotate()
    .resize(CELL - 20, CELL - 20, { fit: "contain", background: { r: 26, g: 26, b: 26 } }).toBuffer();
  layers.push({ input: photo, left: 10, top: y + HEAD });

  // 去背圖鋪在洋紅底上,殘留與破洞才看得出來
  const cut = await sharp(`work/items/${it.cut}`)
    .resize(CELL - 20, CELL - 20, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  const cutOnMagenta = await sharp({ create: { width: CELL - 20, height: CELL - 20, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } } })
    .composite([{ input: cut }]).png().toBuffer();
  layers.push({ input: cutOnMagenta, left: CELL + 10, top: y + HEAD });

  const head = `<svg width="${CELL * 2}" height="${HEAD}">
    <rect width="${CELL * 2}" height="${HEAD}" fill="#141414"/>
    <text x="12" y="30" font-family="sans-serif" font-size="24" fill="#ffffff">${it.label}</text>
    <text x="${CELL + 12}" y="30" font-family="sans-serif" font-size="17" fill="#ff7676">去背結果(洋紅=透明)</text>
  </svg>`;
  layers.push({ input: Buffer.from(head), left: 0, top: y });
}

await sharp({ create: { width: CELL * 2, height: ROW * ITEMS.length, channels: 4, background: { r: 26, g: 26, b: 26, alpha: 1 } } })
  .composite(layers).jpeg({ quality: 88 }).toFile("work/pending-items.jpg");
console.log("完成 -> work/pending-items.jpg");
