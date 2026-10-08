// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkle, X } from "@phosphor-icons/react";
import { fetchWeather, readWearLog, recommendOutfit } from "./recommend.js";
import { CitySelect, useCity } from "./CitySelect.jsx";
import { readTaste } from "./taste.js";

// 入口導覽頁 v2(2026-07-21 依使用者回饋改版):
//   - 拿掉滾輪/拖曳/自轉 —— 沒有 rAF 迴圈,平常是純靜態排版,零效能負擔
//   - 圓環間距加大:卡片寬 = 圓周 ÷ (n×1.28),保證相鄰不重疊
//   - 點任何一件 → 聚焦模式(抄 store.elevenlabs.io 的 zoomed-circle):
//       圓心移到畫面左緣外、半徑放大,被點的那件轉到「三點鐘方向」並放大 2.5 倍,
//       其他件沿左側大弧排開;右下出現資訊卡
//   - 點聚焦中的衣服或資訊卡 → 開完整詳情(ItemViewer);點空白處 → 退回圓環
//   所有移動都是一次性 CSS transition(900ms),不是持續動畫。
const PICK = 12;
const SLOT_LABEL = { upperbody: "上衣", wholebody_up: "外套", lowerbody: "下身", socks: "襪子", shoes: "鞋子", bag: "包款", eyewear: "眼鏡", wrist: "手錶手環", belt: "皮帶", necklace: "項鍊", ring: "戒指", accessories_up: "配件", carry: "小物" };

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
  belt: 0.62,           // 對折起來約 35cm
  necklace: 0.32,
  ring: 0.12,
  carry: 0.22,          // 鋼筆約 14cm
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

/** 衣服只有幾件時不排圓環:1–3 件排成一圈,大圖會頂到畫面上緣、被導覽蓋住(審查 F36)。改成置中一排。 */
const ROW_MAX = 3;

/**
 * @param onWearOutfit (那一套, { weather, reasons }):今日推薦的理由跟著帶進搭配頁
 * @param onAdd        推薦不了(缺上衣或下身)時給一顆「去新增」;沒給就不顯示
 * @param syncAlert    同步有狀況(停掉、上次失敗):「同步」旁亮一個點
 */
export function LandingRing({ items, onOpen, onEnter, onWearOutfit, onSync = null, onAdd = null, syncAlert = false, onUpdates = null, updatesUnseen = false, title = "我的衣櫃", note = null }) {
  // 手機(<640)重排:少放幾件圓環卡才夠大可點,今日推薦從環心移到環下方長條,不再壓卡片
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia("(max-width: 640px)");
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  // 提示文案看輸入方式,不看寬度:iPad 也是觸控,沒有滾輪(審查 F45)。用 hover: none 而不是 pointer: coarse,
  // 因為 iPad 接了觸控板就能 hover、也真的會送滾輪事件,那時講滾輪才對
  const [touch, setTouch] = useState(() => typeof window !== "undefined" && window.matchMedia("(hover: none)").matches);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia("(hover: none)");
    const on = () => setTouch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  // 只在衣服清單(id)真的變了才重抽;同步重讀衣櫃會產生新物件,不能因此把使用者正在看的圓環整圈重洗。
  // 抽到的 id 每次 render 換回最新的物件,改名、改圖才跟得上。
  // 清單變了(別台新增、隱藏)時,上一輪抽到、現在還在的那幾件留在原位,只補缺的;不然整圈換掉,正在看的那件也被收掉。
  const idsKey = items.map((item) => item.id).join("|");
  const prevPickedRef = useRef([]);
  const pickedIds = useMemo(() => {
    const count = phone ? 8 : PICK;
    const present = new Set(items.map((item) => item.id));
    const kept = prevPickedRef.current.filter((id) => present.has(id)).slice(0, count);
    if (kept.length >= count) return kept;
    const keptSet = new Set(kept);
    const fill = pickVaried(items.filter((item) => !keptSet.has(item.id)), count - kept.length).map((item) => item.id);
    return [...kept, ...fill];
  }, [idsKey, phone]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { prevPickedRef.current = pickedIds; }, [pickedIds]);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const picked = useMemo(() => pickedIds.map((id) => byId.get(id)).filter(Boolean), [byId, pickedIds]);
  const stageRef = useRef(null);
  const [dims, setDims] = useState(null);
  const [focusState, setFocusIdx] = useState(null);
  // 衣服變少(刪掉聚焦的最後一張)時,這次 render 的位置可能已經超出圓環;當下就夾成「沒聚焦」,
  // 不能等下面的 effect 修正:那之前這次 render 就會讀到不存在的那張,整個 App 白屏
  const focusIdx = focusState !== null && focusState < picked.length ? focusState : null;
  // 聚焦記的是位置;衣服清單變了重抽之後,同一個位置會是另一件。記住聚焦的是哪一件,重抽後還在就跟過去,不在就退回圓環
  const focusIdRef = useRef(null);
  useEffect(() => { focusIdRef.current = focusIdx !== null ? pickedIds[focusIdx] ?? null : null; }, [focusIdx]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = focusIdRef.current;
    if (id === null) return;
    const index = pickedIds.indexOf(id);
    setFocusIdx(index >= 0 ? index : null);
  }, [pickedIds]);
  const [ringOffset, setRingOffset] = useState(0);   // 圓環模式的旋轉格數(整數,順時針為正)
  const [natSizes, setNatSizes] = useState({});      // itemId → {w,h} 照片原始尺寸

  // 每件的相對顯示框(base=1):寬取自類別基準,高由照片長寬比推得
  const boxes = useMemo(() => picked.map((item) => {
    const nat = natSizes[item.id];
    const ar = nat ? nat.w / nat.h : 1;
    const w = WIDTH_FACTOR[item.part] ?? 0.8;
    return { w, h: w / ar };
  }), [picked, natSizes]);

  // 標題列的高度:訪客多了一段說明和「建立我的衣櫃」按鈕,標題列變高,圓環 12 點那件會被蓋住(審查 F37 提醒過)。
  // 量出來,圓環的上緣讓開它
  const topRef = useRef(null);
  const [topH, setTopH] = useState(0);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      setDims({ w: stage.clientWidth, h: stage.clientHeight });
      setTopH(topRef.current ? topRef.current.offsetHeight : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    if (topRef.current) observer.observe(topRef.current);
    return () => observer.disconnect();
  }, []);

  const n = picked.length;

  // 圓環中央的今日推薦:掛載後背景抓天氣,不擋圓環渲染;失敗就顯示提示不影響其他功能
  const [daily, setDaily] = useState(null);
  const city = useCity();
  useEffect(() => {
    if (!items.length) return undefined;
    let alive = true;
    (async () => {
      try {
        const weather = await fetchWeather();
        const result = recommendOutfit(items, weather, readWearLog(), null, {}, null, readTaste());
        if (alive) setDaily(result.error ? { error: result.error, missing: result.missing } : { weather, ...result });
      } catch {
        if (alive) setDaily({ error: "抓不到天氣" });
      }
    })();
    return () => { alive = false; };
  }, [idsKey, city.key]);   // eslint-disable-line react-hooks/exhaustive-deps -- 同上:清單沒變就不重抽,使用者正要按「穿這套」;換城市是自己按的,才重配

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
      // 輸入框裡的方向鍵是移動游標;對話框開著時背後的圓環不跟著轉(審查 F21:同步碼、單品名稱欄不能移動游標)
      const target = event.target;
      if (target instanceof Element && (target.closest("input, textarea, select, [contenteditable], [aria-modal='true']"))) return;
      if (document.querySelector("[aria-modal='true']")) return;
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
    // 直向平板(iPad 810×1080)也有 800 寬,但套桌機公式圓環只剩 314px、最小的卡 14px(審查 F44);
    // 要橫的才算寬,直向走平板公式(跟 iPad mini 744 一樣)
    const wide = w >= 800 && w > h * 1.05;
    // 手機:環往上收、半徑小一點,把畫面下半讓給今日推薦長條;平板(640–800)與桌機維持原本
    let ringR = wide ? Math.min(w * 0.168, h * 0.295) : phone ? Math.min(w * 0.36, h * 0.26) : w * 0.32;
    let cy = h * (wide ? 0.5 : phone ? 0.34 : 0.46);
    const tallest = Math.max(...boxes.map((b) => b.h), 0.01);
    const topClear = topH + 8;                                 // 卡片上緣至少要在標題列下面
    if (n <= ROW_MAX) {
      // 一排:總寬不超過畫面 70%、最高的一件不超過畫面 30%(手機 24%),每件之間留 1/4 件寬
      const totalW = boxes.reduce((sum, b) => sum + b.w, 0) * 1.25;
      const k = Math.max(1, Math.min((w * 0.7) / totalW, (h * (phone ? 0.24 : 0.3)) / tallest, 260));
      const rowY = Math.max(h * (phone ? 0.3 : 0.32), topClear + (tallest * k) / 2);
      return { wide, ringR, k, cy: rowY, row: true };
    }
    const GAP = 6;                                            // 卡與卡之間至少留白(px)

    const clashes = (R, k) => {
      for (let off = 0; off < n; off++) {
        const rects = boxes.map((b, i) => {
          const a = ((i - off) / n) * Math.PI * 2 + Math.PI / 2;
          const cw = b.w * k, ch = b.h * k;
          return { x: Math.cos(a) * R - cw / 2, y: -Math.sin(a) * R - ch / 2, w: cw, h: ch };
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
    const fit = (R) => {
      let lo = 1, hi = Math.max(R, 1);                         // k 的搜尋範圍
      for (let step = 0; step < 22; step++) {
        const mid = (lo + hi) / 2;
        if (clashes(R, mid)) hi = mid; else lo = mid;
      }
      return lo;
    };

    let k = fit(ringR);
    // 最高的那件轉到 12 點時會頂到標題列:圓心往下、半徑縮小同樣的量,下緣不動(手機下面是今日推薦長條),
    // 上緣讓出標題列。最多縮到原本的六成,再小就寧可蓋一點
    const overlap = topClear - (cy - ringR - (tallest * k) / 2);
    if (overlap > 0) {
      const shrink = Math.min(overlap / 2, ringR * 0.4);
      cy += shrink;
      ringR -= shrink;
      k = fit(ringR);
    }
    return { wide, ringR, k, cy, row: false };
  }, [dims, boxes, n, phone, topH]);

  // 依模式算每張卡的位置與大小(純函式,一次算完交給 CSS transition 去飛)
  const layout = (index) => {
    if (!dims || !metrics) return null;
    const { w, h } = dims;
    const { wide, ringR, k } = metrics;
    const box = boxes[index];
    const cardW = box.w * k, cardH = box.h * k;

    if (focusIdx === null && metrics.row) {
      // 一排:由左到右照順序,整排置中;放在畫面上方三成的地方,下面留給今日推薦
      const gap = 0.25;
      const widths = boxes.map((b) => b.w * k);
      const total = widths.reduce((sum, value) => sum + value, 0) + gap * k * Math.max(0, n - 1) * 0.8;
      let left = w * 0.5 - total / 2;
      for (let i = 0; i < index; i += 1) left += widths[i] + gap * k * 0.8;
      return { x: left + cardW / 2, y: metrics.cy, cardW, cardH, scale: 1, z: 10 };
    }
    if (focusIdx === null) {
      // 減去 ringOffset:角度變小 = 螢幕座標上順時針(y 軸向下,所以 sin 前面是負號)
      const a = ((index - ringOffset) / n) * Math.PI * 2 + Math.PI / 2;
      return {
        x: w * 0.5 + Math.cos(a) * ringR,
        y: metrics.cy - Math.sin(a) * ringR,   // 手機把環往上收,下半留給推薦長條;標題列太高時往下讓
        cardW, cardH, scale: 1,
        z: Math.round(10 + 5 * Math.cos(a)),
      };
    }

    // 聚焦模式:圓心移到左緣外側,被點的在三點鐘方向(θ=0)。<800 都走原本的手機弧線
    const r = !wide ? w * 0.78 : w * 0.414;
    const cx = !wide ? -w * 0.30 : -w * 0.014;
    const cy = h * (!wide ? 0.40 : 0.5);
    const a = ((index - focusIdx) / n) * Math.PI * 2;
    const focused = index === focusIdx;
    // 放大倍率全體一致(FOCUS_ZOOM),只有塞不下畫面時才收斂 —— 這樣長褲仍舊比帽T長
    const fBox = boxes[focusIdx];
    const focusLimit = Math.min(h * 0.66, !wide ? w * 0.86 : w * 0.34);
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
  // 今日推薦算出來那一刻的物件可能已經舊了(別台改名、換圖):顯示和「穿這套」都換成最新的,不見了或分類改了就拿掉
  const freshDaily = daily?.outfit
    ? Object.fromEntries(Object.entries(daily.outfit)
      .map(([slot, piece]) => [slot, piece && byId.get(piece.id)])
      .filter(([slot, piece]) => piece && piece.part === slot))
    : null;
  const dailyOutfit = freshDaily && Object.keys(freshDaily).length ? freshDaily : null;   // 全部拿掉了就不顯示空的「穿這套」

  // 「穿上看看」:理由和天氣一起帶進搭配頁,進去看得到為什麼是這套,主按鈕也接著是「再推薦一套」(審查 F25)。
  // 名字不叫「穿這套」:搭配頁有一顆「今天穿這套」會記穿著紀錄,這顆不會(F56)
  const wearDaily = () => onWearOutfit(dailyOutfit, { weather: daily.weather, reasons: daily.reasons || [] });

  const onCardClick = (index, item) => {
    if (focusIdx === index) onOpen(item.id);       // 已聚焦 → 開詳情
    else setFocusIdx(index);                        // 其他 → 聚焦它
  };

  const onStageClick = (event) => {
    if (event.target === stageRef.current) setFocusIdx(null);   // 點空白退回圓環
  };

  return (
    <section className="landing" aria-label="衣櫃入口導覽">
      <header className="landing-top" ref={topRef}>
        <div className="landing-title">
          <h1>{title}</h1>
          {note && <p className="landing-note">{note}</p>}
        </div>
        <nav>
          <button type="button" onClick={() => onEnter("closet")}>衣櫃</button>
          <button type="button" onClick={() => onEnter("styling")}>搭配</button>
          {onSync && (
            <button type="button" onClick={onSync} className={syncAlert ? "has-alert" : undefined} aria-label={syncAlert ? "同步(有狀況,打開看)" : undefined}>
              同步{syncAlert && <span className="sync-dot" aria-hidden="true" />}
            </button>
          )}
          {/* 更新公告(2026-10-08):有還沒看過的,旁邊亮一個小點 */}
          {onUpdates && (
            <button type="button" onClick={onUpdates} aria-label={updatesUnseen ? "更新(有新的)" : undefined}>
              更新{updatesUnseen && <span className="update-dot" aria-hidden="true" />}
            </button>
          )}
        </nav>
      </header>

      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div ref={stageRef} className="landing-stage" onClick={onStageClick}>
        {/* 圓環中央的今日推薦(桌機/平板);手機改放環下方長條,見下方 landing-daily-strip */}
        {focusIdx === null && metrics && dims && !phone && (
          <div
            className="landing-daily"
            style={{
              left: `${dims.w * 0.5}px`,
              top: `${metrics.row ? Math.max(dims.h * 0.7, metrics.cy + dims.h * 0.3) : metrics.cy}px`,   // 一排的時候放在那排下面
              width: `${metrics.row ? Math.min(dims.w * 0.6, 360) : metrics.ringR * 1.12}px`,
            }}
          >
            {!daily && <p className="landing-daily-loading">讀取今天的天氣…</p>}
            {daily?.error && <p className="landing-daily-loading">{daily.error}</p>}
            {daily?.missing && onAdd && <button type="button" className="landing-daily-go" onClick={onAdd}>去新增</button>}
            {dailyOutfit && (
              <>
                <p className="landing-daily-weather">
                  <CitySelect /> {daily.weather.temp}° · 體感 {daily.weather.feelsLike}° · 降雨 {daily.weather.rainProb}%
                </p>
                <h2>今日推薦</h2>
                <ul className="landing-daily-list">
                  {Object.entries(dailyOutfit).map(([slot, item]) => (
                    <li key={slot}>
                      <span>{SLOT_LABEL[slot]}</span>{item.name}
                    </li>
                  ))}
                </ul>
                <button type="button" className="landing-daily-go" onClick={wearDaily}>
                  <Sparkle size={14} weight="regular" aria-hidden="true" /> 穿上看看
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
        {/* 手機:環心空出來,放一行手勢提示(桌機的提示在底部) */}
        {phone && focusIdx === null && dims && !metrics?.row && (
          <p className="landing-ring-note" style={{ left: `${dims.w * 0.5}px`, top: `${metrics?.cy ?? dims.h * 0.34}px` }}>
            滑一下轉一件<br />點一件放大
          </p>
        )}
      </div>

      {/* 手機:今日推薦改成環下方長條,不再壓圓環卡片 */}
      {phone && focusIdx === null && (
        <div className="landing-daily-strip">
          {!daily && <p className="landing-daily-loading">讀取今天的天氣…</p>}
          {daily?.error && <p className="landing-daily-loading">{daily.error}</p>}
          {daily?.missing && onAdd && <button type="button" className="landing-daily-go" onClick={onAdd}>去新增</button>}
          {dailyOutfit && (
            <>
              <p className="landing-daily-weather">
                <CitySelect /> {daily.weather.temp}° · 體感 {daily.weather.feelsLike}° · 降雨 {daily.weather.rainProb}%
              </p>
              <p className="landing-strip-head">今日推薦</p>
              <ul className="landing-strip-pieces">
                {["wholebody_up", "upperbody", "lowerbody", "shoes"].filter((slot) => dailyOutfit[slot]).slice(0, 4).map((slot) => (
                  <li key={slot}><b>{SLOT_LABEL[slot]}</b>{dailyOutfit[slot].name}</li>
                ))}
              </ul>
              <button type="button" className="landing-daily-go" onClick={wearDaily}>
                <Sparkle size={14} weight="regular" aria-hidden="true" /> 穿上看看
              </button>
            </>
          )}
        </div>
      )}

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

      {/* 手機圓環模式的提示移到環心(見上),底部提示只在其餘情況出現 */}
      {!(phone && focusIdx === null) && (
        <p className="landing-hint">
          {focusIdx === null
            ? (metrics?.row ? "點一件聚焦" : touch ? "上下滑轉一件 · 點一件聚焦" : "滾輪轉動 · 點一件聚焦")
            : touch ? "上下滑看下一件 · 再點看細節 · 點空白返回" : "滾輪瀏覽下一件 · 再點一下看細節 · 點空白處返回"}
        </p>
      )}
    </section>
  );
}
