// [本 fork 新增] 更新公告的面板。沿用同步的小視窗(.add-overlay + .sync-sheet),內容在 updates.js。
import { useEffect, useRef } from "react";
import { X } from "@phosphor-icons/react";
import { useDialog } from "./useDialog.js";
import { ScrollRail } from "./ScrollRail.jsx";
import { UPDATES, markUpdatesSeen, shortDate } from "./updates.js";

export function UpdatesSheet({ onClose }) {
  const ref = useRef(null);
  useDialog(ref, onClose);
  useEffect(() => { markUpdatesSeen(); }, []);
  const year = UPDATES[0].date.slice(0, 4);

  return (
    <>
      <div className="add-overlay" role="dialog" aria-modal="true" aria-labelledby="updates-title" ref={ref} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div className="sync-sheet updates-sheet">
          <button type="button" className="add-close" onClick={onClose} aria-label="關閉">
            <X size={20} weight="light" aria-hidden="true" />
          </button>
          <h2 id="updates-title">更新</h2>
          <p className="updates-lede">最近改了什麼,新的在上面。{year} 年。</p>
          <ol className="updates-list">
            {UPDATES.map((update) => (
              <li key={update.date}>
                <h3 className="updates-head">
                  <time dateTime={update.date}>{shortDate(update.date)}</time>
                  <span>{update.title}</span>
                </h3>
                <ul>
                  {update.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </li>
            ))}
          </ol>
          <p className="updates-foot"><a href="/privacy.html">隱私與使用說明</a> · 資料存在哪、會連到哪些服務、怎麼刪掉</p>
        </div>
      </div>
      <ScrollRail target={ref} />
    </>
  );
}
