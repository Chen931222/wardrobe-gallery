// [本 fork 新增] 回報問題(2026-10-21,行銷企劃第 0 週)。一顆文字鈕、一個小視窗、一段字,送到 /api/feedback。
// 不收衣服、不收照片;送出的只有打的字、選填的聯絡方式、在哪一頁、瀏覽器的一句話(UA 前 160 字)。
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialog } from "./useDialog.js";
import { track } from "./analytics.js";

/** @param where 在哪一頁(入口、衣櫃、搭配),跟著送出,方便對照是哪一步卡住 */
export function Feedback({ where = "", className = "" }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState("idle");   // idle | sending | sent | error
  const [error, setError] = useState("");
  const dialogRef = useRef(null);
  const close = () => { if (state !== "sending") setOpen(false); };
  useDialog(dialogRef, close, { active: open });

  const send = async (event) => {
    event.preventDefault();
    if (!text.trim() || state === "sending") return;
    setState("sending");
    setError("");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), contact: contact.trim(), page: where, device: navigator.userAgent.slice(0, 160) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `回 ${response.status}`);
      setState("sent");
      setText("");
      track("回報", { 頁: where || "不明" });
    } catch (cause) {
      setState("error");
      setError(/還沒接上/.test(cause?.message) ? "回報功能還沒接上,先寄到 chenchen931222@gmail.com。" : `送不出去:${cause?.message || cause}`);
    }
  };

  return (
    <>
      <button type="button" className={`feedback-button ${className}`.trim()} onClick={() => { setOpen(true); if (state === "sent") setState("idle"); }}>
        哪裡卡住了？告訴我
      </button>
      {/* 視窗掛到 body:這顆鈕會放在 <p>(歡迎畫面的 note 行)裡,<div> 不能是 <p> 的子元素 */}
      {open && createPortal(
        <div className="add-overlay" role="dialog" aria-modal="true" aria-label="回報問題" ref={dialogRef}>
          <form className="add-panel feedback-panel" onSubmit={send}>
            <button type="button" className="add-close" onClick={close} aria-label="關閉">✕</button>
            <p className="add-step">哪裡卡住了？</p>
            <small className="add-hint">加衣服加到一半放棄、去背出來很醜、按了沒反應、看不懂哪一步,都寫。一句話就夠。只送你打的字,不送衣服和照片。</small>
            {state === "sent" ? (
              <p className="feedback-done" role="status">收到了,謝謝。改了會寫在「更新」裡。</p>
            ) : (
              <>
                <label className="add-field">
                  <span>發生什麼事</span>
                  <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    rows={4}
                    maxLength={1000}
                    placeholder="例:拍了一件白 T,去背後整件不見了"
                    autoFocus
                  />
                </label>
                <label className="add-field">
                  <span>想要回覆的話,留個聯絡方式(選填)</span>
                  <input value={contact} onChange={(event) => setContact(event.target.value)} maxLength={200} placeholder="Email、IG 或 Threads 帳號" autoComplete="off" />
                </label>
                {error && <p className="add-field-error" role="alert">{error}</p>}
                <div className="add-actions">
                  <button type="button" className="secondary-button" onClick={close}>取消</button>
                  <button type="submit" className="primary-button" disabled={!text.trim() || state === "sending"}>{state === "sending" ? "送出中…" : "送出"}</button>
                </div>
              </>
            )}
          </form>
        </div>,
        document.body,
      )}
    </>
  );
}
