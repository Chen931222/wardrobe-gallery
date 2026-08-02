import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowsClockwise, CalendarCheck, FloppyDisk, Sparkle, Trash, X } from "@phosphor-icons/react";
import { fetchWeather, readWearLog, recommendOutfit, recordWear } from "./recommend.js";

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
    setWearing(next);
    setDaily(null);
  };

  /* ---------- 今日推薦(天氣 + 規則引擎)與穿著紀錄 ---------- */
  const [daily, setDaily] = useState(null);      // { weather, reasons } | { error }
  const [dailyBusy, setDailyBusy] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const weatherRef = useRef(null);               // 快取,同一次瀏覽不重抓

  const recommendToday = async () => {
    setDailyBusy(true);
    setRecorded(false);
    try {
      if (!weatherRef.current) weatherRef.current = await fetchWeather();
      const weather = weatherRef.current;
      const result = recommendOutfit(items, weather, readWearLog());
      if (result.error) { setDaily({ error: result.error }); return; }
      setAdjusting(null);
      setWearing(result.outfit);
      setDaily({ weather, reasons: result.reasons });
    } catch (cause) {
      console.warn("weather failed", cause);
      setDaily({ error: "抓不到天氣資料,檢查一下網路再試" });
    } finally {
      setDailyBusy(false);
    }
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
            if (!item) return null;
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

        {adjusting && wearing[adjusting] && (
          <div className="studio-fit-tools">
            <span className="studio-fit-hint">
              {SLOT_LABEL[adjusting]}:框內拖曳移動,拉角落縮放,拉頂端圓點旋轉
            </span>
            <button type="button" className="studio-fit-reset" onClick={() => resetFit(wearing[adjusting])}>
              重設這件
            </button>
          </div>
        )}

        {daily && (
          <div className="studio-daily" role="status">
            {daily.error ? (
              <p className="studio-daily-error">{daily.error}</p>
            ) : (
              <>
                <p className="studio-daily-weather">
                  台中 {daily.weather.temp}°(體感 {daily.weather.feelsLike}°)· {daily.weather.desc} · 降雨 {daily.weather.rainProb}%
                </p>
                <p className="studio-daily-reasons">{daily.reasons.join(" · ")}</p>
              </>
            )}
          </div>
        )}

        <div className="studio-actions">
          <button type="button" className="studio-recommend" onClick={recommendToday} disabled={dailyBusy}>
            <Sparkle size={15} weight="regular" aria-hidden="true" /> {dailyBusy ? "推薦中…" : daily && !daily.error ? "再推薦一套" : "今日推薦"}
          </button>
          <button type="button" onClick={randomize}>
            <ArrowsClockwise size={15} weight="regular" aria-hidden="true" /> 隨機一套
          </button>
          <button type="button" onClick={() => { setWearing({}); setAdjusting(null); setDaily(null); }} disabled={!wornItems.length}>
            <X size={15} weight="regular" aria-hidden="true" /> 脫掉
          </button>
          <button type="button" className="studio-save" onClick={saveLook} disabled={!wornItems.length}>
            <FloppyDisk size={15} weight="regular" aria-hidden="true" /> 收藏這套
          </button>
          <button type="button" className={`studio-wear-today${recorded ? " done" : ""}`} onClick={wearToday} disabled={!wornItems.length || recorded}>
            <CalendarCheck size={15} weight="regular" aria-hidden="true" /> {recorded ? "已記錄,近幾天不再推薦" : "今天穿這套"}
          </button>
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
            <p className="studio-rack-empty">這一類還沒有衣服,快去補貨</p>
          )}
        </div>
      </aside>
    </div>
  );
}
