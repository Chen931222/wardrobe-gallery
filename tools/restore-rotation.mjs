// 把先前旋轉過的 4 件還原回原始方向(從去背中繼檔 work/tmp 或重新從 photos 去背都太慢,
// 這裡直接對現有檔案套用「反向旋轉」抵銷之前的操作)。
import sharp from "sharp";
import { existsSync } from "node:fs";
import { rename } from "node:fs/promises";
// 之前累計套用的旋轉:帽T +90、西裝褲 -90 再 +180(=net +90)、牛仔褲 +180、棉褲 -90
// 還原 = 套用相反角度
const JOBS = [
  { slug: "washed-slate-blue-hoodie",       id: "import-989ebf47-4c1e-4623-900e-14dc95dfa55d", undo: -90 },
  { slug: "charcoal-twill-belted-trousers", id: "import-84c6de01-bb51-4592-aba8-b6ca34594b09", undo: -90 },
  { slug: "indigo-denim-cargo-joggers",     id: "import-ea4b8964-36f6-4295-8f9c-d0980365f187", undo: 180 },
  { slug: "charcoal-purple-sweatpants",     id: "import-dbad17a4-4fda-49fe-926b-a0cfb28b011c", undo: 90 },
];
for (const j of JOBS) {
  for (const p of [`work/items/${j.slug}.png`, `data/imported/${j.id}-garment.png`]) {
    if (!existsSync(p)) { console.warn("  找不到:", p); continue; }
    const tmp = p + ".tmp.png";
    await sharp(p).rotate(j.undo, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(tmp);
    await rename(tmp, p);
  }
  console.log(`✓ 還原 ${j.slug} (套用 ${j.undo}°)`);
}
