// tools/D-seg.mjs <in.jpg> <outMask.png> [model] — 只用 @imgly,不可 import 專案的 sharp。
// 輸出的是「去背後的 RGBA 圖」,alpha 通道就是遮罩,交給 D-apply.mjs 貼回原圖。
import { removeBackground } from "@imgly/background-removal-node";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const [input, output, model = "medium"] = process.argv.slice(2);
const blob = await removeBackground(pathToFileURL(input).href, {
  model,
  output: { format: "image/png", quality: 0.9 },
});
await writeFile(output, Buffer.from(await blob.arrayBuffer()));
console.log("seg ->", output);
