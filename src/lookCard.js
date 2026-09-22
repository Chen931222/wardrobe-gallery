// [本 fork 新增] Look 卡:把一套穿搭在瀏覽器 canvas 合成一張可分享的圖(1080×1350,IG 直式)。
//
// 為什麼是這條路:站主不想把人臉/身體照片丟給第三方試穿 API(生物特徵送出去收不回來),
// 所以「呈現穿搭」改用兩種不需要人的版式 —— 平鋪 lookbook(主圖,雜誌攤法)與紙娃娃(備用)。
// 全程在使用者裝置上算,零上傳、零費用;要不要分享是使用者自己按的。
//
// 顏色與字型直接讀站上的 CSS 變數,卡片跟網站同一個味道(印刷品,不是 AI 生圖)。

const W = 1080, H = 1350, PAD = 80, CAPTION_H = 200;

function readTheme() {
  const css = getComputedStyle(document.documentElement);
  const get = (name, fallback) => (css.getPropertyValue(name).trim() || fallback);
  return {
    paper: get("--paper", "#201b14"),
    surface: get("--surface", "#2a231b"),
    ink: get("--ink", "#f0e9d9"),
    muted: get("--muted", "#9b8c73"),
    accent: get("--accent", "#cdaf7f"),
    line: get("--line", "#392f22"),
    doll: get("--doll", "#4a4030"),
  };
}

async function ensureFonts() {
  if (!document.fonts?.load) return;
  try {
    await Promise.all([
      document.fonts.load('600 44px "Cormorant"'),
      document.fonts.load('500 26px "Cormorant"'),
      document.fonts.load('400 24px "Noto Serif TC"'),
    ]);
  } catch { /* 字型沒載到就用 fallback serif,不擋合成 */ }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`圖片載不到:${src}`));
    img.src = src;
  });
}

// 和 ItemViewer 的 pieceRotation 同一招:用 id 決定一個固定的小角度,每次合成都一樣
function seededTilt(id, range = 3) {
  const hash = [...String(id)].reduce((total, ch) => total + ch.charCodeAt(0), 0);
  return (hash % (range * 2 + 1)) - range;
}

function roundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === "function") { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); return; }
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fill();
}

/** 把圖以 contain 放進框裡;top=true 時貼齊框頂(和紙娃娃一樣),旋轉/縮放軸心=內容中心。 */
function drawFitted(ctx, img, box, { rot = 0, top = false, scale = 1, shadow = 0.32 } = {}) {
  const ar = img.naturalWidth / img.naturalHeight;
  let cw, ch;
  if (ar > box.w / box.h) { cw = box.w; ch = box.w / ar; } else { ch = box.h; cw = box.h * ar; }
  const cx = box.x + box.w / 2;
  const cy = top ? box.y + ch / 2 : box.y + box.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(scale, scale);
  if (shadow) { ctx.shadowColor = `rgba(0,0,0,${shadow})`; ctx.shadowBlur = 30; ctx.shadowOffsetY = 14; }
  ctx.drawImage(img, -cw / 2, -ch / 2, cw, ch);
  ctx.restore();
}

/* ---------- 版式 A:平鋪 lookbook ---------- */

// 框用內容區的比例寫。左欄:外套在左上、上衣壓在它上面一點、下身在下。
// 右欄:小配件→包→鞋由上往下疊,整欄垂直置中 —— 東西少(只有襪子+包+鞋)時才不會上空下擠。
function flatlayBoxes(has) {
  const b = {};
  const outer = has("wholebody_up");
  if (outer) b.wholebody_up = { x: 0.00, y: 0.00, w: 0.50, h: 0.52 };
  b.upperbody = outer ? { x: 0.26, y: 0.04, w: 0.44, h: 0.46 } : { x: 0.06, y: 0.02, w: 0.50, h: 0.48 };
  b.lowerbody = { x: 0.06, y: 0.50, w: 0.46, h: 0.50 };

  const column = [
    ...["accessories_up", "eyewear", "wrist", "socks"].filter(has).map((slot) => ({ slot, x: 0.70, w: 0.26, h: 0.14 })),
    ...(has("bag") ? [{ slot: "bag", x: 0.64, w: 0.32, h: 0.30 }] : []),
    ...(has("shoes") ? [{ slot: "shoes", x: 0.60, w: 0.36, h: 0.32 }] : []),
  ];
  const gap = 0.04;
  const total = column.reduce((sum, c) => sum + c.h, 0) + gap * Math.max(0, column.length - 1);
  let y = Math.max(0, (1 - total) / 2);
  for (const c of column) { b[c.slot] = { x: c.x, y, w: c.w, h: c.h }; y += c.h + gap; }
  return b;
}
const FLATLAY_ORDER = ["wholebody_up", "lowerbody", "upperbody", "shoes", "bag", "accessories_up", "eyewear", "wrist", "socks"];

function drawFlatlay(ctx, area, pieces) {
  const has = (slot) => pieces.some((p) => p.slot === slot);
  const boxes = flatlayBoxes(has);
  const ordered = [...pieces].sort((a, b) => FLATLAY_ORDER.indexOf(a.slot) - FLATLAY_ORDER.indexOf(b.slot));
  for (const { slot, item, img } of ordered) {
    const f = boxes[slot];
    if (!f) continue;
    const box = { x: area.x + f.x * area.w, y: area.y + f.y * area.h, w: f.w * area.w, h: f.h * area.h };
    drawFitted(ctx, img, box, { rot: seededTilt(item.id) });
  }
}

/* ---------- 版式 B:紙娃娃(照搭配頁的舞台重畫) ---------- */

const DOLL_VIEW = { w: 200, h: 340 };

function drawSilhouette(ctx, stage, color) {
  const s = stage.w / DOLL_VIEW.w;
  ctx.save();
  ctx.translate(stage.x, stage.y);
  ctx.scale(s, s);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(100, 28, 20, 0, Math.PI * 2); ctx.fill();
  roundRect(ctx, 92, 46, 16, 14, 5);
  roundRect(ctx, 72, 58, 56, 120, 18);
  roundRect(ctx, 52, 66, 18, 95, 9);
  roundRect(ctx, 130, 66, 18, 95, 9);
  roundRect(ctx, 78, 170, 19, 160, 9);
  roundRect(ctx, 103, 170, 19, 160, 9);
  ctx.restore();
}

function drawDoll(ctx, area, pieces, fits, slotStyle, theme) {
  // 舞台維持 200:340,塞進內容區並置中
  let h = area.h, w = (h * DOLL_VIEW.w) / DOLL_VIEW.h;
  if (w > area.w) { w = area.w; h = (w * DOLL_VIEW.h) / DOLL_VIEW.w; }
  const stage = { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
  ctx.fillStyle = theme.surface;
  ctx.fillRect(stage.x, stage.y, stage.w, stage.h);
  drawSilhouette(ctx, stage, theme.doll);

  const ordered = [...pieces]
    .filter((p) => p.slot !== "socks" && slotStyle[p.slot])     // 襪子跟畫面上一樣不畫
    .sort((a, b) => slotStyle[a.slot].z - slotStyle[b.slot].z);
  for (const { slot, item, img } of ordered) {
    const s = slotStyle[slot];
    const fit = fits[item.id] || { dx: 0, dy: 0, scale: 1, rot: 0 };
    const box = {
      x: stage.x + ((s.left + fit.dx) / 100) * stage.w,
      y: stage.y + ((s.top + fit.dy) / 100) * stage.h,
      w: (s.width / 100) * stage.w,
      h: (s.height / 100) * stage.h,
    };
    drawFitted(ctx, img, box, { rot: fit.rot || 0, scale: fit.scale || 1, top: true, shadow: 0.18 });
  }
}

/* ---------- 底部 caption ---------- */

function wrapLines(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let line = "";
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line); line = ch;
      if (lines.length === maxLines) break;
    } else line = test;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && (line.length || text.length > lines.join("").length)) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{1}$/, "…");
  }
  return lines;
}

function drawCaption(ctx, box, caption, theme) {
  ctx.fillStyle = theme.line;
  ctx.fillRect(box.x, box.y, box.w, 2);
  let y = box.y + 56;

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = theme.ink;
  ctx.font = '600 44px "Cormorant", "Noto Serif TC", serif';
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0.06em";
  ctx.fillText(caption.title || "今日穿搭", box.x, y);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0.12em";
  ctx.font = '500 26px "Cormorant", serif';
  ctx.fillStyle = theme.muted;
  ctx.textAlign = "right";
  ctx.fillText(caption.date || "", box.x + box.w, y);
  ctx.textAlign = "left";
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

  if (caption.subtitle) {
    y += 38;
    ctx.font = '400 23px "Noto Serif TC", serif';
    ctx.fillStyle = theme.muted;
    ctx.fillText(caption.subtitle, box.x, y);
  }
  if (caption.items) {
    y += 40;
    ctx.font = '400 22px "Noto Serif TC", serif';
    ctx.fillStyle = theme.ink;
    for (const line of fitItems(ctx, caption.items, box.w, 2)) { ctx.fillText(line, box.x, y); y += 32; }
  }
}

/** 單品清單放不下兩行時,在「單品名稱」的邊界截斷(不要切出「(COACH…」半截),最後補「等 N 件」。 */
function fitItems(ctx, items, maxWidth, maxLines) {
  const names = String(items).split(" · ").filter(Boolean);
  for (let k = names.length; k >= 1; k--) {
    const rest = names.length - k;
    const text = names.slice(0, k).join(" · ") + (rest ? ` · 等 ${rest} 件` : "");
    const lines = wrapLines(ctx, text, maxWidth, maxLines + 1);   // 多給一行,才能判斷有沒有超出
    if (lines.length <= maxLines) return lines;
  }
  return wrapLines(ctx, names[0] || "", maxWidth, maxLines);
}

/**
 * @param {Object} opts
 * @param {"flatlay"|"doll"} opts.style
 * @param {Object} opts.outfit    槽位→單品(和 OutfitStudio 的 wearing 同形)
 * @param {Object} [opts.fits]    人形版式用的微調(id→{dx,dy,scale,rot})
 * @param {Object} [opts.slotStyle] 人形版式用的槽位(OutfitStudio 的 SLOT_STYLE)
 * @param {Object} [opts.caption] { title, date, subtitle, items }
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderLookCard({ style = "flatlay", outfit, fits = {}, slotStyle = {}, caption = {} }) {
  const theme = readTheme();
  await ensureFonts();
  const entries = Object.entries(outfit).filter(([, item]) => item);
  if (!entries.length) throw new Error("身上沒有衣服");
  const pieces = await Promise.all(entries.map(async ([slot, item]) => ({ slot, item, img: await loadImage(item.image) })));

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = theme.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 2;
  ctx.strokeRect(PAD / 2, PAD / 2, W - PAD, H - PAD);   // 一圈髮絲框,印刷品的邊

  const area = { x: PAD, y: PAD, w: W - PAD * 2, h: H - PAD * 2 - CAPTION_H };
  if (style === "doll") drawDoll(ctx, area, pieces, fits, slotStyle, theme);
  else drawFlatlay(ctx, area, pieces);
  drawCaption(ctx, { x: PAD, y: H - PAD - CAPTION_H + 24, w: W - PAD * 2 }, caption, theme);
  return canvas;
}

export const LOOK_CARD_SIZE = { w: W, h: H };
