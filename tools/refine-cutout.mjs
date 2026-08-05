// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
// tools/refine-cutout.mjs — 二次去背:把首輪 cutout 鋪白底再去背一次,清掉殘留的門板/雜訊
// 與 crop-cutout.mjs 相同的多程序編排(sharp 與 @imgly 的 libvips 不能同程序)。
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "work", "items");
const SELF = fileURLToPath(import.meta.url);
const SLUGS = ["alonemaster-navy-tee", "been-idea-gray-shorts"];

const phase = process.argv[2];

if (!phase) {
  for (const slug of SLUGS) {
    console.log(`二次去背:${slug}`);
    const run = (p) => execFileSync(process.execPath, [SELF, p, slug], { stdio: "inherit" });
    run("flat"); run("bg"); run("trim");
  }
  console.log("完成");
} else {
  const slug = process.argv[3];
  const flat = join(OUT, `_flat-${slug}.jpg`);
  const raw = join(OUT, `_raw2-${slug}.png`);

  if (phase === "flat") {
    const { default: sharp } = await import("sharp");
    await sharp(join(OUT, `${slug}.png`)).flatten({ background: "#ffffff" }).jpeg({ quality: 95 }).toFile(flat);
  } else if (phase === "bg") {
    const { removeBackground } = await import("@imgly/background-removal-node");
    const { pathToFileURL } = await import("node:url");
    const { writeFile } = await import("node:fs/promises");
    const blob = await removeBackground(pathToFileURL(flat).href, { output: { format: "image/png", quality: 0.9 } });
    await writeFile(raw, Buffer.from(await blob.arrayBuffer()));
  } else if (phase === "trim") {
    const { default: sharp } = await import("sharp");
    const { rm } = await import("node:fs/promises");
    await sharp(raw).trim({ threshold: 10 }).extend({
      top: 40, bottom: 40, left: 40, right: 40,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    }).png().toFile(join(OUT, `${slug}.png`));
    await rm(flat, { force: true }); await rm(raw, { force: true });
  }
}
