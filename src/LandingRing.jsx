import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkle, X } from "@phosphor-icons/react";
import { fetchWeather, readWearLog, recommendOutfit } from "./recommend.js";

// 入口導覽頁 v2(2026-07-21 依使用者回饋改版):
//   - 拿掉滾輪/拖曳/自轉 —— 沒有 rAF 迴圈,平常是純靜態排版,零效能負擔
//   - 圓環間距加大:卡片寬 = 圓周 ÷ (n×1.28),保證相鄰不重疊
//   - 點任何一件 → 聚焦模式(抄 store.elevenlabs.io 的 zoomed-circle):
//       圓心移到畫面左緣外、半徑放大,被點的那件轉到「三點鐘方向」並放大 2.5 倍,
//       其他件沿左側大弧排開;右下出現資訊卡
//   - 點聚焦中的衣服或資訊卡 → 開完整詳情(ItemViewer);點空白處 → 退回圓環
//   所有移動都是一次性 CSS transition(900ms),不是持續動畫。
const PICK = 12;
const SLOT_LABEL = { upperbody: "上衣", wholebody_up: "外套", lowerbody: "下身", socks: "襪子", shoes: "鞋子", bag: "包款", eyewear: "眼鏡", wrist: "手錶手環", accessories_up: "配件" };

// 每類單品的「基準寬度」,以上衣攤平肩寬為 1.0(現實約 55cm)。
// 只定義寬度 —— 高度交給照片本身的長寬比推算,所以長褲自然比短褲長、
// 一雙襪子自然是扁的小塊,不會再出現襪子跟帽T一樣大的狀況。
const WIDTH_FACTOR = {
  wholebody_up: 1.08,   // 外套比上衣再寬一點
  upperbody: 1.0,
  lowerbody: 0.74,      // 褲頭寬約 40cm
  shoes: 0.5,
  socks: 0.36,
  bag: 0.55,
  eyewear: 0.3,
  wrist: 0.26,
  accessories_up: 0.45,
};
const FOCUS_ZOOM = 4.6;

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// 依部位分層抽:每個有貨的部位先保底一件,剩下名額再隨機補。
// 純隨機抽的話,上衣佔全櫃四成、鞋襪各只有幾件,圓環常常變成「12 件 T 恤」,
// 而導覽頁的重點正是一眼看出衣櫃有些什麼。
function pickVaried(items, count) {
  const byPart = new Map();
  for (const item of items) {
    if (!byPart.has(item.part)) byPart.set(item.part, []);
    byPart.get(item.part).push(item);
  }
  const seeded = [], rest = [];
  for (const group of byPart.values()) {
    const bag = shuffle(group);
    seeded.push(bag[0]);
    rest.push(...bag.slice(1));
  }
  const picked = shuffle(seeded).slice(0, count);
  if (picked.length < count) picked.push(...shuffle(rest).slice(0, count - picked.length));
  return shuffle(picked);
}

export function LandingRing({ items, onOpen, onEnter, onWearOutfit }) {
  const picked = useMemo(() => pickVaried(items, PICK), [items]);
  const stageRef = useRef(null);
  const [dims, setDims] = useState(null);
  const [focusIdx, setFocusIdx] = useState(null);
  const [ringOffset, setRingOffset] = useState(0);   // 圓環模式的旋轉格數(整數,順時針為正)
  const [natSizes, setNatSizes] = useState({});      // itemId → {w,h} 照片原始尺寸

  // 每件的相對顯示框(base=1):寬取自類別基準,高由照片長寬比推得
  const boxes = useMemo(() => picked.map((item) => {
    const nat = natSizes[item.id];
    const ar = nat ? nat.w / nat.h : 1;
    const w = WIDTH_FACTOR[item.part] ?? 0.8;
    return { w, h: w / ar };
  }), [picked, natSizes]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setDims({ w: stage.clientWidth, h: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const n = picked.length;

  // 圓環中央的今日推薦:掛載後背景抓天氣,不擋圓環渲染;失敗就顯示提示不影響其他功能
  const [daily, setDaily] = useState(null);
  useEffect(() => {
    if (!items.length) return undefined;
    let alive = true;
    (async () => {
      try {
        const weather = await fetchWeather();
        const result = recommendOutfit(items, weather, readWearLog());
        if (alive) setDaily(result.error ? { error: result.error } : { weather, ...result });
      } catch {
        if (alive) setDaily({ error: "抓不到天氣" });
      }
    })();
    return () => { alive = false; };
  }, [items]);

  // 聚焦模式的瀏覽:滾輪/方向鍵/上下滑一次跳一件(不是自由旋轉,所以不需要動畫迴圈,
  // 只是換 focusIdx,位移交給 CSS transition)。往下滾 = 順時針。
  const focusRef = useRef(null);
  useEffect(() => { focusRef.current = focusIdx; }, [focusIdx]);

  const step = useRef({ acc: 0, lockUntil: 0, swipeY: null });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    // 兩種模式都是「一格一格跳」:聚焦模式換聚焦的那件,圓環模式整圈轉一格。
    // 因為只是改一個整數再交給 CSS transition,所以全程沒有動畫迴圈。
    const advance = (dir) => {
      const now = performance.now();
      if (now < step.current.lockUntil) return;
      step.current.lockUntil = now + 300;
      step.current.acc = 0;
      if (focusRef.current === null) setRingOffset((current) => current + dir);
      else setFocusIdx((current) => (current + dir + n) % n);
    };

    const onWheel = (event) => {
      event.preventDefault();
      step.current.acc += event.deltaY;
      if (Math.abs(step.current.acc) >= 60) advance(step.current.acc > 0 ? 1 : -1);
    };

    const onKeyDown = (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); advance(1); }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); advance(-1); }
      if (event.key === "Escape") setFocusIdx(null);
    };

    const onTouchStart = (event) => { step.current.swipeY = event.touches[0]?.clientY ?? null; };
    const onTouchMove = (event) => {
      if (step.current.swipeY === null) return;
      const dy = step.current.swipeY - (event.touches[0]?.clientY ?? 0);
      if (Math.abs(dy) >= 44) { advance(dy > 0 ? 1 : -1); step.current.swipeY = event.touches[0].clientY; }
    };

    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("touchstart", onTouchStart, { passive: true });
    stage.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("touchstart", onTouchStart);
      stage.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [n]);

  // 統一縮放係數 k:全部單品乘同一個 k,相對大小才忠於現實。
  // 取法是「在不重疊前提下能放多大就多大」—— 用保守公式(最長邊塞進弦長)會被
  // 一件長褲拖累到全部變小,改用二分搜尋直接找臨界值,同樣的圈能塞下更大的衣服。
  // 圓環會旋轉,每個旋轉位置的鄰居方位不同,所以要檢查全部 n 種旋轉的最壞情況。
  const metrics = useMemo(() => {
    if (!dims) return null;
    const { w, h } = dims;
    const mobile = w < 800;
    const ringR = mobile ? w * 0.32 : Math.min(w * 0.168, h * 0.295);
    const GAP = 6;                                            // 卡與卡之間至少留白(px)

    const clashes = (k) => {
      for (let off = 0; off < n; off++) {
        const rects = boxes.map((b, i) => {
          const a = ((i - off) / n) * Math.PI * 2 + Math.PI / 2;
          const cw = b.w * k, ch = b.h * k;
          return { x: Math.cos(a) * ringR - cw / 2, y: -Math.sin(a) * ringR - ch / 2, w: cw, h: ch };
        });
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const p = rects[i], q = rects[j];
            if (p.x < q.x + q.w + GAP && p.x + p.w + GAP > q.x
              && p.y < q.y + q.h + GAP && p.y + p.h + GAP > q.y) return true;
          }
        }
      }
      return false;
    };

    let lo = 1, hi = Math.max(ringR, 1);                       // k 的搜尋範圍
    for (let step = 0; step < 22; step++) {
      const mid = (lo + hi) / 2;
      if (clashes(mid)) hi = mid; else lo = mid;
    }
    return { mobile, ringR, k: lo };
  }, [dims, boxes, n]);

  // 依模式算每張卡的位置與大小(純函式,一次算完交給 CSS transition 去飛)
  const layout = (index) => {
    if (!dims || !metrics) return null;
    const { w, h } = dims;
    const { mobile, ringR, k } = metrics;
    const box = boxes[index];
    const cardW = box.w * k, cardH = box.h * k;

    if (focusIdx === null) {
      // 減去 ringOffset:角度變小 = 螢幕座標上順時針(y 軸向下,所以 sin 前面是負號)
      const a = ((index - ringOffset) / n) * Math.PI * 2 + Math.PI / 2;
      return {
        x: w * 0.5 + Math.cos(a) * ringR,
        y: h * (mobile ? 0.46 : 0.5) - Math.sin(a) * ringR,
        cardW, cardH, scale: 1,
        z: Math.round(10 + 5 * Math.cos(a)),
      };
    }

    // 聚焦模式:圓心移到左緣外側,被點的在三點鐘方向(θ=0)
    const r = mobile ? w * 0.78 : w * 0.414;
    const cx = mobile ? -w * 0.30 : -w * 0.014;
    const cy = h * (mobile ? 0.40 : 0.5);
    const a = ((index - focusIdx) / n) * Math.PI * 2;
    const focused = index === focusIdx;
    // 放大倍率全體一致(FOCUS_ZOOM),只有塞不下畫面時才收斂 —— 這樣長褲仍舊比帽T長
    const fBox = boxes[focusIdx];
    const focusLimit = Math.min(h * 0.66, mobile ? w * 0.86 : w * 0.34);
    const zoom = Math.min(FOCUS_ZOOM, focusLimit / (Math.max(fBox.w, fBox.h) * k));
    return {
      x: cx + Math.cos(a) * r,
      y: cy - Math.sin(a) * r,
      cardW, cardH,
      scale: focused ? zoom : 1,
      z: focused ? 18 : Math.round(10 + 5 * Math.cos(a)),
    };
  };

  const focusedItem = focusIdx !== null ? picked[focusIdx] : null;

  const onCardClick = (index, item) => {
    if (focusIdx === index) onOpen(item.id);       // 已聚焦 → 開詳情
    else setFocusIdx(index);                        // 其他 → 聚焦它
  };

  const onStageClick = (event) => {
    if (event.target === stageRef.current) setFocusIdx(null);   // 點空白退回圓環
  };

  return (
    <section className="landing" aria-label="衣櫃入口導覽">
      <header className="landing-top">
        <h1>我的衣櫃</h1>
        <nav>
          <button type="button" onClick={() => onEnter("closet")}>衣櫃</button>
          <button type="button" onClick={() => onEnter("styling")}>搭配</button>
        </nav>
      </header>

      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div ref={stageRef} className="landing-stage" onClick={onStageClick}>
        {/* 圓環中央的今日推薦(聚焦模式時整圈會移開,所以這裡也一起收掉) */}
        {focusIdx === null && metrics && dims && (
          <div
            className="landing-daily"
            style={{
              left: `${dims.w * 0.5}px`,
              top: `${dims.h * (metrics.mobile ? 0.46 : 0.5)}px`,
              width: `${metrics.ringR * 1.12}px`,
            }}
          >
            {!daily && <p className="landing-daily-loading">讀取今天的天氣…</p>}
            {daily?.error && <p className="landing-daily-loading">{daily.error}</p>}
            {daily?.outfit && (
              <>
                <p className="landing-daily-weather">
                  台中 {daily.weather.temp}° · 體感 {daily.weather.feelsLike}° · 降雨 {daily.weather.rainProb}%
                </p>
                <h2>今日推薦</h2>
                <ul className="landing-daily-list">
                  {Object.entries(daily.outfit).map(([slot, item]) => (
                    <li key={slot}>
                      <span>{SLOT_LABEL[slot]}</span>{item.name}
                    </li>
                  ))}
                </ul>
                <button type="button" className="landing-daily-go" onClick={() => onWearOutfit(daily.outfit)}>
                  <Sparkle size={14} weight="regular" aria-hidden="true" /> 穿這套
                </button>
              </>
            )}
          </div>
        )}
        {dims && picked.map((item, index) => {
          const g = layout(index);
          return (
            <button
              key={item.id}
              type="button"
              className={`landing-card${focusIdx === index ? " is-focused" : ""}`}
              onClick={() => onCardClick(index, item)}
              aria-label={focusIdx === index ? `開啟${item.name}的詳細資訊` : `聚焦${item.name}`}
              title={item.name}
              style={{
                width: `${g.cardW}px`,
                height: `${g.cardH}px`,
                transform: `translate(${g.x - g.cardW / 2}px, ${g.y - g.cardH / 2}px) scale(${g.scale})`,
                zIndex: g.z,
              }}
            >
              <img
                src={item.thumbnail || item.image}
                alt=""
                draggable={false}
                onLoad={(event) => {
                  const { naturalWidth: nw, naturalHeight: nh } = event.currentTarget;
                  event.currentTarget.classList.add("loaded");
                  setNatSizes((current) => (current[item.id] ? current : { ...current, [item.id]: { w: nw, h: nh } }));
                }}
              />
            </button>
          );
        })}
      </div>

      {focusedItem && (
        <aside className="landing-info" aria-label="聚焦單品資訊">
          <button type="button" className="landing-info-close" onClick={() => setFocusIdx(null)} aria-label="退回圓環">
            <X size={16} weight="regular" aria-hidden="true" />
          </button>
          <p className="landing-info-part">{SLOT_LABEL[focusedItem.part] || "單品"}</p>
          <h2>{focusedItem.name}</h2>
          {!!(focusedItem.tags || []).length && (
            <p className="landing-info-tags">{focusedItem.tags.slice(0, 4).join(" · ")}</p>
          )}
          <button type="button" className="landing-info-open" onClick={() => onOpen(focusedItem.id)}>
            查看細節
          </button>
        </aside>
      )}

      <p className="landing-hint">
        {focusIdx === null ? "滾輪轉動 · 點一件聚焦" : "滾輪瀏覽下一件 · 再點一下看細節 · 點空白處返回"}
      </p>
    </section>
  );
}
