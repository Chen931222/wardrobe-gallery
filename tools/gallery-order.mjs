// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
import sharp from "sharp";
import { readFileSync } from "node:fs";
const lib=JSON.parse(readFileSync("data/library.json","utf8"));
const ORDER={upperbody:0,wholebody_up:1,lowerbody:2,accessories_up:3,shoes:4};
const sorted=[...lib].sort((a,b)=>{const d=(ORDER[a.part]??99)-(ORDER[b.part]??99);return d||a.id.localeCompare(b.id);});
const CELL=300,COLS=5,rows=Math.ceil(sorted.length/COLS),layers=[];
for(let i=0;i<sorted.length;i++){
  const file="data/imported/"+sorted[i].image.split("/").pop();
  const buf=await sharp(file).resize(CELL-24,CELL-52,{fit:"contain",background:{r:255,g:255,b:255,alpha:0}}).png().toBuffer();
  layers.push({input:buf,left:(i%COLS)*CELL+12,top:Math.floor(i/COLS)*CELL+40});
  layers.push({input:Buffer.from(`<svg width="${CELL-16}" height="34"><text x="0" y="14" font-family="monospace" font-size="15" font-weight="bold" fill="#c00">#${i+1}</text><text x="30" y="14" font-family="sans-serif" font-size="12" fill="#222">${sorted[i].name}</text><text x="0" y="30" font-family="monospace" font-size="11" fill="#888">${file.split("/").pop().slice(7,19)}</text></svg>`),left:(i%COLS)*CELL+12,top:Math.floor(i/COLS)*CELL+6});
}
await sharp({create:{width:COLS*CELL,height:rows*CELL,channels:4,background:{r:244,g:244,b:244,alpha:1}}}).composite(layers).png().toFile("work/gallery-order.png");
console.log("順序:");sorted.forEach((s,i)=>console.log(` #${i+1} ${s.name} [${s.part}] ${s.image.split("/").pop()}`));
