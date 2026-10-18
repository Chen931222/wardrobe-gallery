// [本 fork 新增] 量每件衣服照片裡的「身形」(2026-10-18):去背圖的 alpha 外框、上衣的身寬、褲子的腰寬、鞋長,
// 再算現在的人台(固定槽位框 + object-fit: contain)把它畫成多大。用來證明比例錯在哪、錯多少,也給新版定標準值。
// 用法:node tools/measure-shapes.mjs [--json 輸出路徑]
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { measureShape } from "../src/garmentShape.js";

const lib = JSON.parse(await readFile("data/library.json", "utf8"));
const SLOT = {   // 現在的 SLOT_STYLE(%)
  shoes: { left: 36, top: 82, width: 28, height: 18 },
  lowerbody: { left: 31, top: 51, width: 38, height: 44 },
  upperbody: { left: 25, top: 16, width: 50, height: 36 },
  shirt: { left: 24, top: 15.5, width: 52, height: 38 },
  wholebody_up: { left: 22, top: 14.5, width: 56, height: 42 },
  bag: { left: 54, top: 46, width: 26, height: 19 },
};
const slotOf = (item) => (item.part === "upperbody" && /襯衫/.test(item.name || "") ? "shirt" : item.part);

const rows = [];
for (const item of lib) {
  const slot = slotOf(item);
  if (!SLOT[slot]) continue;
  const { data, info } = await sharp(`data/imported/${item.id}-view.webp`).ensureAlpha().resize({ width: 240, withoutEnlargement: true })
    .raw().toBuffer({ resolveWithObject: true });
  const shape = measureShape({ data, width: info.width, height: info.height, channels: info.channels }, slot);
  if (!shape) continue;
  // 現在的畫法:整張圖(含透明邊)contain 進槽位框 → 每個原圖像素在人台上是多少單位(人台 200×340)
  const s = SLOT[slot];
  const boxW = (s.width / 100) * 200, boxH = (s.height / 100) * 340;
  const k = Math.min(boxW / info.width, boxH / info.height);
  rows.push({
    name: item.name, slot,
    padPct: Math.round((1 - (shape.bw * shape.bh)) * 100),          // 透明邊佔整張圖幾成(面積)
    keyNow: +(shape.key * info.width * k).toFixed(1),              // 現在畫出來的身寬/腰寬/鞋長(人台單位)
    heightNow: +(shape.bh * info.height * k).toFixed(1),
    shape,
  });
}

const stat = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  const mean = list.reduce((sum, v) => sum + v, 0) / list.length;
  const sd = Math.sqrt(list.reduce((sum, v) => sum + (v - mean) ** 2, 0) / list.length);
  return { n: list.length, min: sorted[0], max: sorted[sorted.length - 1], mean: +mean.toFixed(1), cv: +((sd / mean) * 100).toFixed(0) };
};
const KEY_NAME = { upperbody: "身寬", shirt: "身寬", wholebody_up: "身寬", lowerbody: "腰寬", shoes: "鞋長", bag: "包身寬" };
for (const slot of Object.keys(SLOT)) {
  const list = rows.filter((row) => row.slot === slot);
  if (!list.length) continue;
  const key = stat(list.map((row) => row.keyNow));
  console.log(`${slot.padEnd(13)} ${String(key.n).padStart(3)} 件  現在畫出來的${KEY_NAME[slot]}:${key.min}–${key.max}(平均 ${key.mean},變異 ${key.cv}%)  透明邊平均 ${Math.round(list.reduce((s, r) => s + r.padPct, 0) / list.length)}%`);
}
const shorts = rows.filter((row) => row.slot === "lowerbody" && /短褲/.test(row.name));
const pants = rows.filter((row) => row.slot === "lowerbody" && !/短褲/.test(row.name));
if (shorts.length && pants.length) {
  console.log(`短褲 ${shorts.length} 件腰寬平均 ${stat(shorts.map((r) => r.keyNow)).mean},長褲 ${pants.length} 件腰寬平均 ${stat(pants.map((r) => r.keyNow)).mean}(真實世界兩者差不多)`);
}
const out = process.argv.indexOf("--json");
if (out > 0) await writeFile(process.argv[out + 1], JSON.stringify(rows, null, 1));
