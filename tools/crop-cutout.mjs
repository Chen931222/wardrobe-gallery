// tools/crop-cutout.mjs — 針對特定照片:裁切到衣物區域 → 去背 → 修邊
// 地雷:@imgly/background-removal-node 內建 sharp 0.32(libvips 8.14),與專案的 sharp 0.34
// (libvips 8.17)不能載入同一個 Node 程序,否則 ERR_DLOPEN_FAILED。
// 因此本檔案是「編排器」:用 --phase 參數把自己 spawn 成三個子程序,各載各的套件。
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "work", "items");
const SELF = fileURLToPath(import.meta.url);

// [源檔, 輸出slug, {left, top, width, height}(原圖像素,目視標註)]
const JOBS = [
  ["IMG_4312.JPG", "alonemaster-navy-tee", { left: 110, top: 1080, width: 2100, height: 2620 }],
  ["IMG_4313.JPG", "been-idea-gray-shorts", { left: 40, top: 2700, width: 4430, height: 4750 }],
];

const phase = process.argv[2];

if (!phase) {
  await mkdir(OUT, { recursive: true });
  for (const [file, slug, box] of JOBS) {
    console.log(`處理:${file} → ${slug}`);
    const run = (p) => execFileSync(process.execPath, [SELF, p, file, slug, JSON.stringify(box)], { stdio: "inherit" });
    run("crop"); run("bg"); run("trim");
  }
  console.log("完成");
} else {
  const [, , , file, slug, boxJson] = process.argv;
  const crop = join(OUT, `_crop-${slug}.jpg`);
  const raw = join(OUT, `_raw-${slug}.png`);

  if (phase === "crop") {
    const { default: sharp } = await import("sharp");
    await sharp(join(ROOT, "photos", file)).rotate().extract(JSON.parse(boxJson)).jpeg({ quality: 95 }).toFile(crop);
  } else if (phase === "bg") {
    const { removeBackground } = await import("@imgly/background-removal-node");
    const { pathToFileURL } = await import("node:url");
    const { writeFile } = await import("node:fs/promises");
    const blob = await removeBackground(pathToFileURL(crop).href, { output: { format: "image/png", quality: 0.9 } });
    await writeFile(raw, Buffer.from(await blob.arrayBuffer()));
  } else if (phase === "trim") {
    const { default: sharp } = await import("sharp");
    const { rm } = await import("node:fs/promises");
    await sharp(raw).trim({ threshold: 10 }).extend({
      top: 40, bottom: 40, left: 40, right: 40,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    }).png().toFile(join(OUT, `${slug}.png`));
    await rm(crop, { force: true }); await rm(raw, { force: true });
  }
}
