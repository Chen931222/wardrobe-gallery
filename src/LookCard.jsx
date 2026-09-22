// [本 fork 新增] Look 卡面板:預覽合成好的圖、切換平鋪/人形、下載或走系統分享(iPhone 可直接丟 Threads/IG)。
import { useEffect, useRef, useState } from "react";
import { DownloadSimple, ShareNetwork, X } from "@phosphor-icons/react";
import { renderLookCard } from "./lookCard.js";

export function LookCard({ outfit, fits, slotStyle, caption, onClose }) {
  const [style, setStyle] = useState("flatlay");
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const closeRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    renderLookCard({ style, outfit, fits, slotStyle, caption })
      .then((canvas) => new Promise((resolve) => canvas.toBlob(resolve, "image/png")))
      .then((blob) => {
        if (!alive) return;
        setUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
        setBusy(false);
      })
      .catch((cause) => { if (alive) { setError(`合成失敗:${cause?.message || cause}`); setBusy(false); } });
    return () => { alive = false; };
  }, [style, outfit, fits, slotStyle, caption]);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus({ preventScroll: true });
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const fileName = `look-${(caption.date || "").replace(/\./g, "")}-${style}.png`;

  const download = () => {
    if (!url) return;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
  };

  // iOS/Android 有系統分享面板就走那條(可直接丟 Threads/IG/訊息);沒有就退回下載。
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const share = async () => {
    if (!url) return;
    try {
      const blob = await fetch(url).then((response) => response.blob());
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: caption.title || "今日穿搭" }); return; }
    } catch { /* 使用者取消或不支援檔案分享,退回下載 */ }
    download();
  };

  return (
    <div className="lookcard-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="lookcard" role="dialog" aria-modal="true" aria-label="這套穿搭的卡片">
        <div className="lookcard-head">
          <div className="lookcard-tabs" role="tablist" aria-label="卡片版式">
            <button type="button" role="tab" aria-selected={style === "flatlay"} className={style === "flatlay" ? "active" : ""} onClick={() => setStyle("flatlay")}>平鋪</button>
            <button type="button" role="tab" aria-selected={style === "doll"} className={style === "doll" ? "active" : ""} onClick={() => setStyle("doll")}>人形</button>
          </div>
          <button type="button" className="lookcard-close" onClick={onClose} aria-label="關閉" ref={closeRef}>
            <X size={20} weight="light" aria-hidden="true" />
          </button>
        </div>

        <div className="lookcard-preview">
          {busy && <p className="lookcard-status">合成中…</p>}
          {!busy && error && <p className="lookcard-status error">{error}</p>}
          {!busy && !error && url && <img src={url} alt="這套穿搭的卡片" />}
        </div>

        <div className="lookcard-actions">
          <button type="button" onClick={download} disabled={!url}>
            <DownloadSimple size={15} weight="regular" aria-hidden="true" /> 下載 PNG
          </button>
          {canShare && (
            <button type="button" className="lookcard-share" onClick={share} disabled={!url}>
              <ShareNetwork size={15} weight="regular" aria-hidden="true" /> 分享
            </button>
          )}
        </div>
        <p className="lookcard-note">在你的裝置上合成,沒有任何東西上傳。</p>
      </div>
    </div>
  );
}
