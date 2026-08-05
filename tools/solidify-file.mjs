// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
// 對指定 PNG 直接做 alpha 實心化(半透明鬼影 → 不透明),並回報前後不透明比例。
// 與 solidify-alpha.mjs 的差別:那支是查 library.json 改正式檔,這支吃任意路徑,用於搶救候選。
//
// 用法:node tools/solidify-file.mjs [--keep N] <path...>
//
// 預設門檻(>=70 拉滿、<=25 清掉)適合「大部分是實心、邊緣糊掉」的鬼影。
// 但**白色衣服**的鬼影是整件都很淡:白條紋球衣試過預設值,結果條紋之間的白布
// (alpha<25)被整片清掉,只剩深色條紋,變成破布。這種要用 --keep 8~15 把整個
// 形狀一次撈起來 —— 模型的輪廓其實是對的,只是全體 alpha 偏低。
import sharp from "sharp";
import { rename } from "node:fs/promises";

const argv = process.argv.slice(2);
const keepIdx = argv.indexOf("--keep");
const keep = keepIdx > -1 ? Number(argv[keepIdx + 1]) : null;
const paths = argv.filter((a, i) => !a.startsWith("--") && i !== keepIdx + 1);

for (const path of paths) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const total = data.length / 4;
  let opaqueBefore = 0, opaqueAfter = 0;
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    if (a > 200) opaqueBefore++;
    if (keep !== null) {
      data[i] = a >= keep ? 255 : 0;                  // 硬切:整個形狀一次撈起
    } else {
      // 只要有一定存在感(>=70)就視為衣物本體,拉滿;非常淡的(<=25)當背景清掉
      if (a >= 70) data[i] = 255;
      else if (a <= 25) data[i] = 0;
      else data[i] = Math.min(255, Math.round((a - 25) * 5.6));
    }
    if (data[i] > 200) opaqueAfter++;
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(path + ".tmp");
  await rename(path + ".tmp", path);
  const pct = (n) => (n / total * 100).toFixed(1) + "%";
  console.log(`${path.split(/[\/]/).pop()}  不透明 ${pct(opaqueBefore)} → ${pct(opaqueAfter)}${keep !== null ? `  (--keep ${keep})` : ""}`);
}
