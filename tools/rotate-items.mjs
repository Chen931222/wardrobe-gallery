// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
// tools/rotate-items.mjs — 把躺著/顛倒的去背成品轉正。
//
// 角度是「肉眼看圖決定」的,不要憑記憶填:先用大圖看出衣服的「頭」朝哪邊,再套規則——
//   頭朝右 → rotate(-90)(逆時針,右緣轉到上緣)
//   頭朝左 → rotate(90) (順時針,左緣轉到上緣)
//   頭朝下 → rotate(180)
// sharp 的正角度是順時針。
//
// 本檔上一版把其中三件的方向填反了(帽T 記成 +90、兩條褲子記成 -90),所以當初沒修好。
// 改完務必重新算圖目視驗收,不要只看 log。
import sharp from "sharp";
import { existsSync } from "node:fs";
import { rename } from "node:fs/promises";

const JOBS = [
  { slug: "washed-slate-blue-hoodie",       deg: -90, why: "帽T:帽子在右 → 逆時針 90" },
  { slug: "charcoal-twill-belted-trousers", deg: 90,  why: "西裝褲:褲頭在左 → 順時針 90" },
  { slug: "indigo-denim-cargo-joggers",     deg: 180, why: "丹寧工裝褲:整件顛倒 → 180" },
  { slug: "charcoal-purple-sweatpants",     deg: 90,  why: "運動棉褲:褲頭在左 → 順時針 90" },
];

for (const job of JOBS) {
  const path = `work/items/${job.slug}.png`;
  if (!existsSync(path)) { console.warn("  找不到:", path); continue; }
  const before = await sharp(path).metadata();
  const tmp = `${path}.tmp.png`;
  await sharp(path).rotate(job.deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(tmp);
  await rename(tmp, path);
  const after = await sharp(path).metadata();
  console.log(`✓ ${job.why}  ${before.width}x${before.height} → ${after.width}x${after.height}`);
}
