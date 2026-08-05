// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
import sharp from "sharp";
const files=["navy-wide-leg-trousers-v2","washed-black-straight-jeans-v2","light-gray-washed-jeans-v2","adidas-white-contrast-stitch-hoodie-v2"];
const CELL=420,COLS=4,layers=[];
for(let i=0;i<files.length;i++){
  const buf=await sharp(`work/items/${files[i]}.png`).resize(CELL-20,CELL-40,{fit:"contain",background:{r:0,g:0,b:0,alpha:0}}).toBuffer();
  layers.push({input:buf,left:i*CELL+10,top:30});
  layers.push({input:Buffer.from(`<svg width="${CELL-20}" height="24"><text x="0" y="16" font-family="monospace" font-size="14" fill="white">${i+1}. ${files[i].slice(0,32)}</text></svg>`),left:i*CELL+10,top:4});
}
await sharp({create:{width:COLS*CELL,height:CELL,channels:4,background:{r:255,g:0,b:255,alpha:1}}}).composite(layers).png().toFile("work/v2-check.png");
console.log("ok");
