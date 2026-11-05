// [本 fork 新增] 頁尾(2026-11-05 本人:隱私那些說明每一頁都要看得到,入口、裡面都要有)。
// 原本只在歡迎頁;抽出來,歡迎頁、衣服環、衣櫃、搭配共用一份。
import { Feedback } from "./Feedback.jsx";

/** @param where 回報時記是哪一頁 @param onUpdates 打開更新紀錄 @param className 各頁自己的位置 */
export function SiteFooter({ where = "", onUpdates = null, className = "" }) {
  return (
    <footer className={`site-foot ${className}`.trim()}>
      {onUpdates && (
        <>
          <button type="button" onClick={onUpdates}>更新紀錄</button>
          <span aria-hidden="true"> · </span>
        </>
      )}
      <a href="/privacy.html">隱私與使用說明</a>
      <span aria-hidden="true"> · </span>
      <Feedback where={where} label="意見回饋" />
      <span aria-hidden="true"> · </span>
      {/* 授權聲明和原始碼(2026-10-26):MIT、OFL 要附聲明;入口的天氣也在這頁寫出處 */}
      <a href="/licenses.html">授權與原始碼</a>
    </footer>
  );
}
