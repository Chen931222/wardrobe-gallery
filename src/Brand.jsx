// 站的標誌(2026-10-23 本人選的 design.com 那張:衣架掛一件 T 恤的輪廓線,下面 PAIRTHIS、SINCE 2026)。
// 拿到的是預覽 PNG,不是向量:去掉格線底、只留線條當 alpha 遮罩(public/brand/logo-mask.png),
// 站上用 CSS mask 上色,淺色底是墨色、深色底自動變紙色。本人說之後會再改,所以不花工描成向量。
// 主畫面圖示(apple-touch-icon.png、icon-192/512.png)和分頁小圖示(icon-64.png)只取衣架＋T 恤那段,紙底。
// 重產:work/preview-2026-10-23-brand/scripts/design-com.py。

/** 標誌,入口頂端用。圖裡的字是 PAIRTHIS,中文名放在 aria-label 給讀螢幕的 */
export function Logo({ className = "" }) {
  return <span className={`logo ${className}`.trim()} role="img" aria-label="PairThis 搭這件" />;
}
