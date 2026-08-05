// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
import { removeBackground } from "@imgly/background-removal-node";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const jobs=[["IMG_4324.JPG","adidas-large"],["IMG_4332.JPG","zara-large"]];
for(const [f,slug] of jobs){
  console.log("large 模型處理:",f);
  const blob=await removeBackground(pathToFileURL(`photos/${f}`).href,{model:"large",output:{format:"image/png",quality:0.9}});
  await writeFile(`work/tmp/${slug}.png`,Buffer.from(await blob.arrayBuffer()));
  console.log("  ->",slug);
}
