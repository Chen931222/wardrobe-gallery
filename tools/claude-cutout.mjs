// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
// tools/claude-cutout.mjs — Claude 匯入流程的去背步驟(取代 OpenAI 生圖)
// photos/ 的衣服照片 → 本地 AI 去背 → work/items/ 透明 PNG
// 之後由 Claude 撰寫 work/manifest.json,再跑官方匯入腳本:
//   node .agents/skills/import-clothes/scripts/import-to-wardrobe.mjs --items work/items --manifest work/manifest.json
import { removeBackground } from "@imgly/background-removal-node";
import { readdir, writeFile, mkdir } from "node:fs/promises";
import { join, parse } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "photos");
const OUT = join(ROOT, "work", "items");
const EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

await mkdir(SRC, { recursive: true });
await mkdir(OUT, { recursive: true });
const files = (await readdir(SRC)).filter(f => EXTS.has(parse(f).ext.toLowerCase()));
if (!files.length) {
  console.log(`photos/ 是空的——把衣服照片丟進 ${SRC} 再跑一次`);
  process.exit(0);
}

for (const f of files) {
  const out = join(OUT, parse(f).name + ".png");
  console.log(`去背中:${f} …`);
  const blob = await removeBackground(pathToFileURL(join(SRC, f)).href, {
    output: { format: "image/png", quality: 0.9 },
  });
  await writeFile(out, Buffer.from(await blob.arrayBuffer()));
  console.log(`  → ${out}`);
}
console.log(`完成 ${files.length} 張,輸出在 work/items/`);
