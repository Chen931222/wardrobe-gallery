// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
import sharp from "sharp";
import { readFile } from "node:fs/promises";
const lib = JSON.parse(await readFile("data/library.json","utf8"));
const CELL=300, COLS=7, PAD=30, PER_SHEET=42;
for(let page=0; page*PER_SHEET<lib.length; page++){
  const slice=lib.slice(page*PER_SHEET,(page+1)*PER_SHEET);
  const rows=Math.ceil(slice.length/COLS);
  const layers=[];
  for(let i=0;i<slice.length;i++){
    const it=slice[i];
    const buf=await sharp(`data/imported/${it.id}-garment.png`)
      .resize(CELL-12, CELL-PAD-6, {fit:"contain", background:{r:0,g:0,b:0,alpha:0}}).toBuffer();
    const x=(i%COLS)*CELL, y=Math.floor(i/COLS)*CELL;
    layers.push({input:buf, left:x+6, top:y+PAD});
    const n=page*PER_SHEET+i+1;
    const label=`<svg width="${CELL}" height="${PAD}"><rect width="${CELL}" height="${PAD}" fill="#111"/><text x="4" y="13" font-family="sans-serif" font-size="12" fill="#0f0">${n}</text><text x="26" y="13" font-family="sans-serif" font-size="11" fill="#fff">${it.name.slice(0,13)}</text><text x="4" y="26" font-family="monospace" font-size="9" fill="#888">${it.part}</text></svg>`;
    layers.push({input:Buffer.from(label), left:x, top:y});
  }
  await sharp({create:{width:COLS*CELL, height:rows*CELL, channels:4, background:{r:255,g:0,b:255,alpha:1}}})
    .composite(layers).jpeg({quality:85}).toFile(`work/orient-check-${page+1}.jpg`);
  console.log(`第 ${page+1} 張:${slice.length} 件`);
}
