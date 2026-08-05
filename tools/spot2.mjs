// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
import sharp from "sharp";
const CELL=380, files=["work/items/retry4381.png","work/items/retry4395.png"], layers=[];
for(let i=0;i<files.length;i++){
  const buf=await sharp(files[i]).resize(CELL-16,CELL-16,{fit:"contain",background:{r:0,g:0,b:0,alpha:0}}).toBuffer();
  layers.push({input:buf,left:i*CELL+8,top:8});
}
await sharp({create:{width:files.length*CELL,height:CELL,channels:4,background:{r:255,g:0,b:255,alpha:1}}})
  .composite(layers).jpeg({quality:88}).toFile("work/spot2.jpg");
console.log("done");
