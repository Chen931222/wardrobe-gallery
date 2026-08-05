// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
import sharp from "sharp";
import { readdir } from "node:fs/promises";
const files=(await readdir("work/items")).filter(f=>f.endsWith(".png")).sort();
console.log("成品".padEnd(38),"不透明%","半透明%","邊緣接觸","判定");
for(const f of files){
  const img=sharp(`work/items/${f}`);
  const {width:w,height:h}=await img.metadata();
  const {data}=await img.ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let opaque=0,partial=0,total=w*h,edge=0;
  for(let i=0;i<total;i++){
    const a=data[i*4+3];
    if(a>240)opaque++; else if(a>25)partial++;
  }
  // 檢查四邊是否有不透明像素(表示衣物被畫面切到)
  for(let x=0;x<w;x++){ if(data[(x)*4+3]>200)edge++; if(data[((h-1)*w+x)*4+3]>200)edge++; }
  for(let y=0;y<h;y++){ if(data[(y*w)*4+3]>200)edge++; if(data[(y*w+w-1)*4+3]>200)edge++; }
  const op=100*opaque/total, pa=100*partial/total;
  const ghost = op<12 || pa>op*0.8;
  console.log(f.replace(".png","").padEnd(38), op.toFixed(1).padStart(6), pa.toFixed(1).padStart(7), String(edge).padStart(8), ghost?"  ✗ 鬼影/殘缺":"  ✓ 實心");
}
