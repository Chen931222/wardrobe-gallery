// [本 fork 新增] 人台上每件衣服畫在哪、多大(2026-10-18)。搭配頁(OutfitStudio)、歡迎畫面的示範人台(Welcome)、
// 分享圖的人形版式(lookCard)共用這一支,三個地方畫出來的比例才一樣。
//
// 舊版:每格一個固定的框,整張照片 contain 進去。照片怎麼拍就決定衣服多大 —— 透明邊多就小、長袖攤開就窄、
// 實測 104 件:舊版畫出來的上衣身寬 54–89、外套 78–104、褲子腰寬 29–62 人台單位,同一類差到快兩倍。
// 新版:先量出每件的身形(src/garmentShape.js),再用同一把尺放:
//   上衣、襯衫、外套 → 身寬畫成固定寬,肩線對到人台的肩
//   褲子 → 腰寬畫成固定寬,腰線對到人台的腰;長度跟著照片走,短褲自然短,長褲停在鞋面上方(不蓋住鞋)
//   鞋 → 鞋長畫成固定長,鞋底踩在地上;包 → 包身畫成固定寬,掛在右腰
// 量不到(圖還沒載入、讀不到透明度)和沒有標準值的格子(眼鏡、皮帶、手錶…)照舊版的框畫。
import { measureShape } from "./garmentShape.js";

export const DOLL = { w: 200, h: 340 };   // 人台的 viewBox(Silhouette)

// 舊版的槽位(%):量不到身形、還有眼鏡皮帶這些小配件,照這個畫
export const SLOT_STYLE = {
  socks:          { left: 35, top: 70,   width: 30, height: 12,   z: 2 },
  shoes:          { left: 36, top: 82,   width: 28, height: 18,   z: 3 },
  lowerbody:      { left: 31, top: 51,   width: 38, height: 44,   z: 4 },
  upperbody:      { left: 25, top: 16,   width: 50, height: 36,   z: 5 },
  // 襯衫層(2026-10-08):疊在上衣外面、外套裡面
  shirt:          { left: 24, top: 15.5, width: 52, height: 38,   z: 6 },
  // 皮帶、項鍊、戒指、隨身小物(2026-10-06):位置對著人台 200×340 的腰 y≈165–178、脖子 y≈46–60、右手下緣 y≈150–165
  belt:           { left: 34, top: 48.5, width: 32, height: 5.5,  z: 7 },
  wholebody_up:   { left: 22, top: 14.5, width: 56, height: 42,   z: 8 },
  necklace:       { left: 41, top: 15,   width: 18, height: 9,    z: 9 },
  bag:            { left: 54, top: 46,   width: 26, height: 19,   z: 10 },
  eyewear:        { left: 38, top: 3.5,  width: 24, height: 8,    z: 11 },
  wrist:          { left: 23, top: 41,   width: 15, height: 8,    z: 11 },
  ring:           { left: 66, top: 44,   width: 8,  height: 5,    z: 11 },
  carry:          { left: 56, top: 20,   width: 6,  height: 10,   z: 11 },
  accessories_up: { left: 62, top: 1,    width: 30, height: 15,   z: 11 },
};

// 量得到身形的格子用的那把尺(人台單位)。人台的軀幹(肩 y58 到胯下 y178)約 75cm,所以約 1.6 單位/cm;衣服照平鋪的真實尺寸換算:
//   T 恤身寬約 50cm → 78(比 56 寬的軀幹寬,平放的衣服本來就比身體正面寬),長約 70cm,下擺落在胯下附近
//   褲子腰寬平放約 40cm → 62,從腰(y162)往下;鞋長約 28cm → 45;包身約 28cm → 44
// key = 基準尺寸畫多寬(鞋是多長);x = 中線;y = 對齊線(肩/腰/鞋底/包頂);
// height = 衣服本身(不含透明邊)的合理高度範圍:量歪了(去背破洞、袖子貼著身體)才不會畫成一條或蓋掉整個人
// hem = 下擺最低到哪(長褲);outline = 整件連背帶最多多寬多高(包)
//
// 鞋是俯拍的一雙、直著畫,從地上往上佔 45 高,鞋面在 y292。長褲照真的長度會垂到腳踝、把鞋蓋掉一半(2026-10-19 本人:
// 「長褲停在鞋面上方、不要蓋住鞋子」),所以下擺最低就到鞋面(驗收:原本多 3 會切到鞋尖)。真的長褲穿起來本來就停在鞋面上。
// 半月包、斜背包的背帶攤開很長,只照包身算會甩出人台外(本人:「包連背帶一起限制大小」),所以連背帶整件再限一次。
const FLOOR = 337;
const SHOE_KEY = 45;
const HEM_LINE = FLOOR - SHOE_KEY;   // 292 = 鞋面
const MAX_SQUASH = 0.85;                 // 長褲太長時先只壓長度(腰寬不變),最多壓到 85%;還不夠才整件縮
const TARGET = {
  upperbody:    { key: 78, x: 100, y: 58,  height: [88, 150] },
  shirt:        { key: 80, x: 100, y: 57,  height: [95, 165] },
  wholebody_up: { key: 86, x: 100, y: 56,  height: [95, 165] },
  lowerbody:    { key: 62, x: 100, y: 162, height: [45, 400], hem: HEM_LINE },
  shoes:        { key: SHOE_KEY, x: 100, y: FLOOR, height: [34, 60] },
  bag:          { key: 44, x: 140, y: 152, height: [24, 85], outline: [50, 62] },   // 50×62:連背帶不超過大腿那麼寬,背帶尾巴不甩出人台;後背包比較高,高度留多一點
};
export const MEASURED_SLOTS = Object.keys(TARGET);

/** 這件(整張圖,含透明邊)在人台上的底框,人台單位 { x, y, w, h, auto }。auto = 照量到的身形擺的。 */
export function baseBox(slot, shape, nat) {
  const target = TARGET[slot];
  if (target && shape) {
    let w = target.key / shape.key;
    let h = w / shape.aspect;
    const garment = shape.bh * h;
    const [lo, hi] = target.height;
    if (garment < lo || garment > hi) {
      const f = (garment < lo ? lo : hi) / garment;
      w *= f;
      h *= f;
    }
    // 長褲:腰線以下的長度超過「腰到鞋面」就先只壓長度,壓到 85% 還不夠才整件縮(腰寬盡量不變)
    let squash = 1;
    if (target.hem) {
      const below = (shape.by + shape.bh - shape.anchor) * h;
      const room = target.hem - target.y;
      if (below > room) {
        const f = room / below;
        squash = Math.max(MAX_SQUASH, f);
        const shrink = f / squash;
        w *= shrink;
        h *= shrink;
      }
    }
    // 包:整件(連背帶)超過上限就整件縮
    if (target.outline) {
      const [maxW, maxH] = target.outline;
      const f = Math.min(1, maxW / (shape.bw * w), maxH / (shape.bh * h));
      w *= f;
      h *= f;
    }
    h *= squash;   // 只壓高度:框跟圖不再同比例,畫的時候要拉伸(object-fit: fill),不能 contain
    return { x: target.x - shape.axis * w, y: target.y - shape.anchor * h, w, h, auto: true };
  }
  const s = SLOT_STYLE[slot] || SLOT_STYLE.upperbody;
  const boxW = (s.width / 100) * DOLL.w, boxH = (s.height / 100) * DOLL.h;
  const ar = nat?.w && nat?.h ? nat.w / nat.h : boxW / boxH;
  const w = ar > boxW / boxH ? boxW : boxH * ar;
  const h = w / ar;
  // 舊版:contain 進框、置中、貼齊框頂
  return { x: (s.left / 100) * DOLL.w + (boxW - w) / 2, y: (s.top / 100) * DOLL.h, w, h, auto: false };
}

export const FIT_VERSION = 2;
export const DEFAULT_FIT = { dx: 0, dy: 0, scale: 1, rot: 0 };
// 「真的拉過」:位移超過人台的 0.5%、縮放差 2% 以上或轉了 1 度以上。手指點一下帶到的小抖動不算,
// 不然那件就一直卡在舊版的位置,新比例對它無效(驗收抓到)
const moved = (fit) => Boolean(fit && (Math.abs(fit.dx || 0) > 0.5 || Math.abs(fit.dy || 0) > 0.5
  || Math.abs((fit.scale || 1) - 1) > 0.02 || Math.abs(fit.rot || 0) > 1));

/** 存著的微調(open-wardrobe-fit-v1)換成以新版底框為準的值。
 *  新版(v: 2):dx/dy = 底框中心往哪移(人台的 %),scale/rot 以中心為軸。
 *  舊版(沒有 v):位移是以舊槽位為底的。真的拉過的,換算成新版、畫面上的位置大小跟以前一樣(使用者自己擺的不動);
 *  只調過層次的(z),位置交給新版。存著的資料不改,下次動到這件才寫成新版。
 *  新版寫入時順手記下當時的底框(at:中心和寬,人台單位)。之後底框變了(那時圖還沒量到、換了一台裝置、換了圖),
 *  照 at 補回來,畫面上的位置大小還是當時擺的那樣(驗收抓到:不記的話,量到之後整件會位移)。 */
export function effectiveFit(slot, fit, shape, nat) {
  const layer = typeof fit?.z === "number" ? { z: fit.z } : {};
  if (!fit) return { ...DEFAULT_FIT, v: FIT_VERSION };
  if (fit.v === FIT_VERSION) {
    const at = fit.at;
    // 只調過層次(z)、沒拉過位置大小的,跟著新底框走,不用 at 釘在舊位置(驗收:不然改了版面它不跟著改)
    if (!moved(fit)) return { ...DEFAULT_FIT, ...layer, v: FIT_VERSION };
    if (!at || !(at.w > 0)) return { ...DEFAULT_FIT, ...fit };
    const base = baseBox(slot, shape, nat);
    const cx = base.x + base.w / 2, cy = base.y + base.h / 2;
    if (Math.abs(cx - at.cx) < 0.01 && Math.abs(cy - at.cy) < 0.01 && Math.abs(base.w - at.w) < 0.01) return { ...DEFAULT_FIT, ...fit };
    return {
      ...DEFAULT_FIT, ...fit,
      dx: (fit.dx || 0) + ((at.cx - cx) / DOLL.w) * 100,
      dy: (fit.dy || 0) + ((at.cy - cy) / DOLL.h) * 100,
      scale: ((fit.scale || 1) * at.w) / base.w,
      at: { cx, cy, w: base.w },
    };
  }
  if (!moved(fit)) return { ...DEFAULT_FIT, ...layer, v: FIT_VERSION };
  const base = baseBox(slot, shape, nat);
  if (!base.auto) return { ...DEFAULT_FIT, ...fit, v: FIT_VERSION };   // 新版也量不到:底框跟舊版一樣,值照用
  const legacy = baseBox(slot, null, nat);
  const oldCx = legacy.x + legacy.w / 2 + ((fit.dx || 0) / 100) * DOLL.w;
  const oldCy = legacy.y + legacy.h / 2 + ((fit.dy || 0) / 100) * DOLL.h;
  return {
    dx: ((oldCx - (base.x + base.w / 2)) / DOLL.w) * 100,
    dy: ((oldCy - (base.y + base.h / 2)) / DOLL.h) * 100,
    scale: (legacy.w * (fit.scale || 1)) / base.w,
    rot: fit.rot || 0,
    ...layer,
    v: FIT_VERSION,
  };
}

/** 寫入新版微調時要記的底框(見 effectiveFit 的 at)。 */
export function anchorOf(slot, shape, nat) {
  const base = baseBox(slot, shape, nat);
  return { cx: base.x + base.w / 2, cy: base.y + base.h / 2, w: base.w };
}

/** 一件衣服最後畫在哪:{ x, y, w, h(人台單位,未縮放旋轉前), scale, rot, cx, cy(中心), fit(換算後的微調), auto }。 */
export function placeGarment(slot, shape, nat, rawFit) {
  const base = baseBox(slot, shape, nat);
  const fit = effectiveFit(slot, rawFit, shape, nat);
  const x = base.x + (fit.dx / 100) * DOLL.w;
  const y = base.y + (fit.dy / 100) * DOLL.h;
  return { x, y, w: base.w, h: base.h, scale: fit.scale ?? 1, rot: fit.rot || 0, cx: x + base.w / 2, cy: y + base.h / 2, fit, base, auto: base.auto };
}

/* ---------- 瀏覽器:從已載入的 <img> 量身形,同一張圖量一次 ---------- */
const shapeCache = new Map();   // `${slot}|${src}` → shape 或 null(量不到)
const MEASURE_WIDTH = 200;      // 縮到 200px 寬再量,夠準也夠快

// 快取的鍵用完整網址:頁面上給的是「/data/…」,<img> 量的時候拿到的是「http://…/data/…」,不換成同一種就永遠對不上
const absolute = (src) => {
  try { return new URL(src, globalThis.location?.href).href; } catch { return src; }
};

/** 量過了回身形(量不到是 null);還沒量過回 undefined。 */
export function cachedShape(slot, src) {
  const key = `${slot}|${absolute(src)}`;
  return shapeCache.has(key) ? shapeCache.get(key) : undefined;
}

/** 量一張已載入的圖。跨網域讀不到透明度(canvas 被污染)回 null,人台就照舊版槽位畫。 */
export function shapeFromImage(img, slot) {
  const src = img?.currentSrc || img?.src;
  if (!src || !MEASURED_SLOTS.includes(slot)) return null;
  const cached = cachedShape(slot, src);
  if (cached !== undefined) return cached;
  let shape = null;
  try {
    const w = Math.min(MEASURE_WIDTH, img.naturalWidth);
    const h = Math.max(1, Math.round((w * img.naturalHeight) / img.naturalWidth));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    shape = measureShape({ data, width: w, height: h, channels: 4 }, slot);
  } catch {
    shape = null;
  }
  shapeCache.set(`${slot}|${absolute(src)}`, shape);
  return shape;
}
