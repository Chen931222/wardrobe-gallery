// 站的標誌(2026-10-24 本人選的「PAIR 鉤 THIS」:PAIR THIS 底下一條線折成衣架的肩膀,兩字中間長出鉤子,鉤子根部綁蝴蝶結)。
// public/brand/logo.svg:Cormorant 600 的字已轉成外框,不靠網頁字型;站上用 CSS mask 上色,淺色底是墨色、深色底自動變紙色。
// 主畫面圖示(apple-touch-icon.png、icon-192/512.png)和分頁小圖示(icon-64.png)是同一支衣架加橫桿,紙底
// (標誌那條線沒有橫桿,縮成小圖示會像人形,所以小圖示補上)。
// 重產:node work/logo-ribbon-hanger-2026-10-24/scripts/make-logo.mjs(要 Python 的 fonttools、brotli)。

/** 標誌:入口頂端、衣櫃和搭配頁左上、首頁圓環左上。圖裡的字是 PAIR THIS,中文名放在 aria-label 給讀螢幕的 */
export function Logo({ className = "" }) {
  return <span className={`logo ${className}`.trim()} role="img" aria-label="PairThis 搭這件" />;
}
