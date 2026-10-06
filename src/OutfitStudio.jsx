// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, ArrowsClockwise, CalendarCheck, Export, FloppyDisk, ImageSquare, Lock, LockOpen, Microphone, Sparkle, Trash, X } from "@phosphor-icons/react";
import { CitySelect } from "./CitySelect.jsx";
import { adjustIntent, fetchWeather, findItemForSwap, parseRequest, randomOutfit, readWearLog, recommendOutfit, recordWear, unrecordWear } from "./recommend.js";
import { syncCode } from "./sync.js";
import { downloadBackupZip, importBackupFile } from "./backup.js";
import { LookCard } from "./LookCard.jsx";
import { PART_ORDER, PARTS } from "./parts.js";
import { noteDislike, noteRecommendation, noteWear, readTaste, recoStats, unnoteWear } from "./taste.js";
import { useFullImages } from "./useFullImage.js";

// 搭配工作室:把去背衣物疊在人形上組穿搭。
//
// 互動模型(2026-07-20 改版):
//   點衣服 → 出現選取框(角落圓點拉了縮放、頂上圓點拉了旋轉、框內拖曳移動)。
//   點空白處取消選取。選取判定用「像素 alpha 命中測試」——滑鼠點的那個點若在最上層
//   衣物的透明區,會穿透去選中下面那件,所以被外套壓住的上衣也點得到露出來的部分。
//   調整中的那件會暫時提到最上層、其他件變半透明,解決「外套擋住上衣沒辦法調」。
//
// 微調(位移/縮放/旋轉)以「衣物 id」為鍵存 localStorage,同一件衣服在任何穿搭都記得。
const LOOKS_KEY = "open-wardrobe-looks-v1";
const FIT_KEY = "open-wardrobe-fit-v1";
const WEARING_KEY = "open-wardrobe-wearing-v1";   // 身上這套(槽位→id),刷新後還原
const HISTORY_MAX = 5;                             // 復原最多退幾步
const DEFAULT_FIT = { dx: 0, dy: 0, scale: 1, rot: 0 };
const SCALE_MIN = 0.35, SCALE_MAX = 2.4;

// 槽位 = 每件衣服的「起始位置」,使用者拖過之後以 fit 為準。
export const SLOT_STYLE = {
  socks:          { left: 35, top: 70,   width: 30, height: 12,   z: 2 },
  // 鞋子是俯拍的一雙(長寬比 0.6~0.88,偏高),不是側視圖。原本又寬又扁的框會把
  // 高筒鞋壓成 44px 寬的一條(旁邊短褲 144px)。改成窄而高,寬度才回得到 70~101px。
  // 襪子跟著上移,維持「襪子在鞋子上方、不重疊」。
  shoes:          { left: 36, top: 82,   width: 28, height: 18,   z: 3 },
  lowerbody:      { left: 31, top: 51,   width: 38, height: 44,   z: 4 },
  upperbody:      { left: 25, top: 16,   width: 50, height: 36,   z: 5 },
  // 2026-10-06 加的皮帶、項鍊、戒指、隨身小物(位置對著 Silhouette 的 200×340:腰 y≈165–178、脖子 y≈46–60、
  // 右手下緣 y≈150–165、胸前口袋 x≈108–122)。皮帶壓在上衣下擺上面,不然整條被上衣蓋住;外套還是在它上面
  belt:           { left: 34, top: 48.5, width: 32, height: 5.5,  z: 6 },
  wholebody_up:   { left: 22, top: 14.5, width: 56, height: 42,   z: 7 },
  necklace:       { left: 41, top: 15,   width: 18, height: 9,    z: 8 },
  // 包的長寬比從 0.84(後背包)到 1.40(半月斜背包)都有。框開 38% 寬時全部都會
  // 撐到 144px = 跟寬褲一樣寬,像揹了個行李箱。收到 26% 後一律渲染 98px 寬,
  // 約寬褲的七成,才像掛在右腰的包。
  bag:            { left: 54, top: 46,   width: 26, height: 19,   z: 9 },
  eyewear:        { left: 38, top: 3.5,  width: 24, height: 8,    z: 10 },
  wrist:          { left: 23, top: 41,   width: 15, height: 8,    z: 10 },
  ring:           { left: 66, top: 44,   width: 8,  height: 5,    z: 10 },
  carry:          { left: 56, top: 20,   width: 6,  height: 10,   z: 10 },
  accessories_up: { left: 62, top: 1,    width: 30, height: 15,   z: 10 },
};

// 衣架的分類、理由裡的名稱:跟衣櫃同一份(src/parts.js),順序也一樣
const SLOT_LABEL = Object.fromEntries(PART_ORDER.map((part) => [part, PARTS[part].label]));

function readLooks() {
  try {
    const value = JSON.parse(localStorage.getItem(LOOKS_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function readFits() {
  try {
    const value = JSON.parse(localStorage.getItem(FIT_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

// 斷點要影響「畫什麼」時用(純樣式的照舊放 CSS)。寫法同 LandingRing 的 phone。
function useMedia(query) {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

const clampScale = (value) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));
const deg = (rad) => (rad * 180) / Math.PI;

export function Silhouette() {
  return (
    <svg className="studio-doll" viewBox="0 0 200 340" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g fill="var(--doll)">
        <circle cx="100" cy="28" r="20" />
        <rect x="92" y="46" width="16" height="14" rx="5" />
        <rect x="72" y="58" width="56" height="120" rx="18" />
        <rect x="52" y="66" width="18" height="95" rx="9" />
        <rect x="130" y="66" width="18" height="95" rx="9" />
        <rect x="78" y="170" width="19" height="160" rx="9" />
        <rect x="103" y="170" width="19" height="160" rx="9" />
      </g>
    </svg>
  );
}

/* 「身上這套」每個衣櫃各存一份。訪客的「我的衣櫃」和「示範衣櫃」以前共用一個鍵,
   在一邊換衣服就把另一邊那套蓋掉,切回去人台是空的(審查報告 known limit)。站主只有一個衣櫃,沿用原本的鍵。 */
const wearingKey = (closet) => (!closet || closet === "all" ? WEARING_KEY : `${WEARING_KEY}-${closet}`);

function readWearing(closet) {
  try {
    // 分開之前存的那份還在舊鍵裡:這個衣櫃還沒有自己的,就先拿舊的(還原時只會穿回這個衣櫃裡有的衣服)
    const raw = localStorage.getItem(wearingKey(closet)) ?? localStorage.getItem(WEARING_KEY);
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeWearing(closet, outfit) {
  try {
    const ids = Object.fromEntries(Object.entries(outfit || {}).filter(([, item]) => item).map(([slot, item]) => [slot, item.id]));
    localStorage.setItem(wearingKey(closet), JSON.stringify(ids));
  } catch { /* 私密模式等存不了就算了 */ }
}

/** 帶一套進搭配頁之前先記成「身上這套」:進去之後手動重新整理,也穿得回來。 */
export function rememberWearing(outfit, closet = "all") {
  writeWearing(closet, outfit);
}

/** 指令要的東西怎麼說:「黑色」＋「開襟」＋「外套」;都沒講就用那一格的名稱 */
function askedLabel(spec, fallback) {
  const descriptors = (spec.descriptors || []).map((group) => group[0]).filter((word) => !(spec.category || "").includes(word));
  return `${spec.color?.word ? `${spec.color.word}色` : ""}${descriptors.join("")}${spec.category || fallback}`;
}

/**
 * @param onOpenItem 在衣架上點兩下一件衣服時叫,帶 id;App 拿去打開單品頁看資訊
 * @param closet "all"(站主)、"mine"、"demo":「身上這套」各衣櫃分開記
 * @param initialDaily 入口今日推薦帶進來的天氣和理由,進來就看得到為什麼是這套(審查 F25)
 */
export function OutfitStudio({ items, initialOutfit = null, initialDaily = null, onOpenItem = null, closet = "all" }) {
  const [wearing, setWearing] = useState(() => initialOutfit || {});   // 帶一套進來時一開始就穿著,寫回時才不會先寫出空的
  const [looks, setLooks] = useState(readLooks);
  const [stripType, setStripType] = useState("upperbody");
  const [occasion, setOccasion] = useState("");           // 「說個場合」輸入框
  const [locks, setLocks] = useState({});                 // 槽位→true:重挑時那格不動
  const [past, setPast] = useState([]);                   // 復原用:最近幾套 wearing
  const itemCountRef = useRef(items.length);              // 衣服件數:變多了才清掉「沒辦法推薦」
  const lastIntentRef = useRef(null);                     // 上一次整套推薦的場合,給「再正式一點」「再推薦一套」接著用
  const dirtyRef = useRef(false);                         // 使用者真的動過穿搭才寫 localStorage,免得還原前先被空狀態蓋掉
  const pushHistory = (current) => setPast((stack) => [current, ...stack].slice(0, HISTORY_MAX));
  const [card, setCard] = useState(null);                 // Look 卡面板:{ outfit, caption } | null
  // 版面:≤860 單欄(衣架在人台下面,提示要說「下面」);≤640 手機,主要兩顆鈕改成貼底的列
  const stacked = useMedia("(max-width: 860px)");
  const phone = useMedia("(max-width: 640px)");
  const [typing, setTyping] = useState(false);            // 指令框聚焦中:手機把貼底列收起來,免得 iOS 鍵盤彈出時蓋住
  // 失焦後晚一點才把貼底列放回來:點「照這句挑」時輸入框先失焦,列要是立刻冒出來會蓋住剛要點的按鈕,那一下就被吃掉
  const untuckRef = useRef(null);
  const focusOccasion = () => { clearTimeout(untuckRef.current); setTyping(true); };
  const blurOccasion = () => { clearTimeout(untuckRef.current); untuckRef.current = setTimeout(() => setTyping(false), 250); };
  useEffect(() => () => clearTimeout(untuckRef.current), []);


  // 固定的關閉函式:LookCard 的聚焦 effect 依賴它,每次 render 給新的,同步一重讀焦點就被搶回關閉鈕
  const closeCard = useCallback(() => setCard(null), []);

  // 開 Look 卡:把身上這套(或收藏的某套)連同日期/天氣/場合做成 caption,交給 LookCard 合成
  const openCard = (outfitMap, meta = {}) => {
    const names = Object.values(outfitMap).filter(Boolean).map((item) => item.name).filter(Boolean);
    if (!names.length) return;
    const now = new Date();
    const date = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`;
    const weather = meta.weather;
    setCard({
      outfit: { ...outfitMap },
      caption: {
        title: meta.title || meta.understood || "今日穿搭",
        date,
        subtitle: weather ? `${weather.city || "台中"} ${weather.temp}° · ${weather.desc} · 降雨 ${weather.rainProb}%` : "",
        items: names.join(" · "),
      },
    });
  };
  const [fits, setFits] = useState(readFits);
  const [adjusting, setAdjusting] = useState(null);       // 選取中的槽位
  const [natSizes, setNatSizes] = useState({});            // itemId → {w,h} 圖片原始尺寸
  const stageRef = useRef(null);
  const dragRef = useRef(null);                            // { mode, itemId, ... }
  const alphaCache = useRef(new Map());                    // itemId → ctx(原始解析度) 供命中測試

  // 入口頁按「穿這套」帶進來的推薦穿搭,直接套上人形
  useEffect(() => {
    if (initialOutfit) { dirtyRef.current = true; setWearing(initialOutfit); setAdjusting(null); setDaily(initialDaily); }
  }, [initialOutfit]);   // eslint-disable-line react-hooks/exhaustive-deps -- 理由跟著那一套走,只在換一套帶進來時換

  // 記住身上這套:進頁面先從 localStorage 還原(入口頁帶進來的優先),之後只要使用者動過就存。
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !items.length) return;
    restoredRef.current = true;
    if (initialOutfit) return;
    const next = {};
    for (const [slot, id] of Object.entries(readWearing(closet))) {
      const item = items.find((existing) => existing.id === id);
      if (item && item.part === slot) next[slot] = item;
    }
    if (Object.keys(next).length) setWearing(next);
  }, [items, initialOutfit, closet]);
  useEffect(() => {
    if (dirtyRef.current) writeWearing(closet, wearing);
  }, [wearing, closet]);

  const fitOf = useCallback((item) => (item && fits[item.id]) || DEFAULT_FIT, [fits]);

  // 收藏、微調寫入時一律拿 localStorage 的現值當底(read-modify-write),不拿 state:同步剛寫進來、還沒重讀,
  // 或同一台開了兩個分頁時,state 可能比 localStorage 舊,直接寫回去會把別台的收藏、微調蓋掉,
  // 下一次合併就被當成「這台刪了」。寫完通知同步(5 秒後推)。
  const writeFit = useCallback((itemId, patch) => {
    const current = readFits();
    const base = current[itemId] || DEFAULT_FIT;
    const merged = { ...DEFAULT_FIT, ...base, ...(typeof patch === "function" ? patch(base) : patch) };
    const next = { ...current, [itemId]: merged };
    if (merged.dx === 0 && merged.dy === 0 && merged.scale === 1 && merged.rot === 0) delete next[itemId];
    try { localStorage.setItem(FIT_KEY, JSON.stringify(next)); } catch { /* 存不了就只在這次畫面上生效 */ }
    setFits(next);
    if (typeof window !== "undefined") window.dispatchEvent(new Event("wardrobe-local-change"));
  }, []);

  const wardrobeByType = useMemo(() => {
    const groups = {};
    for (const slot of Object.keys(SLOT_STYLE)) groups[slot] = [];
    for (const item of items) groups[item.part]?.push(item);
    for (const slot of Object.keys(groups)) groups[slot].sort((a, b) => Number(Boolean(b.wishlist)) - Number(Boolean(a.wishlist)));
    return groups;
  }, [items]);

  const wornItems = Object.values(wearing).filter(Boolean);
  const fullImage = useFullImages(wornItems);   // 人台上的用原圖(自己加的衣服清單裡是縮圖)

  /* ---------- 幾何:算出一件衣服「未旋轉縮放前」的內容框(px) ---------- */
  // 圖片以 object-fit: contain、object-position: center top 放進槽位框,
  // 這裡把 contain 的結果算出來,選取框和命中測試都以它為基準。
  const contentGeometry = useCallback((slot, item) => {
    const stage = stageRef.current;
    const nat = natSizes[item.id];
    if (!stage || !nat) return null;
    const rect = stage.getBoundingClientRect();
    const fit = fitOf(item);
    const s = SLOT_STYLE[slot];
    const boxX = (rect.width * (s.left + fit.dx)) / 100;
    const boxY = (rect.height * (s.top + fit.dy)) / 100;
    const boxW = (rect.width * s.width) / 100;
    const boxH = (rect.height * s.height) / 100;
    const ar = nat.w / nat.h;
    let cw, ch;
    if (ar > boxW / boxH) { cw = boxW; ch = boxW / ar; } else { ch = boxH; cw = boxH * ar; }
    return {
      rect,
      cx: boxX + boxW / 2,          // 內容中心 x(object-position: center)
      cy: boxY + ch / 2,            // 內容中心 y(object-position: top → 內容貼齊框頂)
      cw, ch,
      scale: fit.scale,
      rot: fit.rot || 0,
      contentTopInBox: 0,
      boxW,
    };
  }, [natSizes, fitOf]);

  /* ---------- 像素命中測試:點到哪一件? ---------- */
  const alphaAt = (item, nx, ny) => {
    // nx/ny 為 0~1 的內容座標;查原圖 alpha,快取 canvas 免得每次重畫
    let ctx = alphaCache.current.get(item.id);
    if (ctx === undefined) {
      ctx = null;
      const img = stageRef.current?.querySelector(`img[data-item="${item.id}"]`);
      if (img && img.complete && img.naturalWidth) {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const c = canvas.getContext("2d", { willReadFrequently: true });
          c.drawImage(img, 0, 0);
          c.getImageData(0, 0, 1, 1);      // 先讀一次,若跨域污染會在這裡丟例外
          ctx = c;
        } catch { ctx = null; }
      }
      alphaCache.current.set(item.id, ctx);
    }
    if (!ctx) return 255;                  // 讀不到就當不透明,退化成矩形判定
    const x = Math.round(nx * (ctx.canvas.width - 1));
    const y = Math.round(ny * (ctx.canvas.height - 1));
    if (x < 0 || y < 0 || x >= ctx.canvas.width || y >= ctx.canvas.height) return 0;
    return ctx.getImageData(x, y, 1, 1).data[3];
  };

  const hitTest = (clientX, clientY) => {
    const entries = Object.entries(wearing)
      .filter(([, item]) => item)
      .sort((a, b) => SLOT_STYLE[b[0]].z - SLOT_STYLE[a[0]].z);   // 由上層往下找
    for (const [slot, item] of entries) {
      const g = contentGeometry(slot, item);
      if (!g) continue;
      const px = clientX - g.rect.left, py = clientY - g.rect.top;
      // 逆旋轉(以內容中心為軸),再逆縮放,映回內容座標
      const rad = (-(g.rot) * Math.PI) / 180;
      const dx0 = px - g.cx, dy0 = py - g.cy;
      const rx = dx0 * Math.cos(rad) - dy0 * Math.sin(rad);
      const ry = dx0 * Math.sin(rad) + dy0 * Math.cos(rad);
      const nx = rx / (g.cw * g.scale) + 0.5;
      const ny = ry / (g.ch * g.scale) + 0.5;
      if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;
      if (alphaAt(item, nx, ny) > 12) return slot;
    }
    return null;
  };

  /* ---------- 舞台指標事件:選取 / 移動 / 縮放 / 旋轉 ---------- */
  const beginDrag = (event, mode, slot) => {
    const item = wearing[slot];
    const g = contentGeometry(slot, item);
    if (!g) return;
    const fit = fitOf(item);
    dragRef.current = {
      mode, slot, itemId: item.id,
      startX: event.clientX, startY: event.clientY,
      base: { ...fit },
      center: { x: g.rect.left + g.cx, y: g.rect.top + g.cy },
      rect: g.rect,
    };
    stageRef.current?.setPointerCapture(event.pointerId);
  };

  const onStagePointerDown = (event) => {
    if (event.target.dataset?.handle) {
      // 手把:縮放或旋轉
      if (!adjusting || !wearing[adjusting]) return;
      beginDrag(event, event.target.dataset.handle === "rotate" ? "rotate" : "scale", adjusting);
      event.preventDefault();
      return;
    }
    const hit = hitTest(event.clientX, event.clientY);
    if (hit) {
      setAdjusting(hit);
      beginDrag(event, "move", hit);
      event.preventDefault();
    } else {
      setAdjusting(null);
    }
  };

  const onStagePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.mode === "move") {
      writeFit(drag.itemId, {
        dx: drag.base.dx + ((event.clientX - drag.startX) / drag.rect.width) * 100,
        dy: drag.base.dy + ((event.clientY - drag.startY) / drag.rect.height) * 100,
      });
    } else if (drag.mode === "scale") {
      const d0 = Math.hypot(drag.startX - drag.center.x, drag.startY - drag.center.y) || 1;
      const d1 = Math.hypot(event.clientX - drag.center.x, event.clientY - drag.center.y);
      writeFit(drag.itemId, { scale: clampScale(drag.base.scale * (d1 / d0)) });
    } else if (drag.mode === "rotate") {
      const a0 = Math.atan2(drag.startY - drag.center.y, drag.startX - drag.center.x);
      const a1 = Math.atan2(event.clientY - drag.center.y, event.clientX - drag.center.x);
      let rot = (drag.base.rot || 0) + deg(a1 - a0);
      // 貼齊:接近 0/90/180/270 度時吸附,方便轉回正
      const snap = [0, 90, 180, -90, -180].find((s) => Math.abs(rot - s) < 4);
      if (snap !== undefined) rot = snap;
      writeFit(drag.itemId, { rot });
    }
  };

  const endDrag = (event) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { stageRef.current?.releasePointerCapture(event.pointerId); } catch { /* 已釋放 */ }
  };

  const onStageWheel = (event) => {
    const item = adjusting && wearing[adjusting];
    if (!item) return;
    event.preventDefault();
    writeFit(item.id, (base) => ({ scale: clampScale(base.scale + (event.deltaY < 0 ? 0.05 : -0.05)) }));
  };

  const resetFit = (item) => {
    if (!item) return;
    const next = readFits();
    delete next[item.id];
    try { localStorage.setItem(FIT_KEY, JSON.stringify(next)); } catch { /* 同上 */ }
    setFits(next);
    if (typeof window !== "undefined") window.dispatchEvent(new Event("wardrobe-local-change"));
  };

  /* ---------- 穿脫 / 隨機 / 收藏 ---------- */
  // 衣架:點一下穿上(或脫掉),點兩下看這件的資訊。第二下先把第一下的穿脫和那筆復原紀錄收回,再打開單品頁,
  // 所以點兩下不會改到身上這套。手機和滑鼠都用同一套計時(iOS 不會穩定送 dblclick)。
  const lastTapRef = useRef({ id: null, at: 0, before: null });
  const tapRackItem = (item) => {
    const now = Date.now();
    const last = lastTapRef.current;
    if (onOpenItem && last.id === item.id && now - last.at < 350) {
      lastTapRef.current = { id: null, at: 0, before: null };
      setWearing(last.before);
      setPast((stack) => stack.slice(1));
      onOpenItem(item.id);
      return;
    }
    lastTapRef.current = { id: item.id, at: now, before: wearing };
    toggleWear(item);
  };

  const toggleWear = (item) => {
    pushHistory(wearing); dirtyRef.current = true;
    setWearing((current) => {
      const removing = current[item.part]?.id === item.id;
      if (removing && adjusting === item.part) setAdjusting(null);
      return { ...current, [item.part]: removing ? null : item };
    });
  };

  // 隨機一套:有天氣(推薦過一次、或背景抓到了)就避開跟今天差太多的;還沒抓到不等,完全隨機(審查 F27)
  const randomize = () => {
    const next = randomOutfit(items, weatherRef.current);
    setAdjusting(null);
    pushHistory(wearing); dirtyRef.current = true;
    setWearing(next);
    setDaily(null);
  };

  /* ---------- 今日推薦(天氣 + 規則引擎)與穿著紀錄 ---------- */
  const [daily, setDaily] = useState(() => (initialOutfit ? initialDaily : null));   // { weather, reasons } | { error }
  const [dailyBusy, setDailyBusy] = useState(false);
  // 「已記錄」直接看穿著紀錄:身上每一件今天都記過才算。舊版是一個布林,只有今日推薦和「換成…」會清,
  // 用隨機、衣架、復原、收藏、脫掉換了衣服,按鈕還卡在「已記錄」而且按不下去,真正穿出門的那套記不進去
  // (2026-10-02 F14)。看紀錄而不是記在元件裡:重新整理、另一台記過、換頁再回來都對;隔天自然又能按。
  const [wornDates, setWornDates] = useState(readWearLog);

  // 衣櫃重讀過(別台刪掉、隱藏、改了名稱或分類):身上這套和復原紀錄逐件換成新的物件;
  // 不見了或分類改了的拿掉,免得人台穿著已經刪掉的衣服,還被寫進收藏和穿著紀錄。沒變就不動 state。
  useEffect(() => {
    // 衣服變多了(剛新增一件),舊的「還沒有下身」可能已經不成立,不要一直掛著(審查 F18)。
    // 只看件數變多:同步重讀衣櫃也會換一份新的 items,那時「抓不到天氣」這種錯還要留著給人看
    if (items.length > itemCountRef.current) setDaily((current) => (current?.error ? null : current));
    itemCountRef.current = items.length;
    const byId = new Map(items.map((item) => [item.id, item]));
    const remap = (outfit) => {
      let changed = false;
      const next = {};
      for (const [slot, item] of Object.entries(outfit || {})) {
        if (!item) continue;
        const fresh = byId.get(item.id);
        if (!fresh || fresh.part !== slot) { changed = true; continue; }
        if (fresh !== item) changed = true;
        next[slot] = fresh;
      }
      return changed ? next : outfit;
    };
    setWearing((current) => remap(current));
    // Look 卡只在卡上的衣服不見了、分類改了或換了圖才換(別的衣服改名、同步重讀衣櫃不算),不然每次同步都重新合成、閃一下;
    // 換了就連卡片上的品名一起重寫,下載的圖不會列出圖裡沒有的衣服。卡上的都沒了就關掉,不顯示「合成失敗」。
    setCard((current) => {
      if (!current) return current;
      let changed = false;
      const outfit = {};
      for (const [slot, piece] of Object.entries(current.outfit || {})) {
        if (!piece) continue;
        const fresh = byId.get(piece.id);
        if (!fresh || fresh.part !== slot) { changed = true; continue; }
        if (fresh.image !== piece.image) changed = true;
        outfit[slot] = fresh.image !== piece.image ? fresh : piece;
      }
      if (!changed) return current;
      const names = Object.values(outfit).map((piece) => piece.name).filter(Boolean);
      if (!names.length) return null;
      return { ...current, outfit, caption: { ...current.caption, items: names.join(" · ") } };
    });
    setPast((stack) => {
      const next = stack.map(remap);
      return next.every((outfit, index) => outfit === stack[index]) ? stack : next;
    });
  }, [items]);
  // 身上那格沒了:鎖和選取也跟著放掉
  useEffect(() => {
    setLocks((current) => {
      const kept = Object.fromEntries(Object.entries(current).filter(([slot]) => wearing[slot]));
      return Object.keys(kept).length === Object.keys(current).length ? current : kept;
    });
    setAdjusting((slot) => (slot && !wearing[slot] ? null : slot));
  }, [wearing]);

  // 別台的收藏、微調、穿著紀錄同步進來時,從 localStorage 重讀。舊版靠整頁重新整理,會把正在打的指令、
  // 剛推薦的理由、人台上這套一起清掉,為了擋又疊了好幾層「忙碌時延後」,每層都帶出新的時序問題(2026-10-02)。
  useEffect(() => {
    const keep = (fresh) => (current) => (JSON.stringify(current) === JSON.stringify(fresh) ? current : fresh);
    const onSynced = (event) => {
      if (!event.detail?.keysChanged) return;
      setLooks(keep(readLooks()));
      setFits(keep(readFits()));
      setWornDates(keep(readWearLog()));
    };
    window.addEventListener("wardrobe-synced", onSynced);
    return () => window.removeEventListener("wardrobe-synced", onSynced);
  }, []);
  const today = new Date().toLocaleDateString("sv");
  const recorded = wornItems.length > 0 && wornItems.every((item) => wornDates[item.id] === today);
  const weatherRef = useRef(null);               // 快取,同一次瀏覽不重抓
  // 背景先抓一次天氣:「隨機一套」要用,但不擋畫面;抓不到就算了,隨機照舊
  useEffect(() => {
    let alive = true;
    if (!weatherRef.current && initialDaily?.weather) weatherRef.current = initialDaily.weather;
    if (!weatherRef.current) fetchWeather().then((weather) => { if (alive && !weatherRef.current) weatherRef.current = weather; }).catch(() => {});
    return () => { alive = false; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // 今日推薦、「照場合挑」、「再正式一點」、「上衣留著其他重挑」全走這一條;差別只在帶進來的參數:
  //   intent      場合意圖(null=純看天氣);會記成 lastIntent 給下一句「再…一點」「再推薦一套」接著用
  //   pin         「面試要穿襯衫」:整套挑完再把指定那格釘成指定單品
  //   unknownRaw  沒學過的詞:不死路,照天氣挑一套並老實說
  //   useLocks    鎖住的槽位:把身上那件當固定,引擎圍著它配
  //   notes       要一起講給使用者聽的話(例如「已經最正式了」)
  const shownRef = useRef([]);   // 最近三次推薦各自的單品 id
  const runRecommend = async (intent = null, pin = null, unknownRaw = null, useLocks = locks, notes = []) => {
    setDailyBusy(true);
    try {
      if (!weatherRef.current) weatherRef.current = await fetchWeather();
      const weather = weatherRef.current;
      const wearLog = readWearLog();
      const locked = {};
      for (const slot of Object.keys(useLocks)) if (wearing[slot]) locked[slot] = wearing[slot];
      // 最近三次推薦出現過的往後排:「再推薦一套」才不會換來換去還是那幾件
      const avoid = new Map();
      for (const ids of shownRef.current) for (const id of ids) avoid.set(id, (avoid.get(id) || 0) + 1);
      const result = recommendOutfit(items, weather, wearLog, intent, locked, avoid, readTaste());
      if (result.error) { setDaily({ error: result.error }); return; }
      noteRecommendation(result.outfit, result.recalled);
      shownRef.current = [Object.values(result.outfit).filter(Boolean).map((item) => item.id), ...shownRef.current].slice(0, 3);
      // 眼鏡、手錶、配件現在引擎也會挑(2026-10-06);這次沒挑到的那格,身上有就留著,別每次推薦都被脫掉
      for (const slot of ["eyewear", "wrist", "belt", "necklace", "ring", "accessories_up", "carry"]) if (wearing[slot] && !result.outfit[slot]) result.outfit[slot] = wearing[slot];
      if (notes.length) result.reasons.unshift(...notes);
      const lockedLabels = Object.keys(locked).map((slot) => SLOT_LABEL[slot]);
      if (lockedLabels.length) result.reasons.push(`鎖住沒動:${lockedLabels.join("、")}`);
      if (unknownRaw) {
        result.reasons.push(`「${unknownRaw}」我還沒學過,這套是純照天氣挑的;想更準可以說場合(約會、上班、看球賽)、色系(全黑、大地色)或「換成黑色襯衫」`);
      }
      if (pin) {
        const found = findItemForSwap(items, pin, wearLog, null);
        if (found) {
          result.outfit[found.item.part] = found.item;   // 放進它自己的格子(見上面換單品)
          const asked = askedLabel(pin, SLOT_LABEL[pin.slot]);
          result.reasons.push(found.exact
            ? `照你指定換上「${found.item.name}」`
            : `你指定的${asked}櫃裡沒有,先用最接近的「${found.item.name}」`);
        }
      }
      lastIntentRef.current = intent;
      setAdjusting(null);
      pushHistory(wearing); dirtyRef.current = true;
      setWearing(result.outfit);
      setDaily({
        weather, reasons: result.reasons,
        understood: unknownRaw ? `沒學過「${unknownRaw}」,先照天氣挑` : (intent?.understood || null),
        sticky: Boolean(intent?.understood),   // 這個場合會被「再推薦一套」沿用,所以給一個 ✕ 可以清掉
      });
    } catch (cause) {
      console.warn("weather failed", cause);
      setDaily({ error: "抓不到天氣資料,檢查一下網路再試" });
    } finally {
      setDailyBusy(false);
    }
  };

  const recommendToday = () => runRecommend(null);
  const recommendAgain = () => runRecommend(lastIntentRef.current);   // 「再推薦一套」要記得上次的場合,不能弄丟
  // 換城市:天氣快取作廢;畫面上正顯示「照天氣配的」那套,就照新城市的天氣重配(不然天氣和衣服對不上)
  const cityChangeRef = useRef(null);
  cityChangeRef.current = () => {
    weatherRef.current = null;
    if (daily?.weather && !dailyBusy) recommendAgain();
  };
  useEffect(() => {
    const onCity = () => cityChangeRef.current();
    window.addEventListener("wardrobe-city-change", onCity);
    return () => window.removeEventListener("wardrobe-city-change", onCity);
  }, []);
  // 說過「面試」之後想回到純看天氣:點場合標籤的 ✕。身上這套和鎖住的都不動,只是下一套不再沿用(審查 F26)
  const clearIntent = () => {
    lastIntentRef.current = null;
    setDaily((current) => current && { ...current, understood: "場合清掉了,下一套照天氣挑", sticky: false });
  };
  const clearIntentButton = (
    <button type="button" className="studio-intent-clear" onClick={clearIntent} aria-label="清掉這個場合,下一套照天氣挑" title="清掉這個場合,下一套照天氣挑">
      <X size={12} weight="bold" aria-hidden="true" />
    </button>
  );

  const undo = () => {
    if (!past.length) { setDaily({ understood: "復原", reasons: ["沒有上一步了"] }); return; }
    const [previous, ...rest] = past;
    setPast(rest);
    dirtyRef.current = true;
    setAdjusting(null);
    setWearing(previous);
    setDaily({ understood: "復原", reasons: [`回到上一套(還可以再退 ${rest.length} 步)`] });
  };

  const toggleLock = (slot) => {
    setLocks((current) => {
      const next = { ...current };
      if (next[slot]) delete next[slot]; else next[slot] = true;
      return next;
    });
  };

  // 換掉一格、其他不動:把其他幾格當成鎖住,讓推薦引擎在這一格挑最搭的(看配色、風格、天氣、場合),身上原本那件排除
  const swapToMatch = async (slot) => {
    setDailyBusy(true);
    try {
      if (!weatherRef.current) weatherRef.current = await fetchWeather().catch(() => null);
      const weather = weatherRef.current || { temp: 25, feelsLike: 25, desc: "", rainProb: 0, tMax: 27, tMin: 22 };
      const locked = {};
      for (const key of ["upperbody", "lowerbody", "wholebody_up", "shoes", "socks", "bag"]) if (key !== slot && wearing[key]) locked[key] = wearing[key];
      const avoid = new Map(wearing[slot] ? [[wearing[slot].id, 99]] : []);
      const result = recommendOutfit(items, weather, readWearLog(), lastIntentRef.current, locked, avoid, readTaste());
      const next = result.outfit?.[slot];
      const label = SLOT_LABEL[slot];
      if (!next || next.id === wearing[slot]?.id) { setDaily({ understood: `換${label}`, reasons: [`櫃裡沒有別的${label}可以換`] }); return; }
      setAdjusting(null);
      pushHistory(wearing); dirtyRef.current = true;
      setWearing((current) => ({ ...current, [slot]: next }));
      noteRecommendation({ ...wearing, [slot]: next });
      setDaily({ understood: `換${label}`, reasons: [`換上「${next.name}」,是配著身上其他幾件挑的`] });
    } finally {
      setDailyBusy(false);
    }
  };

  // 把輸入框那句話分四路:整套(場合)/換單品/脫一件/聽不懂。換和脫只動那一格,其他衣服不動。
  // text 參數給語音用:辨識完直接送,不等 setOccasion 的非同步狀態。
  const handleRequest = (text = occasion) => {
    const req = parseRequest(text);
    if (!req) return;

    if (req.kind === "undo") { undo(); return; }

    if (req.kind === "unlock") {
      if (req.slot) setLocks((current) => { const next = { ...current }; delete next[req.slot]; return next; });
      else setLocks({});
      setDaily({ understood: req.slot ? `解鎖${SLOT_LABEL[req.slot]}` : "全部解鎖", reasons: ["之後重挑會一起換"] });
      return;
    }

    if (req.kind === "keep") {
      const label = SLOT_LABEL[req.slot];
      if (!wearing[req.slot]) { setDaily({ understood: `鎖住${label}`, reasons: [`身上沒穿${label},沒東西可以留`] }); return; }
      const nextLocks = { ...locks, [req.slot]: true };
      setLocks(nextLocks);
      if (req.reroll) { runRecommend(lastIntentRef.current, null, null, nextLocks); return; }
      setDaily({ understood: `鎖住${label}`, reasons: [`「${wearing[req.slot].name}」留著,之後重挑不會動;說「其他重挑」或按「再推薦一套」換其他的`] });
      return;
    }

    if (req.kind === "adjust") {
      const { intent, notes } = adjustIntent(lastIntentRef.current, req);
      runRecommend(intent, null, null, locks, notes);
      return;
    }

    if (req.kind === "outfit") { runRecommend(req.intent, req.pin || null); return; }

    if (req.kind === "swap") {
      const vague = !req.color && !req.category && !(req.descriptors || []).length && !req.byText;   // 「換一件上衣」→ 要跟身上那件不一樣
      // 「褲子不好看」:記下這件配身上其他幾件不好,之後推薦少推這個組合(taste.js)
      if (req.disliked && wearing[req.slot]) {
        noteDislike(wearing[req.slot].id, Object.entries(wearing).filter(([key, item]) => key !== req.slot && item).map(([, item]) => item.id));
      }
      // 只說「換一件上衣」「褲子不好看」:不是隨便抓一件,而是其他幾件都不動、配著它們和天氣挑最搭的那一件
      if (vague && ["upperbody", "lowerbody", "shoes", "bag"].includes(req.slot) && wearing.upperbody && wearing.lowerbody) {
        swapToMatch(req.slot);
        return;
      }
      const found = findItemForSwap(items, req, readWearLog(), vague && req.slot ? (wearing[req.slot]?.id || null) : null);
      // 「穿哈利波特那件」這種點名:品名、標籤裡找不到那幾個字,就當成沒學過的詞,不亂換一件
      if (req.byText && !found?.textHit) { runRecommend(null, null, req.raw); return; }
      const askedSlotLabel = SLOT_LABEL[req.slot] || "這件";
      if (!found) { setDaily({ understood: `換${askedSlotLabel}`, reasons: [`櫃裡沒有${askedSlotLabel}這一類的單品`] }); return; }
      // 找到的那件可能建檔在別格(「灰色細針織開襟外套」在上衣):放進它自己的格子,不是硬塞進講的那一格
      const slot = found.item.part;
      const label = SLOT_LABEL[slot];
      const asked = askedLabel(req, askedSlotLabel);
      setAdjusting(null);
      pushHistory(wearing); dirtyRef.current = true;
      setWearing((current) => ({ ...current, [slot]: found.item }));
      setDaily({
        understood: `換${label}${vague ? "" : `:${req.byText ? req.phrase : asked}`}`,
        reasons: [found.exact ? `換上「${found.item.name}」` : `櫃裡沒有${asked},最接近的是「${found.item.name}」,先換上這件`],
      });
      return;
    }

    if (req.kind === "remove") {
      const label = SLOT_LABEL[req.slot];
      const had = !!wearing[req.slot];
      if (adjusting === req.slot) setAdjusting(null);
      pushHistory(wearing); dirtyRef.current = true;
      setWearing((current) => ({ ...current, [req.slot]: null }));
      setDaily({ understood: `脫掉${label}`, reasons: [had ? `${label}拿掉了` : `身上本來就沒穿${label}`] });
      return;
    }

    runRecommend(null, null, req.raw);   // 聽不懂也不死路:照天氣挑一套,並老實說沒學過
  };

  /* ---------- 語音輸入(Stage 1):瀏覽器 Web Speech API,zh-TW,免 key ---------- */
  // 注意:這不是裝置端辨識 —— Chrome 送 Google、Safari 送 Apple。短指令夠用;要句中中英混講別指望它。
  // iOS Safari 雖然有 webkitSpeechRecognition,但服務常被 Apple 擋(service-not-allowed),網頁端修不動;
  // iPhone 上可靠的語音是「鍵盤內建聽寫」(也支援中英夾雜),所以 iOS 改成引導使用者用鍵盤麥克風。
  const isIOS = typeof navigator !== "undefined"
    && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  const SpeechAPI = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => () => { try { recognitionRef.current?.abort(); } catch { /* 已停 */ } }, []);

  // iPhone:不硬跑必失敗的 Web Speech,改把游標帶進輸入框並教使用者用鍵盤的麥克風聽寫
  const promptKeyboardDictation = () => {
    inputRef.current?.focus();
    setDaily({ understood: "用講的", reasons: ["iPhone 網頁語音常被 Apple 擋,改用鍵盤「右下角」的 🎤 聽寫(左下角 🌐 是換語言);中英夾著講都行,講完按「照這句挑」。沒反應就到 設定>一般>鍵盤 開「啟用聽寫」"] });
  };

  const toggleListening = () => {
    if (!SpeechAPI) return;
    if (recognitionRef.current) { recognitionRef.current.stop(); return; }   // 再按一次 = 停
    const rec = new SpeechAPI();
    rec.lang = "zh-TW";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript?.trim();
      if (!text) return;
      setOccasion(text);           // 留在框裡,讓你看到它聽成什麼
      handleRequest(text);         // 講完直接跑,不用再按
    };
    rec.onerror = (event) => {
      // 被拒時「再按一次」是錯方向(再按也不會跳權限),要引導去瀏覽器的權限設定
      const [msg, how] = event.error === "not-allowed"
        ? ["瀏覽器擋了麥克風", "到網址列的權限圖示把麥克風設成允許,再試一次"]
        : event.error === "no-speech"
          ? ["沒聽到聲音", "靠近一點,再按一次麥克風"]
          : event.error === "service-not-allowed"
            ? ["這個瀏覽器不給用語音", "改用打字,或用系統鍵盤的 🎤 聽寫"]
            : ["語音辨識出錯", `(${event.error})可以改用打字`];
      setDaily({ understood: msg, reasons: [how] });
    };
    rec.onend = () => { recognitionRef.current = null; setListening(false); };
    recognitionRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { recognitionRef.current = null; setListening(false); }
  };

  /* ---------- 紀錄備份/還原:整台瀏覽器的衣櫃紀錄打包成 JSON,PC↔iPhone 搬或防 iOS 清資料 ---------- */
  const backupFileRef = useRef(null);
  const [backupMsg, setBackupMsg] = useState("");
  const exportBackup = async () => {
    try {
      const count = await downloadBackupZip();
      setBackupMsg(count ? `已匯出 ZIP:${count} 件衣服的去背圖(PNG)和紀錄,在你的下載` : "已匯出 ZIP(紀錄;還沒有自己加的衣服,所以沒有圖)");
    }
    catch { setBackupMsg("匯出失敗,再試一次"); }
  };
  // 加密匯出:兩次密碼,至少 8 個字(2026-10-06 資安盤點)
  const [lockOpen, setLockOpen] = useState(false);
  const [lockPass, setLockPass] = useState(["", ""]);
  const exportLocked = async (event) => {
    event.preventDefault();
    const [first, second] = lockPass;
    if (first.length < 8) { setBackupMsg("密碼至少 8 個字"); return; }
    if (first !== second) { setBackupMsg("兩次密碼不一樣"); return; }
    setBackupMsg("加密中…");
    try {
      const count = await downloadBackupZip({ password: first });
      setBackupMsg(`已匯出加密備份(${count} 件衣服的圖和紀錄),在你的下載。要用的時候按「匯入備份」選它、輸入這組密碼;密碼忘了就打不開。`);
      setLockPass(["", ""]);
      setLockOpen(false);
    } catch { setBackupMsg("匯出失敗,再試一次"); }
  };
  const importBackup = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const message = await importBackupFile(file, Boolean(syncCode()));
    if (message) setBackupMsg(message);
  };

  // 推薦準不準(taste.js):有按過「今天穿這套」才顯示,同步拉到別台的紀錄時一起更新
  const [stats, setStats] = useState(() => recoStats());
  useEffect(() => {
    const refresh = () => setStats(recoStats());
    window.addEventListener("wardrobe-synced", refresh);
    return () => window.removeEventListener("wardrobe-synced", refresh);
  }, []);

  // 按了「今天穿這套」可以取消(審查 F29):記之前每件的日期留著,取消時換回去。只留到換一套或離開這頁
  const [wearUndo, setWearUndo] = useState(null);   // { ids: "a|b|c", before: { id: 日期|null }, note: taste 那筆的 id }
  const wornKey = wornItems.map((item) => item.id).sort().join("|");
  const canUndoWear = Boolean(wearUndo && wearUndo.ids === wornKey);
  const wearToday = () => {
    if (!wornItems.length) return;
    if (recorded && canUndoWear) {   // 過了午夜、或別台改過日期,就不是「剛記的那一下」,照常記
      setWornDates(unrecordWear(wearUndo.before));
      unnoteWear(wearUndo.note);
      setWearUndo(null);
      setStats(recoStats());
      return;
    }
    const note = noteWear(wearing);   // 先記「照不照推薦穿」:recordWear 會通知同步,兩份一起推
    const { log, before } = recordWear(wornItems);
    setWornDates(log);
    setWearUndo({ ids: wornKey, before, note });
    setStats(recoStats());
  };

  // 收藏:同一套(同樣幾件)不重複存,按完要看得出存了(審查 F54)
  const sameIds = (a, b) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
  const savedAlready = wornItems.length > 0 && looks.some((look) => sameIds(look.itemIds, wornItems.map((item) => item.id)));
  const saveLook = () => {
    if (!wornItems.length) return;
    const current = readLooks();
    if (current.some((look) => sameIds(look.itemIds, wornItems.map((item) => item.id)))) { setLooks(current); return; }
    const look = { id: `look-${Date.now()}`, itemIds: wornItems.map((item) => item.id), savedAt: new Date().toISOString() };
    const next = [look, ...current].slice(0, 30);
    setLooks(next);
    localStorage.setItem(LOOKS_KEY, JSON.stringify(next));
    if (typeof window !== "undefined") window.dispatchEvent(new Event("wardrobe-local-change"));
  };

  const wearLook = (look) => {
    const next = {};
    for (const id of look.itemIds) {
      const item = items.find((existing) => existing.id === id);
      if (item) next[item.part] = item;
    }
    setAdjusting(null);
    pushHistory(wearing); dirtyRef.current = true;
    setWearing(next);
  };

  // 刪收藏不問,但留 6 秒可以復原(審查 F13:垃圾桶緊貼「做成卡片」,點一下就刪、救不回來)。比 confirm 不打斷操作
  const [lookUndo, setLookUndo] = useState(null);   // { look, index }
  const lookUndoTimer = useRef(null);
  useEffect(() => () => clearTimeout(lookUndoTimer.current), []);
  const deleteLook = (id) => {
    const current = readLooks();
    const index = current.findIndex((look) => look.id === id);
    if (index < 0) return;
    const next = current.filter((look) => look.id !== id);
    setLooks(next);
    localStorage.setItem(LOOKS_KEY, JSON.stringify(next));
    if (typeof window !== "undefined") window.dispatchEvent(new Event("wardrobe-local-change"));
    setLookUndo({ look: current[index], index });
    clearTimeout(lookUndoTimer.current);
    lookUndoTimer.current = setTimeout(() => setLookUndo(null), 6000);
  };
  const restoreLook = () => {
    if (!lookUndo) return;
    const current = readLooks();
    if (!current.some((look) => look.id === lookUndo.look.id)) {
      const next = [...current];
      next.splice(Math.min(lookUndo.index, next.length), 0, lookUndo.look);
      setLooks(next.slice(0, 30));
      localStorage.setItem(LOOKS_KEY, JSON.stringify(next.slice(0, 30)));
      if (typeof window !== "undefined") window.dispatchEvent(new Event("wardrobe-local-change"));
    }
    clearTimeout(lookUndoTimer.current);
    setLookUndo(null);
  };

  /* ---------- 選取框(在調整中的那件外圍) ---------- */
  const frame = (() => {
    const item = adjusting && wearing[adjusting];
    if (!item) return null;
    const g = contentGeometry(adjusting, item);
    if (!g) return null;
    const w = g.cw * g.scale, h = g.ch * g.scale;
    return {
      left: g.cx - w / 2, top: g.cy - h / 2, width: w, height: h, rot: g.rot,
      changed: !!fits[item.id],
    };
  })();

  // 貼底列上方那一行:今日推薦講聽懂了什麼;指令(復原、換、鎖)沒有天氣,講結果,失敗的原因才看得到
  const dockStatus = !daily ? ""
    : daily.error ? daily.error
    : daily.weather ? (daily.sticky ? `聽你說的 ${daily.understood}` : daily.understood || "")
    : [daily.understood, daily.reasons?.[0]].filter(Boolean).join(",");

  // 主鈕和「今天穿這套」:桌機照舊分在第一層和第三層;手機搬進貼底的列(下面 studio-dock)
  const recommendButton = (
    <button type="button" className="studio-recommend" onClick={daily && !daily.error ? recommendAgain : recommendToday} disabled={dailyBusy}>
      <Sparkle size={16} weight="regular" aria-hidden="true" /> {dailyBusy ? "推薦中…" : daily && !daily.error ? "再推薦一套" : "今日推薦"}
    </button>
  );
  const wearTodayButton = (
    <button
      type="button"
      className={`studio-wear-today${recorded ? " done" : ""}`}
      onClick={wearToday}
      disabled={!wornItems.length || (recorded && !canUndoWear)}
      aria-label={recorded && canUndoWear ? "已記錄今天穿這套;按一下取消" : undefined}
    >
      <CalendarCheck size={15} weight="regular" aria-hidden="true" />{" "}
      {!recorded ? "今天穿這套" : canUndoWear ? (phone ? "已記錄 · 取消" : "已記錄,近幾天不再推薦 · 取消") : (phone ? "已記錄" : "已記錄,近幾天不再推薦")}
    </button>
  );

  return (
    <div className="studio">
      <div className="studio-stage-column">
        <div
          ref={stageRef}
          className={`studio-stage${adjusting ? " is-adjusting" : ""}`}
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={onStageWheel}
        >
          <Silhouette />
          {Object.entries(wearing).map(([slot, item]) => {
            if (!item || slot === "socks") return null;   // 襪子不畫在人形上(浮在短褲和鞋中間很假),改用下面一行字
            const s = SLOT_STYLE[slot];
            const fit = fitOf(item);
            const nat = natSizes[item.id];
            // 旋轉/縮放的軸心 = 內容中心。內容貼齊框頂置中,所以軸心在 (框寬/2, 內容高/2)。
            let origin;
            if (nat && stageRef.current) {
              const rect = stageRef.current.getBoundingClientRect();
              const boxW = (rect.width * s.width) / 100, boxH = (rect.height * s.height) / 100;
              const ar = nat.w / nat.h;
              const ch = ar > boxW / boxH ? boxW / ar : boxH;
              origin = `50% ${ch / 2}px`;
            }
            const isActive = adjusting === slot;
            return (
              <img
                key={slot}
                data-item={item.id}
                className={`studio-garment${isActive ? " is-adjusting" : ""}${adjusting && !isActive ? " is-dimmed" : ""}`}
                src={fullImage(item)}
                alt={item.name || SLOT_LABEL[slot]}
                draggable={false}
                crossOrigin="anonymous"
                onLoad={(event) => {
                  const { naturalWidth: w, naturalHeight: h } = event.currentTarget;
                  setNatSizes((current) => (current[item.id]?.w === w ? current : { ...current, [item.id]: { w, h } }));
                }}
                style={{
                  left: `${s.left + fit.dx}%`,
                  top: `${s.top + fit.dy}%`,
                  width: `${s.width}%`,
                  height: `${s.height}%`,
                  zIndex: isActive ? 90 : s.z,
                  transform: fit.scale !== 1 || fit.rot ? `rotate(${fit.rot || 0}deg) scale(${fit.scale})` : undefined,
                  transformOrigin: origin,
                }}
              />
            );
          })}

          {frame && (
            <div
              className="studio-frame"
              style={{
                left: frame.left, top: frame.top, width: frame.width, height: frame.height,
                transform: frame.rot ? `rotate(${frame.rot}deg)` : undefined,
              }}
            >
              <span className="studio-frame-handle nw" data-handle="scale" />
              <span className="studio-frame-handle ne" data-handle="scale" />
              <span className="studio-frame-handle sw" data-handle="scale" />
              <span className="studio-frame-handle se" data-handle="scale" />
              <span className="studio-frame-rotate" data-handle="rotate" />
              <span className="studio-frame-stem" aria-hidden="true" />
            </div>
          )}

          {/* 空人台的提示掛在框外緣下方(舊版疊在框底,剛好壓在雙腿上);不佔版面,下面的今日推薦不會被推出第一屏。
              方向跟著排版:單欄時衣架在下面 */}
          {!wornItems.length && <p className="studio-hint">{stacked ? "從下面點衣服穿上去" : "從右邊點衣服穿上去"}</p>}
        </div>
        {wearing.socks && <p className="studio-socks-note">襪子:{wearing.socks.name}</p>}

        {adjusting && wearing[adjusting] && (
          <div className="studio-fit-tools">
            <span className="studio-fit-hint">
              {SLOT_LABEL[adjusting]}:框內拖曳移動,拉角落縮放,拉頂端圓點旋轉
            </span>
            <button type="button" className="studio-fit-reset" onClick={() => resetFit(wearing[adjusting])}>
              重設這件
            </button>
            <button type="button" className="studio-fit-lock" onClick={() => toggleLock(adjusting)} aria-pressed={!!locks[adjusting]}>
              {locks[adjusting]
                ? <><LockOpen size={13} weight="regular" aria-hidden="true" /> 解鎖這件</>
                : <><Lock size={13} weight="regular" aria-hidden="true" /> 鎖住這件</>}
            </button>
          </div>
        )}

        {Object.keys(locks).some((slot) => wearing[slot]) && (
          <div className="studio-locks" role="status">
            <Lock size={12} weight="fill" aria-hidden="true" />
            <span>重挑時不動:</span>
            {Object.keys(locks).filter((slot) => wearing[slot]).map((slot) => (
              <button type="button" key={slot} onClick={() => toggleLock(slot)} aria-label={`解鎖${SLOT_LABEL[slot]}`} title="點一下解鎖">
                {SLOT_LABEL[slot]} <X size={11} weight="bold" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}

        <form className="studio-occasion" onSubmit={(event) => { event.preventDefault(); handleRequest(); }}>
          <input
            ref={inputRef}
            type="text"
            value={occasion}
            onChange={(event) => setOccasion(event.target.value)}
            onFocus={focusOccasion}
            onBlur={blurOccasion}
            placeholder="說個場合,或要換哪一件"
            aria-label="輸入場合或指定要換的單品"
          />
          {(SpeechAPI || isIOS) && (
            <button
              type="button"
              className={`studio-mic${listening ? " listening" : ""}`}
              onClick={isIOS ? promptKeyboardDictation : toggleListening}
              disabled={dailyBusy}
              aria-pressed={listening}
              aria-label={isIOS ? "用鍵盤的麥克風聽寫" : listening ? "停止聆聽" : "用說的"}
              title={isIOS ? "iPhone:用鍵盤的麥克風聽寫" : listening ? "聆聽中,再按一次停止" : "用說的(語音會送到瀏覽器的辨識服務轉成文字)"}
            >
              <Microphone size={15} weight={listening ? "fill" : "regular"} aria-hidden="true" />
            </button>
          )}
          <button type="submit" disabled={dailyBusy || !occasion.trim()}>
            <Sparkle size={14} weight="regular" aria-hidden="true" /> 照這句挑
          </button>
        </form>
        {/* 例句放在框下面、點了就照著做。舊版全塞在 placeholder,被截斷,「上一步」從來看不到(審查 F51) */}
        <p className="studio-examples">
          <span>例如</span>
          {["約會", "全黑", "帥一點", "換成黑色襯衫", "褲子不好看", "上衣留著其他重挑", "上一步"].map((example) => (
            <button key={example} type="button" disabled={dailyBusy} onClick={() => { setOccasion(example); handleRequest(example); }}>
              {example}
            </button>
          ))}
        </p>
        {listening && (
          <p className="studio-mic-note" role="status">聆聽中… 語音會傳到瀏覽器的辨識服務(Chrome→Google、Safari→Apple)轉成文字</p>
        )}

        {daily && (
          <div className="studio-daily" role="status">
            {daily.error ? (
              <p className="studio-daily-error">{daily.error}</p>
            ) : (
              <>
                {daily.understood && (
                  <p className="studio-daily-understood">
                    {(daily.sticky || !daily.weather) && <span className="studio-daily-label">聽你說的</span>}{daily.understood}
                    {daily.sticky && clearIntentButton}
                  </p>
                )}
                {daily.weather && (
                  <p className="studio-daily-weather">
                    <CitySelect /> {daily.weather.temp}°(體感 {daily.weather.feelsLike}°)· {daily.weather.desc} · 降雨 {daily.weather.rainProb}%
                  </p>
                )}
                {(() => {
                  // 一句一行才讀得下去(舊版全用「·」串成一坨,手機上七行擠在一起);
                  // 「看到的線索」是透明化細節,獨立成一條較淡的小字,不跟主要理由搶。
                  const clue = daily.reasons.find((reason) => reason.startsWith("看到的線索"));
                  const main = daily.reasons.filter((reason) => reason !== clue);
                  return (
                    <>
                      {!!main.length && (
                        <ul className="studio-daily-reasons">
                          {main.map((reason, index) => <li key={index}>{reason}</li>)}
                        </ul>
                      )}
                      {clue && <p className="studio-daily-clue">{clue}</p>}
                    </>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {/* 動作分三層,只有「今日推薦」是 accent 實心:一眼看到主要下一步。
            手機上第一層和「今天穿這套」不在這裡,在最下面的貼底列。 */}
        <div className="studio-actions">
          {!phone && <div className="studio-actions-primary">{recommendButton}</div>}
          <div className="studio-actions-modify" role="group" aria-label="調整這套">
            <button type="button" onClick={randomize}>
              <ArrowsClockwise size={15} weight="regular" aria-hidden="true" /> 隨機一套
            </button>
            <button type="button" onClick={undo} disabled={!past.length} title="退回上一套(也可以說「上一步」)">
              <ArrowCounterClockwise size={15} weight="regular" aria-hidden="true" /> 復原
            </button>
            <button type="button" onClick={() => { pushHistory(wearing); dirtyRef.current = true; setWearing({}); setLocks({}); setAdjusting(null); setDaily(null); }} disabled={!wornItems.length}>
              <X size={15} weight="regular" aria-hidden="true" /> 脫掉
            </button>
          </div>
          <div className="studio-actions-finalize" role="group" aria-label="定案這套">
            <button type="button" className="studio-save" onClick={saveLook} disabled={!wornItems.length || savedAlready}>
              <FloppyDisk size={15} weight={savedAlready ? "fill" : "regular"} aria-hidden="true" /> {savedAlready ? "已收藏" : "收藏這套"}
            </button>
            <button type="button" onClick={() => openCard(wearing, { understood: daily?.understood, weather: daily?.weather })} disabled={!wornItems.length} title="做成一張可分享的圖(不上傳)">
              <Export size={15} weight="regular" aria-hidden="true" /> 匯出這套
            </button>
            {!phone && wearTodayButton}
          </div>
        </div>

        {(!!looks.length || lookUndo) && (
          <div className="studio-looks">
            <h3>收藏的穿搭</h3>
            {lookUndo && (
              <p className="studio-look-undo" role="status">
                刪掉了一套收藏。<button type="button" onClick={restoreLook}>復原</button>
              </p>
            )}
            <ul>
              {looks.map((look) => {
                const names = look.itemIds
                  .map((id) => items.find((item) => item.id === id)?.name)
                  .filter(Boolean);
                if (!names.length) return null;
                return (
                  <li key={look.id}>
                    <button type="button" className="studio-look-load" onClick={() => wearLook(look)}>
                      {names.join(" + ")}
                    </button>
                    <button
                      type="button"
                      className="studio-look-card"
                      aria-label="把這套做成卡片"
                      title="做成一張可分享的圖"
                      onClick={() => {
                        const map = {};
                        for (const id of look.itemIds) { const item = items.find((existing) => existing.id === id); if (item) map[item.part] = item; }
                        openCard(map, { title: "收藏的穿搭" });
                      }}
                    >
                      <ImageSquare size={14} weight="regular" aria-hidden="true" />
                    </button>
                    <button type="button" className="studio-look-delete" onClick={() => deleteLook(look.id)} aria-label="刪除這套穿搭" title="刪除(6 秒內可以復原)">
                      <Trash size={15} weight="regular" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {stats && (
          <p className="studio-stats">
            <span className="studio-backup-label">推薦準不準</span>
            近 30 天記了 {stats.days} 天:照推薦穿 {stats.fromRec} 天{stats.fromRec > 0 && `,其中 ${stats.first} 天是第一套就穿,平均看到第 ${stats.avgMatch.toFixed(1).replace(/\.0$/, "")} 套`}
            {stats.days > stats.fromRec && `;其他 ${stats.days - stats.fromRec} 天是自己換過或隨機配的`}。
            推薦會記得你穿過、收藏過的組合,說「褲子不好看」的組合會少推。
          </p>
        )}
        {/* 紀錄備份:資料 local-first,換裝置或防 iOS 清 storage 前先匯出,到新裝置匯入。全程本機。 */}
        <div className="studio-backup">
          <div className="studio-backup-controls">
            <span className="studio-backup-label">紀錄備份</span>
            <button type="button" onClick={exportBackup}>匯出備份</button>
            <button type="button" onClick={() => setLockOpen((on) => !on)} aria-expanded={lockOpen}>加密匯出</button>
            <button type="button" onClick={() => backupFileRef.current?.click()}>匯入備份</button>
            <input ref={backupFileRef} type="file" accept="application/zip,.zip,application/json,.json" onChange={importBackup} hidden />
          </div>
          {lockOpen && (
            <form className="studio-backup-lock" onSubmit={exportLocked}>
              <label>
                <span>設一組密碼(至少 8 個字)</span>
                <input type="password" autoComplete="new-password" value={lockPass[0]} onChange={(event) => setLockPass([event.target.value, lockPass[1]])} />
              </label>
              <label>
                <span>再輸入一次</span>
                <input type="password" autoComplete="new-password" value={lockPass[1]} onChange={(event) => setLockPass([lockPass[0], event.target.value])} />
              </label>
              <button type="submit">匯出加密備份</button>
              <small>加密的備份解開只看得到一份說明,圖和紀錄都要回這裡輸入密碼才打得開。密碼忘了就打不開,誰都救不回來。</small>
            </form>
          )}
          {backupMsg && <p className="studio-backup-msg" role="status">{backupMsg}</p>}
          <p className="studio-backup-note">備份是一個 ZIP,存在你自己手上、不經過雲端:解開有每件自己加的衣服的去背圖(PNG),和穿著紀錄、收藏、微調。換裝置或清資料前先「匯出」,到新裝置「匯入」這個 ZIP。同步碼不會寫進備份檔。</p>
        </div>
      </div>

      <aside className="studio-rack">
        <nav className="studio-rack-nav" aria-label="依類型挑衣服">
          {/* 沒有衣服的分類不列(正在看的那類除外):分類多了,一整排 0 只是擋路 */}
          {Object.entries(SLOT_LABEL).filter(([slot]) => wardrobeByType[slot]?.length || stripType === slot).map(([slot, label]) => (
            <button
              key={slot}
              type="button"
              className={stripType === slot ? "active" : ""}
              aria-pressed={stripType === slot}
              onClick={() => setStripType(slot)}
            >
              {label}
              <small>{wardrobeByType[slot]?.length || 0}</small>
            </button>
          ))}
        </nav>
        {onOpenItem && <p className="studio-rack-hint">點一下穿上,點兩下看資訊</p>}
        <div className="studio-rack-grid">
          {(wardrobeByType[stripType] || []).map((item) => (
            <button
              key={item.id}
              type="button"
              className={`studio-rack-item${wearing[item.part]?.id === item.id ? " wearing" : ""}`}
              aria-pressed={wearing[item.part]?.id === item.id}
              aria-label={`${item.name || SLOT_LABEL[item.part]}${item.wishlist ? "(還沒買)" : ""}`}
              onClick={() => tapRackItem(item)}
              title={`${item.wishlist ? `${item.name}(還沒買)` : item.name}${onOpenItem ? "\n點兩下看資訊" : ""}`}
            >
              <img src={item.thumbnail || item.image} alt={item.name || SLOT_LABEL[item.part]} loading="lazy" />
              {item.wishlist && <span className="wish-badge">想買</span>}
            </button>
          ))}
          {!(wardrobeByType[stripType] || []).length && (
            <p className="studio-rack-empty">這一類還沒有單品</p>
          )}
        </div>
      </aside>

      {/* 手機:貼在畫面底部的列。舊版這兩顆在人台下面一屏多,每換一套要捲下去按、再捲上來看(F23)。
          放在 .studio 最後,sticky 才能從人台一路貼到衣架;打字時收起來,不跟 iOS 鍵盤搶位置。 */}
      {phone && (
        <div className={`studio-dock${typing ? " is-tucked" : ""}`} role="group" aria-label="推薦和記錄這套">
          {/* 推薦的回饋(天氣抓不到、聽懂了什麼、復原或換衣服沒做到的原因)原本在指令框下面,手機上剛好被這一列蓋住,
              按了像沒反應。推薦中照樣留著上一句,免得列高跳動。螢幕閱讀器念上面那份(.studio-daily),這裡藏起來不重念。 */}
          {daily?.sticky ? (
            <p className="studio-dock-status has-clear">{dockStatus}{clearIntentButton}</p>
          ) : dockStatus && <p className={`studio-dock-status${daily?.error ? " is-error" : ""}`} aria-hidden="true">{dockStatus}</p>}
          {recommendButton}
          {wearTodayButton}
        </div>
      )}

      {card && (
        <LookCard
          outfit={card.outfit}
          caption={card.caption}
          fits={fits}
          slotStyle={SLOT_STYLE}
          onClose={closeCard}
        />
      )}
    </div>
  );
}
