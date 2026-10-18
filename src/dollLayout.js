// [本 fork 新增] 人台上每件衣服畫在哪、多大(2026-10-18)。搭配頁(OutfitStudio)、歡迎畫面的示範人台(Welcome)、
// 分享圖的人形版式(lookCard)共用這一支,三個地方畫出來的比例才一樣。
//
// 舊版:每格一個固定的框,整張照片 contain 進去。照片怎麼拍就決定衣服多大 —— 透明邊多就小、長袖攤開就窄、
// 實測 104 件:舊版畫出來的上衣身寬 54–89、外套 78–104、褲子腰寬 29–62 人台單位,同一類差到快兩倍。
// 新版:先量出每件的身形(src/garmentShape.js),再用同一把尺放:
//   上衣、襯衫、外套 → 身寬畫成固定寬,肩線對到人台的肩
//   褲子 → 腰寬畫成固定寬,腰線對到人台的腰;長度跟著照片走,短褲自然短、長褲到腳踝
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
//   褲子腰寬平放約 40cm → 62,長褲約 100cm,從腰(y162)垂到腳踝;鞋長約 28cm → 46;包身約 28cm → 46
// key = 基準尺寸畫多寬(鞋是多長);x = 中線;y = 對齊線(肩/腰/鞋底/包頂);
// height = 衣服本身(不含透明邊)的合理高度範圍:量歪了(去背破洞、袖子貼著身體)才不會畫成一條或蓋掉整個人
const TARGET = {
  upperbody:    { key: 78, x: 100, y: 58,  height: [88, 150] },
  shirt:        { key: 80, x: 100, y: 57,  height: [95, 165] },
  wholebody_up: { key: 86, x: 100, y: 56,  height: [95, 165] },
  lowerbody:    { key: 62, x: 100, y: 162, height: [45, 166] },   // 166:腰 162 往下到腳踝 328,不蓋過腳
  shoes:        { key: 48, x: 100, y: 337, height: [34, 60] },
  bag:          { key: 46, x: 138, y: 150, height: [24, 85] },
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
