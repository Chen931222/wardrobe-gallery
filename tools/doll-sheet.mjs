// [本 fork 新增] 人台比例的檢查表(2026-10-18):用 src/dollLayout.js 同一套算法在 Node 端合成,舊版(固定槽位)和新版(量身形)並排。
// 瀏覽器面板對這個 app 截圖常逾時,比例要用這個看。
// 用法:node tools/doll-sheet.mjs <輸出資料夾>
//   outfits.png  幾套穿搭,每套左舊右新
//   tops.png / bottoms.png / outers.png / shoes-bags.png  每件單獨穿在人台上(新版),一眼看完整類的大小一不一致
import sharp from "sharp";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { measureShape } from "../src/garmentShape.js";
import { baseBox, DOLL } from "../src/dollLayout.js";

const OUT = process.argv[2] || "work/doll-sheet";
await mkdir(OUT, { recursive: true });
const S = 2;                                   // 人台 200×340 畫成 400×680
const W = DOLL.w * S, H = DOLL.h * S;
const lib = JSON.parse(await readFile("data/library.json", "utf8"));
const slotOf = (item) => (item.part === "upperbody" && /襯衫/.test(item.name || "") ? "shirt" : item.part);
const Z = { socks: 2, shoes: 3, lowerbody: 4, upperbody: 5, shirt: 6, wholebody_up: 8, bag: 10 };

const DOLL_SVG = (label) => Buffer.from(`<svg width="${W}" height="${H + 40}" viewBox="0 0 ${DOLL.w} ${DOLL.h + 20}" xmlns="http://www.w3.org/2000/svg">
<rect width="${DOLL.w}" height="${DOLL.h + 20}" fill="#f2ead9"/><g fill="#d6c8ab">
<circle cx="100" cy="28" r="20"/><rect x="92" y="46" width="16" height="14" rx="5"/>
<rect x="72" y="58" width="56" height="120" rx="18"/><rect x="52" y="66" width="18" height="95" rx="9"/>
<rect x="130" y="66" width="18" height="95" rx="9"/><rect x="78" y="170" width="19" height="160" rx="9"/>
<rect x="103" y="170" width="19" height="160" rx="9"/></g>
<text x="100" y="${DOLL.h + 14}" font-size="9" text-anchor="middle" fill="#3b322a" font-family="sans-serif">${label}</text></svg>`);

const cache = new Map();
async function load(item) {
  if (cache.has(item.id)) return cache.get(item.id);
  const path = `data/imported/${item.id}-view.webp`;
  const meta = await sharp(path).metadata();
  const { data, info } = await sharp(path).ensureAlpha().resize({ width: 200, withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  const shape = measureShape({ data, width: info.width, height: info.height, channels: info.channels }, slotOf(item));
  const value = { path, nat: { w: meta.width, h: meta.height }, shape };
  cache.set(item.id, value);
  return value;
}

async function doll(items, useShape, label) {
  const layers = [];
  for (const item of [...items].sort((a, b) => (Z[slotOf(a)] ?? 9) - (Z[slotOf(b)] ?? 9))) {
    const slot = slotOf(item);
    if (slot === "socks") continue;
    const { path, nat, shape } = await load(item);
    const box = baseBox(slot, useShape ? shape : null, nat);
    const w = Math.max(1, Math.round(box.w * S)), h = Math.max(1, Math.round(box.h * S));
    let left = Math.round(box.x * S), top = Math.round(box.y * S);
    let input = await sharp(path).resize(w, h, { fit: "fill" }).png().toBuffer();
    // 超出畫布的部分裁掉(sharp 不收負座標)
    const cropL = Math.max(0, -left), cropT = Math.max(0, -top);
    const cropR = Math.max(0, left + w - W), cropB = Math.max(0, top + h - H);
    if (cropL || cropT || cropR || cropB) {
      if (w - cropL - cropR < 1 || h - cropT - cropB < 1) continue;
      input = await sharp(input).extract({ left: cropL, top: cropT, width: w - cropL - cropR, height: h - cropT - cropB }).toBuffer();
      left += cropL; top += cropT;
    }
    layers.push({ input, left, top });
  }
  return sharp(DOLL_SVG(label)).composite(layers).png().toBuffer();
}

async function sheet(tiles, cols, file) {
  const rows = Math.ceil(tiles.length / cols);
  const tw = W / 2, th = (H + 40) / 2;
  const small = await Promise.all(tiles.map((tile) => sharp(tile).resize(tw, th).toBuffer()));
  await sharp({ create: { width: tw * cols, height: th * rows, channels: 3, background: "#ffffff" } })
    .composite(small.map((input, i) => ({ input, left: (i % cols) * tw, top: Math.floor(i / cols) * th })))
    .png().toFile(join(OUT, file));
  console.log(`${file}:${tiles.length} 格`);
}

const byName = (part) => lib.find((item) => item.name.includes(part));
const OUTFITS = [
  ["黑色寬版五分袖T恤", "卡其棉質抽繩寬版短褲", "米白帆布側拉鍊高筒鞋", "米白尼龍半月斜背包"],
  ["灰藍棉質落肩圓領大學T", "深褐黑水洗直筒牛仔褲", "灰紫機能復古慢跑鞋"],
  ["米白立領針織毛衣", "淺灰尼龍多口袋機能短褲", "黑色運動拖鞋"],
  ["淺藍牛津紡扣領長袖襯衫", "黑色西裝長褲", "黑色真皮厚底休閒鞋", "黑色皮革拼接經典印花後背包"],
  ["白色V領合身短袖", "深橄欖棕單排兩釦西裝外套", "灰色抽繩打褶寬版西裝長褲", "黑色真皮厚底休閒鞋"],
  ["米白重磅純棉寬鬆短袖T恤", "Padres 沙漠數位迷彩棒球球衣", "淺藍水洗做舊破損寬版牛仔褲", "米白帆布側拉鍊高筒鞋", "黑色尼龍皮革拼接單肩腰包"],
];
const tiles = [];
for (const names of OUTFITS) {
  const items = names.map(byName).filter(Boolean);
  if (items.length !== names.length) console.warn("找不到:", names.filter((n) => !byName(n)));
  tiles.push(await doll(items, false, "舊"), await doll(items, true, "新"));
}
await sheet(tiles, 6, "outfits.png");

for (const [file, slots] of [["tops.png", ["upperbody", "shirt"]], ["outers.png", ["wholebody_up"]], ["bottoms.png", ["lowerbody"]], ["shoes-bags.png", ["shoes", "bag"]]]) {
  const items = lib.filter((item) => slots.includes(slotOf(item)));
  const singles = [];
  for (const item of items) singles.push(await doll([item], true, item.name.slice(0, 12)));
  await sheet(singles, 10, file);
}
