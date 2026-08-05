// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const OUT = "C:/Users/User/AppData/Local/Temp/claude/G--/e6b768ff-e3a5-46eb-80df-87b24b824d72/tasks/w24yxxptb.output";
const d = JSON.parse(readFileSync(OUT, "utf8"));
const src = (d.result || d).items;
// 這兩件淺色衣物在米黃床單上對比不足,去背成品是半透明鬼影,不入庫
const REJECT = new Set(["light-gray-washed-jeans", "adidas-white-contrast-stitch-hoodie"]);
const items = [];
const extras = [];
for (const i of src) {
  if (REJECT.has(i.slug)) continue;
  if (!existsSync(`work/items/${i.slug}.png`)) { console.warn("找不到成品,略過:", i.slug); continue; }
  items.push({
    slug: i.slug, file: `${i.slug}.png`, modeledFile: null,
    name: i.name, part: i.part,
    color: i.color.toLowerCase(),
    secondaryColor: i.secondaryColor ? i.secondaryColor.toLowerCase() : null,
    tags: (i.tags || []).map(t => t.toLowerCase().slice(0, 40)).slice(0, 12),
    status: "accepted", sourceRefs: [i.file], unknowns: [],
  });
  // warmth/occasions/rainOk 是給 outfit-today 天氣推薦用的,wardrobe 的 schema 不吃,另存
  extras.push({ slug: i.slug, name: i.name, warmth: i.warmth, occasions: i.occasions, rainOk: i.rainOk, color: i.color });
}
writeFileSync("work/manifest.json", JSON.stringify({ items }, null, 2));
writeFileSync("work/wear-attributes.json", JSON.stringify(extras, null, 2));
console.log(`清單完成:${items.length} 件`);
for (const i of items) console.log(` - ${i.name} (${i.part})`);
