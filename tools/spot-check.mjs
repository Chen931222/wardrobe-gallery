import sharp from "sharp";
import { readFile } from "node:fs/promises";
const lib = JSON.parse(await readFile("data/library.json","utf8"));
const keys = ["白色 adidas 藍車線","灰藍水洗做舊寬鬆連帽","黑白灰橫條紋","橄欖綠撞色車線"];
const CELL=380, layers=[];
for(let i=0;i<keys.length;i++){
  const it=lib.find(x=>x.name.includes(keys[i]));
  const buf=await sharp(`data/imported/${it.id}-garment.png`)
    .resize(CELL-16,CELL-16,{fit:"contain",background:{r:0,g:0,b:0,alpha:0}}).toBuffer();
  layers.push({input:buf,left:i*CELL+8,top:8});
}
await sharp({create:{width:keys.length*CELL,height:CELL,channels:4,background:{r:255,g:0,b:255,alpha:1}}})
  .composite(layers).jpeg({quality:88}).toFile("work/spot-check.jpg");
console.log("done");
