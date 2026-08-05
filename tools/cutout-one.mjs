// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
// tools/cutout-one.mjs — 單件去背流水線,給工作流的代理各自呼叫。
//
// 用法:
//   node tools/cutout-one.mjs --file IMG_4320.JPG --slug been-idea-shorts --box 40,180,900,700 [--refine]
//
// --box 是「正規化 0~1000」座標 (left,top,width,height),不是像素 —— 因為這批照片有直式
// (2268x4032) 也有橫式 (8064x4536),用正規化座標代理就不必知道每張的實際尺寸。
// --refine 會多做一次「鋪白底再去背」,深色衣服配深色背景時需要。
//
// 地雷:@imgly/background-removal-node 內建 sharp 0.32(libvips 8.14),與專案的 sharp 0.34
// (libvips 8.17)不能載入同一個 Node 程序,否則 ERR_DLOPEN_FAILED。所以本檔是編排器:
// 用 --phase 把自己 spawn 成子程序,各載各的套件。
import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "work", "items");
const TMP = join(ROOT, "work", "tmp");
const SELF = fileURLToPath(import.meta.url);

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};
const has = (name) => process.argv.includes(`--${name}`);

const phase = arg("phase");
const file = arg("file");
const slug = arg("slug");
const box = arg("box");
const refine = has("refine");

if (!file || !slug) {
  console.error("需要 --file 與 --slug");
  process.exit(1);
}

const crop = join(TMP, `crop-${slug}.jpg`);
const raw = join(TMP, `raw-${slug}.png`);
const flat = join(TMP, `flat-${slug}.jpg`);
const raw2 = join(TMP, `raw2-${slug}.png`);
const final = join(OUT, `${slug}.png`);

if (!phase) {
  await mkdir(OUT, { recursive: true });
  await mkdir(TMP, { recursive: true });
  const run = (p) => execFileSync(process.execPath, [SELF, "--phase", p, "--file", file, "--slug", slug, ...(box ? ["--box", box] : [])], { stdio: "inherit" });
  run("crop");
  run("bg");
  run("trim");
  if (refine) { run("flat"); run("bg2"); run("trim2"); }
  // 清乾淨中繼檔,避免 work/tmp 越積越大
  for (const f of [crop, raw, flat, raw2]) await rm(f, { force: true });
  console.log(JSON.stringify({ slug, output: `work/items/${slug}.png`, refined: refine }));
} else if (phase === "crop") {
  const { default: sharp } = await import("sharp");
  const src = sharp(join(ROOT, "photos", file)).rotate();
  const meta = await src.metadata();
  // EXIF 轉正後的實際尺寸(rotate() 之後才準)
  const W = meta.orientation && meta.orientation >= 5 ? meta.height : meta.width;
  const H = meta.orientation && meta.orientation >= 5 ? meta.width : meta.height;
  let region = null;
  if (box) {
    const [l, t, w, h] = box.split(",").map(Number);
    const px = (v, total) => Math.round((v / 1000) * total);
    region = {
      left: Math.max(0, px(l, W)),
      top: Math.max(0, px(t, H)),
      width: Math.min(W - Math.max(0, px(l, W)), px(w, W)),
      height: Math.min(H - Math.max(0, px(t, H)), px(h, H)),
    };
  }
  const pipe = region ? sharp(join(ROOT, "photos", file)).rotate().extract(region) : sharp(join(ROOT, "photos", file)).rotate();
  await pipe.jpeg({ quality: 95 }).toFile(crop);
} else if (phase === "bg" || phase === "bg2") {
  const { removeBackground } = await import("@imgly/background-removal-node");
  const { writeFile } = await import("node:fs/promises");
  const input = phase === "bg" ? crop : flat;
  const output = phase === "bg" ? raw : raw2;
  const blob = await removeBackground(pathToFileURL(input).href, { output: { format: "image/png", quality: 0.9 } });
  await writeFile(output, Buffer.from(await blob.arrayBuffer()));
} else if (phase === "flat") {
  const { default: sharp } = await import("sharp");
  await sharp(final).flatten({ background: "#ffffff" }).jpeg({ quality: 95 }).toFile(flat);
} else if (phase === "trim" || phase === "trim2") {
  const { default: sharp } = await import("sharp");
  const input = phase === "trim" ? raw : raw2;
  await sharp(input).trim({ threshold: 10 }).extend({
    top: 40, bottom: 40, left: 40, right: 40,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).png().toFile(final);
}
