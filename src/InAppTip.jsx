// [本 fork 新增] 開在 LINE／IG／Threads 內建瀏覽器時,加衣服之前的提醒。
// 2026-11-04 從入口第一屏搬來:貼文點進來的人第一屏被這段佔掉、示範穿搭掉到下面,可是看示範用不到;要加衣服才用得到,所以在要加的那一刻才講。
// 放在新增視窗、代表款視窗、店裡比一下的存檔按鈕上面:加衣服的路都會經過這三個地方(換圖不放:換的是現有那件。匯入備份不放:手上已經有備份檔)。
import { useState } from "react";
import { inAppBrowser } from "./keepSafe.js";

export function InAppTip() {
  const [copied, setCopied] = useState("");
  const app = inAppBrowser();
  if (!app) return null;
  const here = window.location.origin;
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(here); setCopied("已複製，到 Safari 或 Chrome 貼上"); }
    catch { setCopied(`複製不了，手動輸入：${here.replace(/^https?:\/\//, "")}`); }
  };
  return (
    <p className="inapp-tip" role="note">
      你現在是在 {app} 裡面開的。在這裡加的衣服只存在 {app} 裡，之後用 Safari 或 Chrome 打開會是空的。
      先從 {app} 的選單選「用瀏覽器開啟」，再開始加。
      <span className="welcome-tip-actions">
        {/* LINE 認這個參數:帶著它的連結會改用手機的預設瀏覽器開 */}
        {app === "LINE" && <a href={`${here}/?openExternalBrowser=1`}>用瀏覽器開啟</a>}
        <button type="button" onClick={copyLink}>複製網址</button>
      </span>
      {copied && <span className="welcome-tip-status" role="status">{copied}</span>}
    </p>
  );
}
