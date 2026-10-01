// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
import { useRef, useState } from "react";
import { Plus, SpinnerGap, X } from "@phosphor-icons/react";
import { cleanUrl, cropBlob, deleteLocalItem, dominantColor, productUrlProblem, saveLocalItem, trimTransparent } from "./localWardrobe.js";
import { parseBrandLink, partFromName } from "./brandLink.js";

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

export function AddGarment({ onAdded }) {
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
      const { blob } = await trimTransparent(cut);
      const color = await dominantColor(blob);
      setDraft({
        id: `local-${Date.now()}`,
        blob,
        preview: URL.createObjectURL(blob),
        name: link?.name || "",
        // 長寬比猜分類一直猜錯(短褲→鞋、外套→下身),沒有品名可以看就留空讓人選
        part: partFromName(link?.name) || "",
        color,
        wishlist: true,
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

  const save = async () => {
    await saveLocalItem({
      id: draft.id,
      name: draft.name.trim() || (draft.wishlist ? "想買的單品" : "新單品"),
      part: draft.part,
      color: draft.color,
      tags: [],
      blob: draft.blob,
      wishlist: draft.wishlist,
      sourceUrl: draft.wishlist ? cleanUrl(draft.sourceUrl) : null,
    });
    onAdded();
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
              <input
                type="url"
                inputMode="url"
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
                  type="url"
                  inputMode="url"
                  value={draft.sourceUrl}
                  onChange={(event) => setDraft((current) => ({ ...current, sourceUrl: event.target.value }))}
                  placeholder="https://"
                  aria-invalid={urlInvalid}
                />
                {urlInvalid && <small className="add-field-error">{urlError}</small>}
              </label>
            )}

            {draft.wishlist && (
              <small className="add-hint">品牌的照片只存在這台裝置,不會出現在公開的衣櫃。</small>
            )}

            <div className="add-actions">
              <button type="button" className="secondary-button" onClick={reset}>取消</button>
              <button type="button" className="primary-button" onClick={save} disabled={urlInvalid || !draft.part}>
                {draft.wishlist ? "放進想買的" : "加入衣櫃"}
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
