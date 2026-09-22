// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, ArrowsClockwise, CalendarCheck, Export, FloppyDisk, ImageSquare, Lock, LockOpen, Microphone, Sparkle, Trash, X } from "@phosphor-icons/react";
import { adjustIntent, fetchWeather, findItemForSwap, parseRequest, readWearLog, recommendOutfit, recordWear } from "./recommend.js";
import { LookCard } from "./LookCard.jsx";

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
const SLOT_STYLE = {
  socks:          { left: 35, top: 70,   width: 30, height: 12,   z: 2 },
  // 鞋子是俯拍的一雙(長寬比 0.6~0.88,偏高),不是側視圖。原本又寬又扁的框會把
  // 高筒鞋壓成 44px 寬的一條(旁邊短褲 144px)。改成窄而高,寬度才回得到 70~101px。
  // 襪子跟著上移,維持「襪子在鞋子上方、不重疊」。
  shoes:          { left: 36, top: 82,   width: 28, height: 18,   z: 3 },
  lowerbody:      { left: 31, top: 51,   width: 38, height: 44,   z: 4 },
  upperbody:      { left: 25, top: 16,   width: 50, height: 36,   z: 5 },
  wholebody_up:   { left: 22, top: 14.5, width: 56, height: 42,   z: 6 },
  // 包的長寬比從 0.84(後背包)到 1.40(半月斜背包)都有。框開 38% 寬時全部都會
  // 撐到 144px = 跟寬褲一樣寬,像揹了個行李箱。收到 26% 後一律渲染 98px 寬,
  // 約寬褲的七成,才像掛在右腰的包。
  bag:            { left: 54, top: 46,   width: 26, height: 19,   z: 7 },
  eyewear:        { left: 38, top: 3.5,  width: 24, height: 8,    z: 8 },
  wrist:          { left: 23, top: 41,   width: 15, height: 8,    z: 8 },
  accessories_up: { left: 62, top: 1,    width: 30, height: 15,   z: 8 },
};

const SLOT_LABEL = {
  upperbody: "上衣", wholebody_up: "外套", lowerbody: "下身",
  socks: "襪子", shoes: "鞋子", bag: "包款",
  eyewear: "眼鏡", wrist: "手錶手環", accessories_up: "其他配件",
};

const CORE_SLOTS = new Set(["upperbody", "lowerbody", "shoes"]);

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

const clampScale = (value) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));
const deg = (rad) => (rad * 180) / Math.PI;

function Silhouette() {
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

export function OutfitStudio({ items, initialOutfit = null }) {
  const [wearing, setWearing] = useState({});
  const [looks, setLooks] = useState(readLooks);
  const [stripType, setStripType] = useState("upperbody");
  const [occasion, setOccasion] = useState("");           // 「說個場合」輸入框
  const [locks, setLocks] = useState({});                 // 槽位→true:重挑時那格不動
  const [past, setPast] = useState([]);                   // 復原用:最近幾套 wearing
  const lastIntentRef = useRef(null);                     // 上一次整套推薦的場合,給「再正式一點」「再推薦一套」接著用
  const dirtyRef = useRef(false);                         // 使用者真的動過穿搭才寫 localStorage,免得還原前先被空狀態蓋掉
  const pushHistory = (current) => setPast((stack) => [current, ...stack].slice(0, HISTORY_MAX));
  const [card, setCard] = useState(null);                 // Look 卡面板:{ outfit, caption } | null

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
        subtitle: weather ? `台中 ${weather.temp}° · ${weather.desc} · 降雨 ${weather.rainProb}%` : "",
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
    if (initialOutfit) { setWearing(initialOutfit); setAdjusting(null); }
  }, [initialOutfit]);

  // 記住身上這套:進頁面先從 localStorage 還原(入口頁帶進來的優先),之後只要使用者動過就存。
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !items.length) return;
    restoredRef.current = true;
    if (initialOutfit) return;
    try {
      const saved = JSON.parse(localStorage.getItem(WEARING_KEY) || "{}");
      const next = {};
      for (const [slot, id] of Object.entries(saved)) {
        const item = items.find((existing) => existing.id === id);
        if (item && item.part === slot) next[slot] = item;
      }
      if (Object.keys(next).length) setWearing(next);
    } catch { /* 壞掉就當沒存 */ }
  }, [items, initialOutfit]);
  useEffect(() => {
    if (!dirtyRef.current) return;
    try {
      const ids = Object.fromEntries(Object.entries(wearing).filter(([, item]) => item).map(([slot, item]) => [slot, item.id]));
      localStorage.setItem(WEARING_KEY, JSON.stringify(ids));
    } catch { /* 私密模式等存不了就算了 */ }
  }, [wearing]);

  const fitOf = useCallback((item) => (item && fits[item.id]) || DEFAULT_FIT, [fits]);

  const writeFit = useCallback((itemId, patch) => {
    setFits((current) => {
      const base = current[itemId] || DEFAULT_FIT;
      const merged = { ...DEFAULT_FIT, ...base, ...(typeof patch === "function" ? patch(base) : patch) };
      const next = { ...current, [itemId]: merged };
      if (merged.dx === 0 && merged.dy === 0 && merged.scale === 1 && merged.rot === 0) delete next[itemId];
      localStorage.setItem(FIT_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const wardrobeByType = useMemo(() => {
    const groups = {};
    for (const slot of Object.keys(SLOT_STYLE)) groups[slot] = [];
    for (const item of items) groups[item.part]?.push(item);
    return groups;
  }, [items]);

  const wornItems = Object.values(wearing).filter(Boolean);

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
    setFits((current) => {
      const next = { ...current };
      delete next[item.id];
      localStorage.setItem(FIT_KEY, JSON.stringify(next));
      return next;
    });
  };

  /* ---------- 穿脫 / 隨機 / 收藏 ---------- */
  const toggleWear = (item) => {
    pushHistory(wearing); dirtyRef.current = true;
    setWearing((current) => {
      const removing = current[item.part]?.id === item.id;
      if (removing && adjusting === item.part) setAdjusting(null);
      return { ...current, [item.part]: removing ? null : item };
    });
  };

  const randomize = () => {
    const next = {};
    for (const [slot, group] of Object.entries(wardrobeByType)) {
      if (!group.length) continue;
      if (!CORE_SLOTS.has(slot) && Math.random() < 0.55) continue;
      next[slot] = group[Math.floor(Math.random() * group.length)];
    }
    setAdjusting(null);
    pushHistory(wearing); dirtyRef.current = true;
    setWearing(next);
    setDaily(null);
  };

  /* ---------- 今日推薦(天氣 + 規則引擎)與穿著紀錄 ---------- */
  const [daily, setDaily] = useState(null);      // { weather, reasons } | { error }
  const [dailyBusy, setDailyBusy] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const weatherRef = useRef(null);               // 快取,同一次瀏覽不重抓

  // 今日推薦、「照場合挑」、「再正式一點」、「上衣留著其他重挑」全走這一條;差別只在帶進來的參數:
  //   intent      場合意圖(null=純看天氣);會記成 lastIntent 給下一句「再…一點」「再推薦一套」接著用
  //   pin         「面試要穿襯衫」:整套挑完再把指定那格釘成指定單品
  //   unknownRaw  沒學過的詞:不死路,照天氣挑一套並老實說
  //   useLocks    鎖住的槽位:把身上那件當固定,引擎圍著它配
  //   notes       要一起講給使用者聽的話(例如「已經最正式了」)
  const runRecommend = async (intent = null, pin = null, unknownRaw = null, useLocks = locks, notes = []) => {
    setDailyBusy(true);
    setRecorded(false);
    try {
      if (!weatherRef.current) weatherRef.current = await fetchWeather();
      const weather = weatherRef.current;
      const wearLog = readWearLog();
      const locked = {};
      for (const slot of Object.keys(useLocks)) if (wearing[slot]) locked[slot] = wearing[slot];
      const result = recommendOutfit(items, weather, wearLog, intent, locked);
      if (result.error) { setDaily({ error: result.error }); return; }
      // 引擎不管眼鏡/手錶/配件,身上有就留著,別每次推薦都被脫掉
      for (const slot of ["eyewear", "wrist", "accessories_up"]) if (wearing[slot]) result.outfit[slot] = wearing[slot];
      if (notes.length) result.reasons.unshift(...notes);
      const lockedLabels = Object.keys(locked).map((slot) => SLOT_LABEL[slot]);
      if (lockedLabels.length) result.reasons.push(`鎖住沒動:${lockedLabels.join("、")}`);
      if (unknownRaw) {
        result.reasons.push(`「${unknownRaw}」我還沒學過,這套是純照天氣挑的;想更準可以說場合(上班、約會、運動、下雨天上課)或「換成黑色襯衫」`);
      }
      if (pin) {
        const found = findItemForSwap(items, pin, wearLog, null);
        if (found) {
          result.outfit[pin.slot] = found.item;
          const asked = `${pin.color?.word ? `${pin.color.word}色` : ""}${pin.category || SLOT_LABEL[pin.slot]}`;
          result.reasons.push(found.exact
            ? `照你指定換上「${found.item.name}」`
            : `你指定的${asked}櫃裡沒有,先用最接近的「${found.item.name}」`);
        }
      }
      lastIntentRef.current = intent;
      setAdjusting(null);
      pushHistory(wearing); dirtyRef.current = true;
      setWearing(result.outfit);
      setDaily({ weather, reasons: result.reasons, understood: unknownRaw ? `沒學過「${unknownRaw}」,先照天氣挑` : (intent?.understood || null) });
    } catch (cause) {
      console.warn("weather failed", cause);
      setDaily({ error: "抓不到天氣資料,檢查一下網路再試" });
    } finally {
      setDailyBusy(false);
    }
  };

  const recommendToday = () => runRecommend(null);
  const recommendAgain = () => runRecommend(lastIntentRef.current);   // 「再推薦一套」要記得上次的場合,不能弄丟

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
      const label = SLOT_LABEL[req.slot];
      const vague = !req.color && !req.category;                       // 「換一件上衣」→ 要跟身上那件不一樣
      const found = findItemForSwap(items, req, readWearLog(), vague ? (wearing[req.slot]?.id || null) : null);
      if (!found) { setDaily({ understood: `換${label}`, reasons: [`櫃裡沒有${label}這一類的單品`] }); return; }
      const asked = `${req.color?.word ? `${req.color.word}色` : ""}${req.category || label}`;
      setAdjusting(null);
      setRecorded(false);
      pushHistory(wearing); dirtyRef.current = true;
      setWearing((current) => ({ ...current, [req.slot]: found.item }));
      setDaily({
        understood: `換${label}${vague ? "" : `:${asked}`}`,
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

  const wearToday = () => {
    if (!wornItems.length) return;
    recordWear(wornItems);
    setRecorded(true);
  };

  const saveLook = () => {
    if (!wornItems.length) return;
    const look = { id: `look-${Date.now()}`, itemIds: wornItems.map((item) => item.id), savedAt: new Date().toISOString() };
    const next = [look, ...looks].slice(0, 30);
    setLooks(next);
    localStorage.setItem(LOOKS_KEY, JSON.stringify(next));
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

  const deleteLook = (id) => {
    const next = looks.filter((look) => look.id !== id);
    setLooks(next);
    localStorage.setItem(LOOKS_KEY, JSON.stringify(next));
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
                src={item.image}
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

          {!wornItems.length && <p className="studio-hint">從右邊點衣服穿上去</p>}
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
            placeholder="「約會」「換成黑色襯衫」「再正式一點」「上衣留著其他重挑」「上一步」"
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
                    <span className="studio-daily-label">聽你說的</span>{daily.understood}
                  </p>
                )}
                {daily.weather && (
                  <p className="studio-daily-weather">
                    台中 {daily.weather.temp}°(體感 {daily.weather.feelsLike}°)· {daily.weather.desc} · 降雨 {daily.weather.rainProb}%
                  </p>
                )}
                <p className="studio-daily-reasons">{daily.reasons.join(" · ")}</p>
              </>
            )}
          </div>
        )}

        {/* 動作分三層,只有「今日推薦」是 accent 實心:一眼看到主要下一步 */}
        <div className="studio-actions">
          <div className="studio-actions-primary">
            <button type="button" className="studio-recommend" onClick={daily && !daily.error ? recommendAgain : recommendToday} disabled={dailyBusy}>
              <Sparkle size={16} weight="regular" aria-hidden="true" /> {dailyBusy ? "推薦中…" : daily && !daily.error ? "再推薦一套" : "今日推薦"}
            </button>
          </div>
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
            <button type="button" className="studio-save" onClick={saveLook} disabled={!wornItems.length}>
              <FloppyDisk size={15} weight="regular" aria-hidden="true" /> 收藏這套
            </button>
            <button type="button" onClick={() => openCard(wearing, { understood: daily?.understood, weather: daily?.weather })} disabled={!wornItems.length} title="做成一張可分享的圖(不上傳)">
              <Export size={15} weight="regular" aria-hidden="true" /> 匯出這套
            </button>
            <button type="button" className={`studio-wear-today${recorded ? " done" : ""}`} onClick={wearToday} disabled={!wornItems.length || recorded}>
              <CalendarCheck size={15} weight="regular" aria-hidden="true" /> {recorded ? "已記錄,近幾天不再推薦" : "今天穿這套"}
            </button>
          </div>
        </div>

        {!!looks.length && (
          <div className="studio-looks">
            <h3>收藏的穿搭</h3>
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
                    <button type="button" className="studio-look-delete" onClick={() => deleteLook(look.id)} aria-label="刪除這套穿搭">
                      <Trash size={13} weight="regular" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <aside className="studio-rack">
        <nav className="studio-rack-nav" aria-label="依類型挑衣服">
          {Object.entries(SLOT_LABEL).map(([slot, label]) => (
            <button
              key={slot}
              type="button"
              className={stripType === slot ? "active" : ""}
              onClick={() => setStripType(slot)}
            >
              {label}
              <small>{wardrobeByType[slot]?.length || 0}</small>
            </button>
          ))}
        </nav>
        <div className="studio-rack-grid">
          {(wardrobeByType[stripType] || []).map((item) => (
            <button
              key={item.id}
              type="button"
              className={`studio-rack-item${wearing[item.part]?.id === item.id ? " wearing" : ""}`}
              onClick={() => toggleWear(item)}
              title={item.name}
            >
              <img src={item.thumbnail || item.image} alt={item.name || SLOT_LABEL[item.part]} loading="lazy" />
            </button>
          ))}
          {!(wardrobeByType[stripType] || []).length && (
            <p className="studio-rack-empty">這一類還沒有單品</p>
          )}
        </div>
      </aside>

      {card && (
        <LookCard
          outfit={card.outfit}
          caption={card.caption}
          fits={fits}
          slotStyle={SLOT_STYLE}
          onClose={() => setCard(null)}
        />
      )}
    </div>
  );
}
