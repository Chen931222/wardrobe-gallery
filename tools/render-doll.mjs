// 在 Node 端重現搭配頁的人形合成,用來目視驗證槽位(瀏覽器截圖在本機會逾時)
import sharp from "sharp";
import { readFile } from "node:fs/promises";

const W = 400, H = 680;   // = viewBox 200x340 的兩倍
// 要跟 src/OutfitStudio.jsx 的 SLOT_STYLE 對齊,改那邊記得改這邊
const SLOT = {
  socks:        { left:.35, top:.70,  w:.30, h:.12,  z:2 },
  shoes:        { left:.36, top:.82,  w:.28, h:.18,  z:3 },
  lowerbody:    { left:.31, top:.51,  w:.38, h:.44,  z:4 },
  upperbody:    { left:.25, top:.16,  w:.50, h:.36,  z:5 },
  wholebody_up: { left:.22, top:.145, w:.56, h:.42,  z:6 },
  bag:          { left:.54, top:.46,  w:.26, h:.19,  z:7 },
};
const DOLL = `<svg width="${W}" height="${H}" viewBox="0 0 200 340" xmlns="http://www.w3.org/2000/svg">
<rect width="200" height="340" fill="#f6f6f6"/><g fill="#ddd7ce">
<circle cx="100" cy="28" r="20"/><rect x="92" y="46" width="16" height="14" rx="5"/>
<rect x="72" y="58" width="56" height="120" rx="18"/><rect x="52" y="66" width="18" height="95" rx="9"/>
<rect x="130" y="66" width="18" height="95" rx="9"/><rect x="78" y="170" width="19" height="160" rx="9"/>
<rect x="103" y="170" width="19" height="160" rx="9"/></g></svg>`;

const lib = JSON.parse(await readFile("data/library.json", "utf8"));
const find = (k) => lib.find((i) => i.name.includes(k));

async function render(outfit, out) {
  const layers = [];
  const entries = Object.entries(outfit).sort((a, b) => SLOT[a[0]].z - SLOT[b[0]].z);
  for (const [slot, key] of entries) {
    const it = find(key);
    if (!it) { console.warn("找不到", key); continue; }
    const s = SLOT[slot];
    const boxW = Math.round(s.w * W), boxH = Math.round(s.h * H);
    // contain + object-position: center top
    const buf = await sharp(`data/imported/${it.id}-view.webp`)
      .resize(boxW, boxH, { fit: "inside", withoutEnlargement: false }).toBuffer();
    const m = await sharp(buf).metadata();
    layers.push({
      input: buf,
      left: Math.round(s.left * W + (boxW - m.width) / 2),
      top: Math.round(s.top * H),
    });
  }
  await sharp(Buffer.from(DOLL)).composite(layers).png().toFile(out);
  console.log("→", out);
}

// 五種組合,涵蓋最矮(拖鞋)到最高(高筒鞋)的鞋型,以及短褲/長褲/外套
const CASES = [
  ["短褲 + 襪 + 拖鞋",   { upperbody: "ALONEMASTER", lowerbody: "BEEN IDEA 米灰棉質", socks: "白色羅紋中筒襪", shoes: "黑色運動拖鞋" }],
  ["短褲 + 襪 + 高筒",   { upperbody: "ALONEMASTER", lowerbody: "BEEN IDEA 米灰棉質", socks: "白色羅紋中筒襪", shoes: "米白帆布側拉鍊高筒鞋" }],
  ["寬版牛仔 + 慢跑鞋",  { upperbody: "ALONEMASTER", lowerbody: "淺灰酸洗水洗寬版落地牛仔褲", socks: "白色羅紋中筒襪", shoes: "紅色網布輕量慢跑鞋" }],
  ["長褲 + 外套 + 皮鞋", { upperbody: "白色寬版落肩五分袖", lowerbody: "深藍色垂墜寬版西裝長褲", wholebody_up: "黑色真皮寬版騎士外套", shoes: "黑色真皮厚底休閒鞋" }],
  ["西裝褲 + 麂皮鞋",    { upperbody: "淺藍牛津紡扣領長袖襯衫", lowerbody: "黑色西裝長褲", socks: "白色羅紋中筒襪", shoes: "酒紅麂皮三線休閒鞋" }],
  ["+ 後背包(最高)",   { upperbody: "ALONEMASTER", lowerbody: "卡其棉質抽繩寬版短褲", shoes: "紅色網布輕量慢跑鞋", bag: "黑色皮革拼接經典印花後背包" }],
  ["+ 斜背包(最寬)",   { upperbody: "ALONEMASTER", lowerbody: "卡其棉質抽繩寬版短褲", shoes: "紅色網布輕量慢跑鞋", bag: "黑灰水洗丹寧半月單肩包" }],
  ["+ 米白斜背包",       { upperbody: "淺藍牛津紡扣領長袖襯衫", lowerbody: "黑色西裝長褲", shoes: "黑色真皮厚底休閒鞋", bag: "米白尼龍半月斜背包" }],
];

const sheet = [];
for (let i = 0; i < CASES.length; i++) {
  const [label, outfit] = CASES[i];
  const f = `work/doll-${i}.png`;
  await render(outfit, f);
  sheet.push({ input: await sharp(f).toBuffer(), left: i * (W + 10), top: 30 });
  sheet.push({ input: Buffer.from(`<svg width="${W}" height="30"><rect width="${W}" height="30" fill="#141414"/><text x="8" y="21" font-family="sans-serif" font-size="15" fill="#fff">${label}</text></svg>`), left: i * (W + 10), top: 0 });
}
await sharp({ create: { width: CASES.length * (W + 10), height: H + 30, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } } })
  .composite(sheet).jpeg({ quality: 90 }).toFile("work/doll-sheet.jpg");
console.log("→ work/doll-sheet.jpg");
