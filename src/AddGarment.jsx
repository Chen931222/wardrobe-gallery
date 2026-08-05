// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
import { useRef, useState } from "react";
import { Plus, SpinnerGap, X } from "@phosphor-icons/react";
import { deleteLocalItem, dominantColor, guessPart, saveLocalItem, trimTransparent } from "./localWardrobe.js";

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

export function AddGarment({ onAdded }) {
  const inputRef = useRef(null);
  const [stage, setStage] = useState("idle"); // idle | working | review
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(null);

  const reset = () => {
    if (draft?.preview) URL.revokeObjectURL(draft.preview);
    setDraft(null);
    setStage("idle");
    setStatus("");
    setError("");
  };

  const handleFile = async (file) => {
    if (!file) return;
    setStage("working");
    setError("");
    setStatus("讀取照片…");
    try {
      const cut = await removeBg(file, setStatus);
      setStatus("修邊…");
      const { blob, width, height } = await trimTransparent(cut);
      const color = await dominantColor(blob);
      setDraft({
        id: `local-${Date.now()}`,
        blob,
        preview: URL.createObjectURL(blob),
        name: "",
        part: guessPart(width, height),
        color,
      });
      setStage("review");
      setStatus("");
    } catch (cause) {
      console.error(cause);
      setError("去背失敗,可能是照片太大或網路斷線。換一張試試,或改用離線流程處理。");
      setStage("idle");
    }
  };

  const save = async () => {
    await saveLocalItem({
      id: draft.id,
      name: draft.name.trim() || "新單品",
      part: draft.part,
      color: draft.color,
      tags: [],
      blob: draft.blob,
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
        onChange={(event) => { handleFile(event.target.files?.[0]); event.target.value = ""; }}
      />

      <button
        type="button"
        className="add-garment-button"
        onClick={() => inputRef.current?.click()}
        disabled={stage === "working"}
      >
        {stage === "working"
          ? <><SpinnerGap size={14} className="add-spinner" aria-hidden="true" /> 處理中</>
          : <><Plus size={14} weight="bold" aria-hidden="true" /> 新增</>}
      </button>

      {stage === "working" && (
        <div className="add-overlay" role="status" aria-live="polite">
          <div className="add-panel">
            <SpinnerGap size={30} className="add-spinner" aria-hidden="true" />
            <p>{status}</p>
            <small>第一次使用要下載去背模型,之後會快很多。</small>
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

            <label className="add-field">
              <span>名稱</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="例:白色帆布鞋"
                autoFocus
              />
            </label>

            <label className="add-field">
              <span>分類</span>
              <select
                value={draft.part}
                onChange={(event) => setDraft((current) => ({ ...current, part: event.target.value }))}
              >
                {PARTS.map((part) => <option key={part.id} value={part.id}>{part.label}</option>)}
              </select>
            </label>

            <div className="add-actions">
              <button type="button" className="secondary-button" onClick={reset}>取消</button>
              <button type="button" className="primary-button" onClick={save}>加入衣櫃</button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="add-error" role="alert">{error}</p>}
    </>
  );
}

export { deleteLocalItem };
