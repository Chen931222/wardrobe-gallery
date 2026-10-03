// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
import { useMemo, useRef, useState } from "react";
import { Plus, SpinnerGap, X } from "@phosphor-icons/react";
import { cropBlob, deleteLocalItem, dominantColor, findUrl, productUrlProblem, refillGaps, saveLocalItem, trimTransparent } from "./localWardrobe.js";
import { fetchBrandProduct, parseBrandLink, partFromName, partFromProduct, sameProduct } from "./brandLink.js";
import { findSimilar, kindLabel } from "./wishCheck.js";

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
async function removeBg(file, onProgress) {
  const { removeBackground } = await import("@imgly/background-removal");
  return removeBackground(file, {
    output: { format: "image/png", quality: 0.9 },
    progress: (key, current, total) => {
      if (key.startsWith("fetch")) onProgress(`下載去背模型 ${Math.round((current / total) * 100)}%`);
      else onProgress("去背處理中…");
    },
  });
}

/* 在照片上拖一個框。座標存成 0–1,和照片實際解析度無關。 */
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
    startRef.current = point(event);
  };
  const move = (event) => {
    if (!startRef.current) return;
    const a = startRef.current;
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
      {allFailed && <p className="add-field-error">這件的圖抓不到,可能下架了或網址改了。改用截圖。</p>}
      {!allFailed && loaded === 0 && <small className="add-hint">載入中…</small>}
    </>
  );
}

/**
 * @param onAdded 存好之後叫,帶一個參數:這件是不是存進「想買的」
 * @param existing 這個衣櫃已經有的(含想買的),存檔前拿來比對有沒有重複;站主是全部,訪客只有自己加的
 */
export function AddGarment({ onAdded, existing = [] }) {
  const inputRef = useRef(null);
  const [stage, setStage] = useState("idle"); // idle | source | pick | crop | working | review
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [source, setSource] = useState(null); // { file, url }
  const [box, setBox] = useState(FULL);
  const [draft, setDraft] = useState(null);
  const [linkText, setLinkText] = useState("");
  const [link, setLink] = useState(null); // parseBrandLink 的結果,貼了連結才有

  const reset = () => {
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

  const linkProblem = productUrlProblem(linkText);
  const parsedLink = linkText.trim() && !linkProblem ? parseBrandLink(linkText) : null;

  const applyLink = () => {
    setLink(parsedLink);
    // 品名在背景問,挑圖、去背照常進行;回來時如果名稱還空著才填,不蓋掉手打的
    fetchBrandProduct(parsedLink?.lookup).then((product) => {
      if (!product) return;
      const name = `${product.name}(${parsedLink.brand})`;
      const part = partFromProduct(product.name, product.categories);
      setLink((current) => (current?.url === parsedLink.url ? { ...current, name, part } : current));
      setDraft((current) => (current && current.sourceUrl === parsedLink.url && !current.name
        ? { ...current, name, part: current.part || part || "" }
        : current));
    });
    if (parsedLink?.images.length) setStage("pick");
    else inputRef.current?.click();
  };

  /* 下載品牌的大圖再進框選;大圖失敗就退回挑圖時看到的那張。 */
  const pickBrandImage = async (image) => {
    setStage("working");
    setError("");
    setStatus("下載商品圖…");
    try {
      let response = await fetch(image.full);
      if (!response.ok) response = await fetch(image.thumb);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      pick(new File([blob], "brand.jpg", { type: blob.type || "image/jpeg" }));
    } catch (cause) {
      console.error(cause);
      setError("商品圖下載失敗。換一張,或改用截圖。");
      setStage("pick");
    }
  };

  const pick = (file) => {
    if (!file) return;
    setError("");
    setSource({ file, url: URL.createObjectURL(file) });
    setBox(FULL);
    setStage("crop");
  };

  const cutout = async (region) => {
    setStage("working");
    setError("");
    setStatus("讀取照片…");
    try {
      const input = region === FULL ? source.file : await cropBlob(source.file, region);
      const cut = await removeBg(input, setStatus);
      setStatus("修邊…");
      const { blob } = await trimTransparent(await refillGaps(input, cut));
      const color = await dominantColor(blob);
      setDraft({
        id: `local-${Date.now()}`,
        blob,
        preview: URL.createObjectURL(blob),
        name: link?.name || "",
        // 長寬比猜分類一直猜錯(短褲→鞋、外套→下身),沒有品名可以看就留空讓人選
        part: link?.part || partFromName(link?.name) || "",
        color,
        // 貼了商品連結才預設「還沒買」;從相簿選的多半是自己已經有的
        wishlist: Boolean(link?.url),
        sourceUrl: link?.url || "",
      });
      setStage("review");
      setStatus("");
    } catch (cause) {
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

  const save = async () => {
    await saveLocalItem({
      id: draft.id,
      name: draft.name.trim() || (draft.wishlist ? "想買的單品" : "新單品"),
      part: draft.part,
      color: draft.color,
      tags: [],
      blob: draft.blob,
      wishlist: draft.wishlist,
      sourceUrl: draft.wishlist ? findUrl(draft.sourceUrl) : null,
    });
    onAdded(draft.wishlist);
    reset();
  };

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
        onClick={() => { setError(""); setStage("source"); }}
        disabled={stage === "working"}
      >
        {stage === "working"
          ? <><SpinnerGap size={14} className="add-spinner" aria-hidden="true" /> 處理中</>
          : <><Plus size={14} weight="bold" aria-hidden="true" /> 新增</>}
      </button>

      {stage === "source" && (
        <div className="add-overlay" role="dialog" aria-modal="true" aria-label="新增衣物">
          <form
            className="add-panel add-panel-review"
            onSubmit={(event) => { event.preventDefault(); if (parsedLink) applyLink(); }}
          >
            <button type="button" className="add-close" onClick={reset} aria-label="取消">
              <X size={20} weight="light" aria-hidden="true" />
            </button>
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
            <small className="add-hint">
              {parsedLink?.images.length
                ? `${parsedLink.brand} 的商品圖抓得到。下一步挑一張平拍的。`
                : parsedLink?.name
                  ? `${parsedLink.brand} 的圖抓不到,品名先填「${parsedLink.name}」,接著選截圖。`
                  : parsedLink
                    ? "這個網站的圖抓不到,網址會存起來,接著選截圖。"
                    : "GU、UNIQLO 貼連結就能挑圖;其他品牌用截圖。"}
            </small>
            <div className="add-actions">
              <button type="button" className="secondary-button" onClick={() => { setLink(parsedLink); inputRef.current?.click(); }}>
                {parsedLink ? "改用照片" : "從相簿選照片"}
              </button>
              <button type="submit" className="primary-button" disabled={!parsedLink}>
                {parsedLink?.images.length ? "列出商品圖" : "選截圖"}
              </button>
            </div>
          </form>
        </div>
      )}

      {stage === "pick" && link && (
        <div className="add-overlay" role="dialog" aria-modal="true" aria-label="挑一張商品圖">
          <div className="add-panel add-panel-review">
            <button type="button" className="add-close" onClick={reset} aria-label="取消">
              <X size={20} weight="light" aria-hidden="true" />
            </button>
            <p className="add-step">挑一張平拍的</p>
            {link.name && <small className="add-hint">{link.name}</small>}
            <small className="add-hint">衣服單獨擺著的那張去背最乾淨。模特兒穿著的,人會一起留下來。</small>
            <ImagePicker images={link.images} onPick={pickBrandImage} />
            <div className="add-actions">
              <button type="button" className="secondary-button" onClick={() => inputRef.current?.click()}>改用截圖</button>
            </div>
          </div>
        </div>
      )}

      {stage === "crop" && source && (
        <div className="add-overlay" role="dialog" aria-modal="true" aria-label="框出衣服">
          <div className="add-panel add-panel-review">
            <button type="button" className="add-close" onClick={reset} aria-label="取消">
              <X size={20} weight="light" aria-hidden="true" />
            </button>
            <p className="add-step">用手指框出衣服</p>
            <small className="add-hint">截圖的話,把狀態列、價格、按鈕框在外面。模特兒穿著的圖去背後人也會留下,盡量挑平拍那張。</small>
            <CropBox src={source.url} box={box} onChange={setBox} />
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
        <div className="add-overlay" role="status" aria-live="polite">
          <div className="add-panel">
            <SpinnerGap size={30} className="add-spinner" aria-hidden="true" />
            <p>{status}</p>
            <small>第一次使用要下載約 80MB 的去背模型,之後會快很多。照片在這台裝置上處理,不會上傳。</small>
          </div>
        </div>
      )}

      {stage === "review" && draft && (
        <div className="add-overlay" role="dialog" aria-modal="true" aria-label="確認新增的衣物">
          <div className="add-panel add-panel-review">
            <button type="button" className="add-close" onClick={reset} aria-label="取消">
              <X size={20} weight="light" aria-hidden="true" />
            </button>
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
                    ? `這個連結已經加過了:「${sameLink.name}」${sameLink.wishlist ? ",在想買的裡" : ""}。`
                    : `櫃裡已經有 ${similar.length} 件同色的${kindLabel({ part: draft.part, name: draft.name })},確定還要再加?`}
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
              <button type="button" className="secondary-button" onClick={reset}>取消</button>
              <button type="button" className="primary-button" onClick={save} disabled={urlInvalid || !draft.part}>
                {dupes.length ? "還是要存" : draft.wishlist ? "放進想買的" : "加入衣櫃"}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="add-error" role="alert">{error}</p>}
    </>
  );
}

export { deleteLocalItem };
