// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, SpinnerGap, X } from "@phosphor-icons/react";
import { cropBlob, deleteLocalItem, findUrl, garmentColors, productUrlProblem, refillGaps, saveLocalItem, shrinkImage, trimTransparent } from "./localWardrobe.js";
import { fetchBrandProduct, fetchProductPage, parseBrandLink, partFromName, partFromProduct, sameProduct } from "./brandLink.js";
import { findSimilar, kindLabel } from "./wishCheck.js";
import { useDialog } from "./useDialog.js";
import { ScrollRail } from "./ScrollRail.jsx";
import { CURRENCIES, parsePrice } from "./price.js";

const PARTS = [
  { id: "upperbody", label: "上衣" },
  { id: "wholebody_up", label: "外套" },
  { id: "lowerbody", label: "下身" },
  { id: "socks", label: "襪子" },
  { id: "shoes", label: "鞋子" },
  { id: "bag", label: "包款" },
  { id: "eyewear", label: "眼鏡" },
  { id: "wrist", label: "手錶手環" },
  { id: "accessories_up", label: "其他配件" },
];

const FULL = { x: 0, y: 0, w: 1, h: 1 };

/* 去背模型有 80MB 左右,第一次用會下載。動態 import 讓它不進主 bundle,
   沒按「新增」的人完全不會付這個成本。 */
const MODEL_READY_KEY = "open-wardrobe-bgmodel-v1";   // 這台成功去背過一次 = 模型已經在瀏覽器快取裡
const modelReady = () => { try { return localStorage.getItem(MODEL_READY_KEY) === "1"; } catch { return false; } };

/* 進度回呼要是同一個函式:去背套件把設定(連 progress 一起)照第一次呼叫的樣子快取起來,之後每次都叫第一次那個。
   每次給新的回呼的話,第二件開始進度文字不動、下載看門狗也收不到進度,算到一半就被當成卡住(2026-10-03 審查抓到)。
   所以回呼固定一個,真正要通知誰放在 currentProgress。 */
let currentProgress = null;
let downloading = false;
const PROGRESS_CONFIG = {
  output: { format: "image/png", quality: 0.9 },
  progress: (key, current, total) => {
    if (!currentProgress) return;
    if (key.startsWith("fetch") && current < total) {
      downloading = true;
      currentProgress(`下載去背模型 ${Math.round((current / total) * 100)}%`, true);
    } else if (key.startsWith("fetch")) {
      // 下載到 100% 之後畫面會停 7–9 秒在算(主執行緒忙,文字也動不了),先講清楚接下來在做什麼(審查 F33)
      currentProgress(downloading ? "模型下載好了,開始去背,約 10–20 秒…" : "去背中,約 10–20 秒…", false);
    } else {
      currentProgress("去背中,約 10–20 秒…", false);
    }
  },
};
// 一次只算一張:取消只是不看結果,模型那邊停不下來;馬上再按一次去背,兩張一起算,iPad 的記憶體會撐不住
let previousRun = Promise.resolve();
let pending = 0;   // 排隊中加上正在算的張數

/** @param onProgress (文字, 是否在下載) */
async function removeBg(file, onProgress) {
  const waitFor = previousRun;
  let release;
  previousRun = new Promise((resolve) => { release = resolve; });
  pending += 1;
  try {
    if (pending > 1) onProgress("上一張還在算,等它結束…", false);
    await waitFor;
    const { removeBackground } = await import("@imgly/background-removal");
    downloading = false;
    currentProgress = onProgress;
    const result = await removeBackground(file, PROGRESS_CONFIG);
    try { localStorage.setItem(MODEL_READY_KEY, "1"); } catch { /* 存不了就每次都顯示第一次的提示 */ }
    return result;
  } finally {
    if (currentProgress === onProgress) currentProgress = null;
    pending -= 1;
    release();
  }
}

/* 在照片上拖一個框。座標存成 0–1,和照片實際解析度無關。
   手指點下去常常會動 1–3px,舊版一動就把框重畫成一個點,按鈕變灰也不說原因(審查 F32):移動不到 8px 不算拖。 */
const DRAG_THRESHOLD = 8;
function CropBox({ src, box, onChange }) {
  const frameRef = useRef(null);
  const startRef = useRef(null);

  const point = (event) => {
    const rect = frameRef.current.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const down = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = { at: point(event), x: event.clientX, y: event.clientY, dragging: false };
  };
  const move = (event) => {
    const start = startRef.current;
    if (!start) return;
    if (!start.dragging) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD) return;
      start.dragging = true;
    }
    const a = start.at;
    const b = point(event);
    onChange({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  };
  const up = () => { startRef.current = null; };

  return (
    <div className="crop-frame" ref={frameRef}>
      <img src={src} alt="要框選的照片" draggable="false" />
      <div
        className="crop-surface"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {/* 框外變暗用四塊長方形鋪在照片上。舊版用框的大陰影(9999px),iPhone 上會蓋出照片、把整個視窗和
            「去背框起來的」一起蓋暗,框好了按鈕看起來還是灰的(2026-10-04 本人 iPhone 截圖) */}
        <div className="crop-dim" style={{ left: 0, top: 0, width: "100%", height: `${box.y * 100}%` }} />
        <div className="crop-dim" style={{ left: 0, top: `${(box.y + box.h) * 100}%`, width: "100%", bottom: 0 }} />
        <div className="crop-dim" style={{ left: 0, top: `${box.y * 100}%`, width: `${box.x * 100}%`, height: `${box.h * 100}%` }} />
        <div className="crop-dim" style={{ left: `${(box.x + box.w) * 100}%`, top: `${box.y * 100}%`, right: 0, height: `${box.h * 100}%` }} />
        <div
          className="crop-rect"
          style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
        />
      </div>
    </div>
  );
}

/* 品牌圖庫:一格一張,載不到的(那件沒有第 N 張)自己藏起來。 */
function ImagePicker({ images, onPick }) {
  const [failed, setFailed] = useState(() => new Set());
  const [loaded, setLoaded] = useState(0);
  const allFailed = failed.size === images.length;
  // 載不到分不出是沒網路、被擋還是真的下架,不要猜「可能下架了」(審查 F60)
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return (
    <>
      <div className="pick-grid">
        {images.map((image, index) => !failed.has(index) && (
          <button key={image.thumb} type="button" className="pick-cell" onClick={() => onPick(image)} aria-label={`用第 ${index + 1} 張`}>
            <img
              src={image.thumb}
              alt=""
              loading="lazy"
              onLoad={() => setLoaded((count) => count + 1)}
              onError={() => setFailed((current) => new Set(current).add(index))}
            />
          </button>
        ))}
      </div>
      {allFailed && (
        <p className="add-field-error">
          {offline ? "現在沒有網路,商品圖載不到。有網路再試,或改用截圖。" : "這件的商品圖載不到(網址可能不對,或品牌那邊擋了)。改用截圖。"}
        </p>
      )}
      {!allFailed && loaded === 0 && <small className="add-hint">載入中…</small>}
    </>
  );
}

/* 去背套件只收 PNG、JPEG、WebP。LONGINES 的商品圖是 AVIF,整張去背直接失敗(2026-10-04 正式站實測
   「Invalid format: image/avif」);其他格式先讓瀏覽器解開、轉成 PNG。轉不了(瀏覽器也不認得)就照原樣,讓去背自己報錯 */
const CUTOUT_TYPES = /^image\/(png|jpeg|webp)$/;
async function toCutoutFormat(file) {
  if (CUTOUT_TYPES.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? new File([blob], "photo.png", { type: "image/png" }) : file;
  } catch {
    return file;
  }
}

/** 價錢欄:數字＋幣別。抓得到的已經填好;手動填的預設新台幣。也給單品頁用 */
export function PriceField({ value, currency, onChange, hint = "選填", id = "price" }) {
  return (
    <div className="add-field price-field">
      <label htmlFor={`${id}-amount`}>價錢</label>
      <div className="price-row">
        <select aria-label="幣別" value={currency || "TWD"} onChange={(event) => onChange(value, event.target.value)}>
          {CURRENCIES.map(([code, symbol]) => <option key={code} value={code}>{symbol}</option>)}
        </select>
        <input
          id={`${id}-amount`}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value, currency || "TWD")}
          placeholder="例:1290"
        />
      </div>
      {hint && <small className="add-hint">{hint}</small>}
    </div>
  );
}

const PAD = 0.1;
/** 框往外多留 10% 再去背:框得太貼,模型看不到背景,中間色的條紋會被去成半透明、旁邊留一條陰影(審查 F19)。去背完再裁回原本的框。 */
function expandBox(region) {
  const x = Math.max(0, region.x - region.w * PAD);
  const y = Math.max(0, region.y - region.h * PAD);
  const right = Math.min(1, region.x + region.w * (1 + PAD));
  const bottom = Math.min(1, region.y + region.h * (1 + PAD));
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * @param onAdded 存好之後叫,帶兩個參數:這件是不是存進「想買的」、存成什麼名字
 * @param existing 這個衣櫃已經有的(含想買的),存檔前拿來比對有沒有重複;站主是全部,訪客只有自己加的
 * @param openRequest 大於 0 就打開新增(空衣櫃、推薦失敗的「新增第一件」按鈕用);打開後叫 onOpenHandled 讓呼叫端歸零,
 *        不然切到入口再回來、這個元件重新掛上時又會自己打開
 */
export function AddGarment({ onAdded, existing = [], openRequest = 0, onOpenHandled = null }) {
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const [stage, setStage] = useState("idle"); // idle | source | pick | crop | working | review
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [source, setSource] = useState(null); // { file, url }
  const [box, setBox] = useState(FULL);
  const [draft, setDraft] = useState(null);
  const [linkText, setLinkText] = useState("");
  const [link, setLink] = useState(null); // parseBrandLink 的結果,貼了連結才有
  const runRef = useRef(0);                // 每次下載商品圖、去背都換一號;取消或逾時就換號,晚回來的結果丟掉
  const watchdogRef = useRef(null);

  /* 返回手勢(iPhone 從左緣側滑):舊版會直接離開網站,剛去背好的結果全丟(審查 F34)。
     打開新增時押一筆歷史,返回就只關掉新增;已經去背好的先問一聲。用 UI 關掉時自己把那一筆吃掉。 */
  const historyRef = useRef(false);
  const pushHistory = () => {
    if (historyRef.current) return;
    try { window.history.pushState({ addGarment: true }, ""); historyRef.current = true; } catch { /* 不支援就算了 */ }
  };

  const clear = () => {
    runRef.current += 1;
    clearTimeout(watchdogRef.current);
    if (draft?.preview) URL.revokeObjectURL(draft.preview);
    if (source?.url) URL.revokeObjectURL(source.url);
    setDraft(null);
    setSource(null);
    setBox(FULL);
    setStage("idle");
    setStatus("");
    setLinkText("");
    setLink(null);
  };
  const reset = () => {
    clear();
    if (historyRef.current) { historyRef.current = false; window.history.back(); }
  };
  const clearRef = useRef(clear);
  clearRef.current = clear;
  const stageRef = useRef(stage);
  stageRef.current = stage;
  useEffect(() => {
    const onPop = () => {
      if (!historyRef.current) return;   // 自己 history.back() 吃掉的那一筆,或新增沒開著
      historyRef.current = false;
      if (stageRef.current === "idle") return;
      if (stageRef.current === "review" && !window.confirm("要放棄剛去背好的這件嗎?")) { pushHistory(); return; }
      clearRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      clearTimeout(watchdogRef.current);
    };
  }, []);

  const open = () => {
    setError("");
    setStage("source");
    pushHistory();
  };
  useEffect(() => {
    if (!openRequest) return;
    open();
    onOpenHandled?.();
  }, [openRequest]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Esc、✕、取消、返回手勢:去背好的那一步先問(焦點一進來就在 ✕ 上,按一下 Enter 不該把算了半分鐘的結果丟掉),其他直接關
  const requestClose = () => {
    if (stage === "review" && !window.confirm("要放棄剛去背好的這件嗎?")) return;
    reset();
  };
  // 處理中按取消:回到上一步,照片和框都留著(審查 F4)。模型那邊停不下來,晚回來的結果丟掉
  const cancelWork = () => {
    runRef.current += 1;
    clearTimeout(watchdogRef.current);
    setStatus("");
    setStage(source ? "crop" : link?.images.length ? "pick" : "source");
  };
  const showing = stage !== "idle";
  useDialog(dialogRef, stage === "working" ? cancelWork : requestClose, { active: showing, watch: stage });

  const linkProblem = productUrlProblem(linkText);
  const parsedLink = linkText.trim() && !linkProblem ? parseBrandLink(linkText) : null;

  // 其他品牌:貼上就在背景讀商品頁(停 350ms 等貼完),讀到圖就跟 GU 一樣挑圖;擋機器人、讀不到就照舊用截圖
  const pageUrl = parsedLink?.page ? parsedLink.url : null;
  const [pageInfo, setPageInfo] = useState(null);   // { url, status: loading|ok|blocked|empty, name, brand, images, error }
  useEffect(() => {
    if (!pageUrl) return undefined;
    setPageInfo({ url: pageUrl, status: "loading", images: [] });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchProductPage(pageUrl, controller.signal).then((data) => {
        const status = data.images.length ? "ok" : data.blocked ? "blocked" : "empty";
        setPageInfo({ url: pageUrl, status, name: data.name || "", brand: data.brand || "", images: data.images, price: data.price || null, error: data.error || "" });
      }).catch(() => { /* 換了網址,這次的不要了 */ });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [pageUrl]);
  const page = pageUrl && pageInfo?.url === pageUrl ? pageInfo : null;
  const pageLoading = Boolean(pageUrl) && (!page || page.status === "loading");
  const effectiveLink = (() => {
    if (!parsedLink?.page || !page || page.status === "loading") return parsedLink;
    const site = new URL(parsedLink.url).hostname.replace(/^(www|m|tw)\./, "");
    const brand = page.brand || site;
    // 品名:分享文字裡的優先;商品頁讀到的補上品牌(品名裡已經有就不重複)
    const pageName = page.name && brand && !page.name.toLowerCase().includes(brand.toLowerCase()) ? `${page.name}(${brand})` : page.name;
    const name = parsedLink.name || pageName || "";
    // 品名猜不出分類就看網址(LONGINES 的品名沒有「錶」,網址是 /p/watch-longines-…)
    const slug = decodeURIComponent(new URL(parsedLink.url).pathname).replace(/[-_/.]+/g, " ");
    return { ...parsedLink, brand, name, images: page.images, part: partFromName(name) || partFromName(slug) || null, price: page.price || null };
  })();
  // 貼上連結的那一步就講加過了沒(審查 F31):舊版要等去背完才說,白等一輪
  const linkDupe = useMemo(
    () => (parsedLink?.url && !parsedLink.notProduct ? existing.find((item) => item.sourceUrl && sameProduct(item.sourceUrl, parsedLink.url)) : null),
    [parsedLink?.url, parsedLink?.notProduct, existing],   // eslint-disable-line react-hooks/exhaustive-deps
  );

  const applyLink = () => {
    const chosen = effectiveLink;
    setLink(chosen);
    // GU、UNIQLO:品名在背景問,挑圖、去背照常進行;回來時如果名稱還空著才填,不蓋掉手打的
    if (chosen?.lookup) {
      fetchBrandProduct(chosen.lookup).then((product) => {
        if (!product) return;
        const name = `${product.name}(${chosen.brand})`;
        const part = partFromProduct(product.name, product.categories);
        setLink((current) => (current?.url === chosen.url ? { ...current, name, part, price: product.price || current.price || null } : current));
        setDraft((current) => {
          if (!current || current.sourceUrl !== chosen.url) return current;
          const next = { ...current };
          if (!current.name) { next.name = name; next.part = current.part || part || ""; }
          // 價錢晚一點才回來:欄位還空著才填,不蓋掉手打的
          if (!current.price && product.price) { next.price = String(product.price.amount); next.priceCurrency = product.price.currency || "TWD"; }
          return next;
        });
      });
    }
    if (chosen?.images.length) setStage("pick");
    else inputRef.current?.click();
  };

  /* 下載品牌的大圖再進框選;大圖失敗就退回挑圖時看到的那張。 */
  const pickBrandImage = async (image) => {
    const run = ++runRef.current;
    setStage("working");
    setError("");
    setStatus("下載商品圖…");
    try {
      let response = await fetch(image.full);
      if (!response.ok) response = await fetch(image.thumb);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (run !== runRef.current) return;
      pick(new File([blob], "brand.jpg", { type: blob.type || "image/jpeg" }));
    } catch (cause) {
      if (run !== runRef.current) return;
      console.error(cause);
      setError(navigator.onLine === false ? "現在沒有網路,商品圖下載不了。" : "商品圖下載失敗。換一張,或改用截圖。");
      setStage("pick");
    }
  };

  const pick = async (file) => {
    if (!file) return;
    setError("");
    const usable = await toCutoutFormat(file);
    setSource({ file: usable, url: URL.createObjectURL(usable) });
    setBox(FULL);
    setStage("crop");
  };

  const cutout = async (region) => {
    const run = ++runRef.current;
    const alive = () => run === runRef.current;
    setStage("working");
    setError("");
    setStatus("讀取照片…");
    // 看門狗只管下載:60 秒沒有任何下載進度就停(舊版卡住時永遠停在「讀取照片…」,Esc、點外面都沒用)。
    // 開始算之後不計時:iPad gen 7 光推論就可能超過 45 秒,要停就按取消
    const arm = () => {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = setTimeout(() => {
        if (!alive()) return;
        runRef.current += 1;
        setError("去背模型下載停住了。檢查網路後再按一次。");
        setStatus("");
        setStage("crop");
      }, 60000);
    };
    arm();
    try {
      const outer = region === FULL ? FULL : expandBox(region);
      const input = outer === FULL ? source.file : await cropBlob(source.file, outer);
      const cut = await removeBg(input, (text, downloading) => {
        if (!alive()) return;
        setStatus(text);
        if (downloading) arm(); else clearTimeout(watchdogRef.current);
      });
      if (!alive()) return;
      clearTimeout(watchdogRef.current);
      setStatus("修邊…");
      let clean = await refillGaps(input, cut);
      if (outer !== FULL) {
        clean = await cropBlob(clean, {
          x: (region.x - outer.x) / outer.w, y: (region.y - outer.y) / outer.h,
          w: region.w / outer.w, h: region.h / outer.h,
        });
      }
      const blob = await shrinkImage((await trimTransparent(clean)).blob);
      const { color, secondaryColor } = await garmentColors(blob);
      if (!alive()) return;
      setDraft({
        id: `local-${Date.now()}`,
        blob,
        preview: URL.createObjectURL(blob),
        name: link?.name || "",
        // 長寬比猜分類一直猜錯(短褲→鞋、外套→下身),沒有品名可以看就留空讓人選
        part: link?.part || partFromName(link?.name) || "",
        color,
        secondaryColor,
        // 貼了商品連結才預設「還沒買」;從相簿選的多半是自己已經有的
        wishlist: Boolean(link?.url),
        sourceUrl: link?.url || "",
        // 價錢:商品頁或 GU、UNIQLO 讀得到就先填好,讀不到留空讓人填
        price: link?.price?.amount ? String(link.price.amount) : "",
        priceCurrency: link?.price?.currency || "TWD",
      });
      setStage("review");
      setStatus("");
    } catch (cause) {
      if (!alive()) return;
      clearTimeout(watchdogRef.current);
      console.error(cause);
      setError("去背失敗,可能是照片太大或網路斷線。換一張試試,或改用離線流程處理。");
      setStage("crop");
    }
  };

  const tooSmall = box.w < 0.05 || box.h < 0.05;
  const urlError = draft ? productUrlProblem(draft.sourceUrl) : "";
  const urlInvalid = Boolean(urlError);

  // 防呆:同一個商品連結貼第二次,或櫃裡已經有同款同色的,存之前先講(不擋,按鈕改成「還是要存」)
  const draftUrl = draft?.wishlist ? findUrl(draft.sourceUrl) : null;
  const sameLink = useMemo(
    () => (draftUrl ? existing.find((item) => item.sourceUrl && sameProduct(item.sourceUrl, draftUrl)) : null),
    [draftUrl, existing],
  );
  const similar = useMemo(
    () => (draft?.part ? findSimilar({ part: draft.part, name: draft.name, color: draft.color }, existing) : []),
    [draft?.part, draft?.name, draft?.color, existing],
  );
  const dupes = sameLink ? [sameLink] : similar;
  // 很像的分成已經有的、想買的:只比到想買的那件,舊版還是寫「櫃裡已經有 1 件」(審查 F57)
  const similarText = () => {
    const kind = kindLabel({ part: draft.part, name: draft.name });
    const owned = similar.filter((item) => !item.wishlist).length;
    const wished = similar.length - owned;
    if (owned && wished) return `櫃裡已經有 ${owned} 件同色的${kind},想買的裡還有 ${wished} 件,確定還要再加?`;
    if (owned) return `櫃裡已經有 ${owned} 件同色的${kind},確定還要再加?`;
    return `想買的裡已經有 ${wished} 件同色的${kind},確定還要再加?`;
  };

  const save = async () => {
    const name = draft.name.trim() || (draft.wishlist ? "想買的單品" : "新單品");
    await saveLocalItem({
      id: draft.id,
      name,
      part: draft.part,
      color: draft.color,
      secondaryColor: draft.secondaryColor,
      tags: [],
      blob: draft.blob,
      wishlist: draft.wishlist,
      sourceUrl: draft.wishlist ? findUrl(draft.sourceUrl) : null,
      price: parsePrice(draft.price),
      priceCurrency: draft.priceCurrency || "TWD",
    });
    onAdded(draft.wishlist, name);
    reset();
  };

  const closeButton = (label = "取消") => (
    <button type="button" className="add-close" onClick={requestClose} aria-label={label}>
      <X size={20} weight="light" aria-hidden="true" />
    </button>
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => { pick(event.target.files?.[0]); event.target.value = ""; }}
      />

      <button
        type="button"
        className="add-garment-button"
        onClick={open}
        disabled={stage === "working"}
      >
        {stage === "working"
          ? <><SpinnerGap size={14} className="add-spinner" aria-hidden="true" /> 處理中</>
          : <><Plus size={14} weight="bold" aria-hidden="true" /> 新增</>}
      </button>

      {stage === "source" && (
        <div className="add-overlay" role="dialog" aria-modal="true" aria-label="新增衣物" ref={dialogRef}>
          <form
            className="add-panel add-panel-review"
            onSubmit={(event) => { event.preventDefault(); if (parsedLink && !parsedLink.notProduct && !pageLoading) applyLink(); }}
          >
            {closeButton()}
            <p className="add-step">新增一件</p>
            <label className="add-field">
              <span>貼商品連結</span>
              {/* type="text" 不是 "url":App「分享」拷出來的是「快來看看【品名】… https://…」整段,
                  type="url" 會被瀏覽器當成不合法網址擋下來,按了沒反應(2026-10-03 WebKit 實測)。網址在 findUrl 裡挑出來 */}
              <input
                type="text"
                inputMode="url"
                autoComplete="off"
                value={linkText}
                onChange={(event) => setLinkText(event.target.value)}
                placeholder="https://"
                aria-invalid={Boolean(linkProblem)}
              />
              {linkProblem && <small className="add-field-error">{linkProblem}</small>}
            </label>
            <small className="add-hint" role="status">
              {parsedLink?.notProduct
                ? `這是 ${parsedLink.brand} 的網址,但不是單一商品頁。打開那件商品,按分享、拷貝連結再貼。`
                : pageLoading
                  ? "讀取商品頁…"
                  : effectiveLink?.images.length
                    ? `${effectiveLink.brand} 的商品圖抓得到${effectiveLink.page ? `(${effectiveLink.images.length} 張)` : ""}。下一步挑一張平拍的。`
                    : page?.status === "blocked"
                      ? `這個網站擋住了自動讀取(大品牌和蝦皮常這樣),網址會存起來,接著選截圖${effectiveLink?.name ? `;品名先填「${effectiveLink.name}」` : ""}。`
                      : effectiveLink?.name
                        ? `${effectiveLink.brand || "這個網站"}的圖抓不到,品名先填「${effectiveLink.name}」,接著選截圖。`
                        : parsedLink
                          ? "這頁讀不到商品圖,網址會存起來,接著選截圖。"
                          : "貼品牌官網或購物網站的商品連結,讀得到就能直接挑圖;讀不到的(像蝦皮、Zara)用截圖。"}
            </small>
            {linkDupe && (
              <small className="add-hint add-dupe-early" role="status">
                這件加過了:「{linkDupe.name}」{linkDupe.wishlist ? ",在想買的裡" : ",已經在衣櫃裡"}。還是可以再加一次。
              </small>
            )}
            <div className="add-actions">
              <button type="button" className="secondary-button" onClick={() => { setLink(parsedLink?.notProduct ? null : effectiveLink ? { ...effectiveLink, images: [] } : null); inputRef.current?.click(); }}>
                {parsedLink ? "改用照片" : "從相簿選照片"}
              </button>
              <button type="submit" className="primary-button" disabled={!parsedLink || parsedLink.notProduct || pageLoading}>
                {pageLoading ? "讀取中…" : effectiveLink?.images.length ? "列出商品圖" : "選截圖"}
              </button>
            </div>
          </form>
        </div>
      )}

      {stage === "pick" && link && (
        <div className="add-overlay" role="dialog" aria-modal="true" aria-label="挑一張商品圖" ref={dialogRef}>
          <div className="add-panel add-panel-review">
            {closeButton()}
            <p className="add-step">挑一張平拍的</p>
            {link.name && <small className="add-hint">{link.name}</small>}
            <small className="add-hint">
              衣服單獨擺著的那張去背最乾淨{link.lookup ? ",通常在最後幾張" : ""}。模特兒穿著的,人會一起留下來。
            </small>
            <ImagePicker images={link.images} onPick={pickBrandImage} />
            <div className="add-actions">
              <button type="button" className="secondary-button" onClick={() => inputRef.current?.click()}>改用截圖</button>
            </div>
          </div>
        </div>
      )}

      {stage === "crop" && source && (
        <div className="add-overlay" role="dialog" aria-modal="true" aria-label="框出衣服" ref={dialogRef}>
          <div className="add-panel add-panel-review">
            {closeButton()}
            <p className="add-step">用手指框出衣服</p>
            <small className="add-hint">截圖的話,把狀態列、價格、按鈕框在外面。模特兒穿著的圖去背後人也會留下,盡量挑平拍那張。</small>
            <CropBox src={source.url} box={box} onChange={setBox} />
            {box !== FULL && tooSmall && <small className="add-field-error" role="status">框太小了,重新拖一個。</small>}
            <div className="add-actions">
              <button type="button" className="secondary-button" onClick={() => cutout(FULL)}>整張去背</button>
              <button type="button" className="primary-button" onClick={() => cutout(box)} disabled={box === FULL || tooSmall}>
                去背框起來的
              </button>
            </div>
          </div>
        </div>
      )}

      {stage === "working" && (
        <div className="add-overlay" role="dialog" aria-modal="true" aria-label="處理中" ref={dialogRef}>
          <div className="add-panel">
            <SpinnerGap size={30} className="add-spinner" aria-hidden="true" />
            <p role="status" aria-live="polite">{status}</p>
            <small>
              {modelReady() ? "" : "第一次使用要下載約 80MB 的去背模型,之後會快很多。"}
              照片在這台裝置上處理,不會上傳。
            </small>
            <button type="button" className="secondary-button add-cancel" onClick={cancelWork}>取消</button>
          </div>
        </div>
      )}

      {stage === "review" && draft && (
        <div className="add-overlay" role="dialog" aria-modal="true" aria-label="確認新增的衣物" ref={dialogRef}>
          <div className="add-panel add-panel-review">
            {closeButton()}
            <img className="add-preview" src={draft.preview} alt="去背結果預覽" />

            <fieldset className="add-owned">
              <legend>這件</legend>
              <label>
                <input
                  type="radio"
                  name="owned"
                  checked={draft.wishlist}
                  onChange={() => setDraft((current) => ({ ...current, wishlist: true }))}
                />
                還沒買
              </label>
              <label>
                <input
                  type="radio"
                  name="owned"
                  checked={!draft.wishlist}
                  onChange={() => setDraft((current) => ({ ...current, wishlist: false }))}
                />
                已經有了
              </label>
            </fieldset>

            <label className="add-field">
              <span>名稱</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder={draft.wishlist ? "例:GU 寬版牛仔褲" : "例:白色帆布鞋"}
              />
            </label>

            <PriceField
              value={draft.price}
              currency={draft.priceCurrency}
              onChange={(price, priceCurrency) => setDraft((current) => ({ ...current, price, priceCurrency }))}
              hint={link?.price ? "從商品頁讀到的,可以改" : link?.url ? "商品頁讀不到價錢,知道的話自己填" : "選填"}
            />

            <label className="add-field">
              <span>分類</span>
              <select
                value={draft.part}
                onChange={(event) => setDraft((current) => ({ ...current, part: event.target.value }))}
                aria-invalid={!draft.part}
              >
                <option value="" disabled>選一個</option>
                {PARTS.map((part) => <option key={part.id} value={part.id}>{part.label}</option>)}
              </select>
              {!draft.part && <small className="add-hint">選好分類才能存。</small>}
            </label>

            {draft.wishlist && (
              <label className="add-field">
                <span>商品網址(選填,之後點得回去買)</span>
                <input
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  value={draft.sourceUrl}
                  onChange={(event) => setDraft((current) => ({ ...current, sourceUrl: event.target.value }))}
                  placeholder="https://"
                  aria-invalid={urlInvalid}
                />
                {urlInvalid && <small className="add-field-error">{urlError}</small>}
              </label>
            )}

            {draft.wishlist && link?.url && (
              <small className="add-hint">品牌的照片不會出現在公開的衣櫃;開了同步的話,雲端只存加密過的一份。</small>
            )}

            {dupes.length > 0 && (
              <div className="add-dupe" role="status">
                <p>
                  {sameLink
                    ? `這個連結已經加過了:「${sameLink.name}」${sameLink.wishlist ? ",在想買的裡" : ",已經在衣櫃裡"}。`
                    : similarText()}
                </p>
                <div className="add-dupe-thumbs">
                  {dupes.slice(0, 4).map((item) => (
                    <img key={item.id} src={item.thumbnail || item.image} alt={item.name} title={item.name} />
                  ))}
                  {dupes.length > 4 && <span>還有 {dupes.length - 4} 件</span>}
                </div>
              </div>
            )}

            <div className="add-actions">
              <button type="button" className="secondary-button" onClick={requestClose}>取消</button>
              <button type="button" className="primary-button" onClick={save} disabled={urlInvalid || !draft.part}>
                {dupes.length ? "還是要存" : draft.wishlist ? "放進想買的" : "加入衣櫃"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showing && <ScrollRail target={dialogRef} watch={stage} />}
      {error && <p className="add-error" role="alert">{error}</p>}
    </>
  );
}

export { deleteLocalItem };
