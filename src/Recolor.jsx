// [本 fork 新增] 衣櫃裡任何一件的換色(2026-10-30,本人:「代表款裡面可以換衣服顏色的功能滿好用的,可以套用到所有衣櫃裡面的衣服」)。
// 跟代表款同一支換色(src/standIns.js 的 recolor:留明暗、換色相),差別是底圖是這件現在的圖。
// 整件一起換:印花、撞色會變成單一顏色,鞋底、扣環也跟著變,面板上照實講。
// 自己加的衣服換色就直接換掉那張圖(跟「換圖」一樣,沒有復原);站主衣櫃的另存一張 override,可以「換回原圖」(App.jsx recolorImage)。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "@phosphor-icons/react";
import { useDialog } from "./useDialog.js";
import { STAND_IN_COLORS, makeStandInBlob } from "./standIns.js";
import { fullImageOf } from "./useFullImage.js";

const normalizeHex = (value) => (/^#[0-9a-f]{6}$/i.test(value || "") ? value.toLowerCase() : null);

/**
 * @param item 要換色的那件(衣櫃清單裡的物件:image／fullImageId、name、color、standIn)
 * @param onClose 關掉,什麼都沒改
 * @param onApply(blob, hex, colorKey) 換好的圖、色碼;colorKey 是色票的 key(自選顏色時 null),代表款照它改品名
 */
export function Recolor({ item, onClose, onApply }) {
  const dialogRef = useRef(null);
  const [src, setSrc] = useState(null);          // 這件現在的原圖(objectURL 或網址)
  const [hex, setHex] = useState(null);          // 目前點的顏色;null＝還沒點,預覽放原圖
  const [colorKey, setColorKey] = useState(null);
  const [custom, setCustom] = useState(null);    // 自選顏色的色碼
  const [preview, setPreview] = useState(null);  // 換色後的預覽圖(objectURL)
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const close = () => { if (!saving) onClose(); };
  useDialog(dialogRef, close);

  // 先拿原圖(自己加的衣服清單裡是縮圖,要讀 IndexedDB 的原圖)
  useEffect(() => {
    let live = true;
    fullImageOf(item).then((url) => { if (live) setSrc(url || item.image); });
    return () => { live = false; };
  }, [item]);

  // 點了顏色就做一張 600px 的預覽;晚回來的丟掉,關掉時放掉
  const runRef = useRef(0);
  const previewRef = useRef(null);
  useEffect(() => {
    if (!src || !hex) return undefined;
    const run = (runRef.current += 1);
    setBusy(true);
    setError("");
    makeStandInBlob(src, hex, 600)
      .then((blob) => {
        if (run !== runRef.current) return;
        if (previewRef.current) URL.revokeObjectURL(previewRef.current);
        previewRef.current = URL.createObjectURL(blob);
        setPreview(previewRef.current);
      })
      .catch(() => { if (run === runRef.current) setError("這張圖讀不到，換不了色。"); })
      .finally(() => { if (run === runRef.current) setBusy(false); });
    return undefined;
  }, [src, hex]);
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  const pick = (key) => { setColorKey(key); setHex(STAND_IN_COLORS[key].hex); };
  // 系統色盤拖的時候會連發 input 事件,等 120ms 沒動再算
  const customTimer = useRef(null);
  const pickCustom = (value) => {
    const next = normalizeHex(value);
    if (!next) return;
    setCustom(next);
    clearTimeout(customTimer.current);
    customTimer.current = setTimeout(() => { setColorKey(null); setHex(next); }, 120);
  };

  const apply = async () => {
    if (!src || !hex || busy || saving) return;
    setSaving(true);
    setError("");
    try {
      const blob = await makeStandInBlob(src, hex);
      await onApply(blob, hex, colorKey);
    } catch (cause) {
      console.error(cause);
      setError("換色失敗，這件沒有改。再按一次試試。");
      setSaving(false);
    }
  };

  const name = item.name || "這件";
  return createPortal(
    <div className="add-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div className="add-panel add-panel-review recolor-panel" role="dialog" aria-modal="true" aria-labelledby="recolor-title" ref={dialogRef}>
        <button type="button" className="add-close" onClick={close} aria-label="取消" disabled={saving}>
          <X size={20} weight="light" aria-hidden="true" />
        </button>
        <p id="recolor-title" className="add-step">換顏色：{name}</p>
        <div className={busy ? "recolor-preview is-busy" : "recolor-preview"}>
          {src && <img src={preview || src} alt={hex ? `${name}換色後的樣子` : `${name}現在的樣子`} draggable={false} />}
          {busy && <span className="recolor-preview-status" role="status">換色中…</span>}
        </div>
        <div className="recolor-swatches" role="group" aria-label="顏色">
          {Object.entries(STAND_IN_COLORS).map(([key, color]) => (
            <button key={key} type="button" className="quick-color" aria-pressed={colorKey === key} onClick={() => pick(key)} disabled={saving}>
              <span className="quick-dot" style={{ background: color.hex }} aria-hidden="true" />
              {color.label}
              {colorKey === key && <Check size={14} weight="bold" aria-hidden="true" />}
            </button>
          ))}
          <label className={colorKey === null && hex ? "quick-color recolor-custom is-on" : "quick-color recolor-custom"}>
            <span className={custom ? "quick-dot is-set" : "quick-dot"} style={custom ? { "--swatch": custom } : undefined} aria-hidden="true" />
            其他顏色
            <input type="color" value={custom || item.color || "#8e9094"} onInput={(event) => pickCustom(event.target.value)} onChange={(event) => pickCustom(event.target.value)} disabled={saving} aria-label="自選顏色" />
            {colorKey === null && hex && <Check size={14} weight="bold" aria-hidden="true" />}
          </label>
        </div>
        <small className="add-hint">
          整件一起換、留住明暗：有印花、撞色的會變成單一顏色，鞋底、扣環也跟著變。
          {item.isLocal ? "換上之後原本的顏色就回不來；要回來得再「換圖」。" : "換上之後可以在單品頁「換回原圖」。"}
          {item.standIn && item.isLocal ? " 代表款的品名會跟著改成新顏色。" : ""}
        </small>
        {error && <p className="add-field-error" role="alert">{error}</p>}
        <div className="add-actions">
          <button type="button" className="secondary-button" onClick={close} disabled={saving}>取消</button>
          <button type="button" className="primary-button" onClick={apply} disabled={!hex || busy || saving} aria-busy={saving}>{saving ? "換色中…" : "換上這個顏色"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
