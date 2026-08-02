import sharp from "sharp";
import { readdir } from "node:fs/promises";
const DIR="work/items", CELL=320, COLS=4;
const files=(await readdir(DIR)).filter(f=>f.endsWith(".png")).sort();
const rows=Math.ceil(files.length/COLS);
const layers=[];
for(let i=0;i<files.length;i++){
  const buf=await sharp(`${DIR}/${files[i]}`).resize(CELL-20,CELL-40,{fit:"contain",background:{r:0,g:0,b:0,alpha:0}}).toBuffer();
  layers.push({input:buf,left:(i%COLS)*CELL+10,top:Math.floor(i/COLS)*CELL+30});
  const label=`<svg width="${CELL-20}" height="24"><text x="0" y="16" font-family="monospace" font-size="15" fill="white">${i+1}. ${files[i].replace(".png","").slice(0,30)}</text></svg>`;
  layers.push({input:Buffer.from(label),left:(i%COLS)*CELL+10,top:Math.floor(i/COLS)*CELL+4});
}
await sharp({create:{width:COLS*CELL,height:rows*CELL,channels:4,background:{r:255,g:0,b:255,alpha:1}}})
  .composite(layers).png().toFile("work/contact-magenta.png");
console.log("檢查表完成:",files.length,"件");
files.forEach((f,i)=>console.log(` ${i+1}. ${f}`));
