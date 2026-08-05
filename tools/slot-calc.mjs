// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
// 給定候選槽位,算出整櫃衣物實際會被渲染成多寬多高,用來驗證比例是否落在合理帶
import sharp from "sharp";
import { readFile } from "node:fs/promises";

const AR = 340 / 200;               // stage 高/寬
const lib = JSON.parse(await readFile("data/library.json", "utf8"));

const ratios = {};
for (const it of lib) {
  const m = await sharp(`data/imported/${it.id}-view.webp`).metadata();
  (ratios[it.part] ||= []).push({ ar: m.width / m.height, name: it.name });
}

// 人形基準(viewBox 200x340):肩寬28% 腿寬22% 全身寬48% 腰52.4% 腳踝97%
function report(part, slot) {
  const boxW = slot.w, boxH = slot.h * AR;   // 皆換算成「stage 寬」的倍數
  const br = boxW / boxH;
  const rows = ratios[part].map(({ ar, name }) => {
    const fitsByWidth = ar > br;
    const w = fitsByWidth ? boxW : boxH * ar;
    const h = fitsByWidth ? boxW / ar : boxH;
    return { name, w: w * 100, bottom: (slot.top + h / AR) * 100 };
  }).sort((a, b) => a.w - b.w);
  const f = (n) => n.toFixed(0);
  console.log(`${part.padEnd(13)} 槽位 w${(slot.w*100).toFixed(0)}% top${(slot.top*100).toFixed(1)}% h${(slot.h*100).toFixed(1)}%`);
  console.log(`              寬度 ${f(rows[0].w)}%~${f(rows[rows.length-1].w)}%   底部 ${f(Math.min(...rows.map(r=>r.bottom)))}%~${f(Math.max(...rows.map(r=>r.bottom)))}%`);
}

for (const [part, slot] of Object.entries(JSON.parse(process.argv[2]))) report(part, slot);
