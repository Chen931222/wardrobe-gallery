import sharp from "sharp";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
const lib = JSON.parse(await readFile("data/library.json","utf8"));

// 1) Dickies 短褲:裁掉下方腳趾雜物 → 修邊 → 輕度實心化 → 替換正式檔(分步驟避免 sharp 管線衝突)
{
  const it = lib.find(x=>x.name.includes("橄欖綠撞色車線"));
  const meta = await sharp("work/items/retry4381.png").metadata();
  await sharp("work/items/retry4381.png")
    .extract({ left:0, top:0, width:meta.width, height:Math.round(meta.height*0.66) })
    .png().toFile("work/tmp/step1.png");
  await sharp("work/tmp/step1.png")
    .trim({ threshold:10 })
    .extend({ top:40,bottom:40,left:40,right:40, background:{r:0,g:0,b:0,alpha:0} })
    .png().toFile("work/tmp/step2.png");
  const { data, info } = await sharp("work/tmp/step2.png").ensureAlpha().raw().toBuffer({ resolveWithObject:true });
  for(let i=3;i<data.length;i+=4){
    const a=data[i];
    if(a>=96){ data[i]=255; } else if(a<=25){ data[i]=0; } else { data[i]=Math.min(255,Math.round((a-25)*3.6)); }
  }
  await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toFile(`data/imported/${it.id}-garment.png.tmp`);
  await rename(`data/imported/${it.id}-garment.png.tmp`, `data/imported/${it.id}-garment.png`);
  console.log("✓ Dickies 短褲已替換");
}

// 2) 條紋針織:清掉下襬下方中央的深色床頭板殘塊
{
  const it = lib.find(x=>x.name.includes("黑白灰橫條紋"));
  const path = `data/imported/${it.id}-garment.png`;
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject:true });
  const x0=Math.round(info.width*0.36), x1=Math.round(info.width*0.70), y0=Math.round(info.height*0.85);
  let cleared=0;
  for(let y=y0;y<info.height;y++) for(let x=x0;x<x1;x++){
    const i=(y*info.width+x)*4+3;
    if(data[i]>0){ data[i]=0; cleared++; }
  }
  await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toFile(path+".tmp");
  await rename(path+".tmp", path);
  console.log("✓ 條紋針織殘塊清除", cleared, "像素");
}

// 3) 軍綠短褲:自 library 移除(鬼影無法修復,待重拍)
{
  const idx = lib.findIndex(x=>x.name.includes("軍綠棉質抽繩"));
  const [gone] = lib.splice(idx,1);
  await rm(`data/imported/${gone.id}-garment.png`,{force:true});
  await writeFile("data/library.json", JSON.stringify(lib,null,2));
  console.log("✓ 已移除:", gone.name, "| 剩", lib.length, "件");
}
