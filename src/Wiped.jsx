// [本 fork 新增] 衣櫃被瀏覽器清掉之後的入口(2026-10-29,本人:「好不容易拍好幾天的衣櫃,突然忘記就不見了,這樣很爛」)。
// 以前被清掉的人打開看到的是第一次來的歡迎畫面,會以為網站壞了或走錯站。怎麼認出來的見 src/keepSafe.js 的 wipedCloset。
// 這頁只講三件事:上次有幾件、最常見的原因、怎麼拿回來;拿不回來就照實講。主鈕照拿不拿得回來換:備份過的是「選備份檔」,沒備份過的是「重新開始」。原因不說死:cookie 只知道「不見了」,不知道是誰清的。
import { useRef } from "react";
import { Logo } from "./Brand.jsx";
import { isIos, isStandalone } from "./keepSafe.js";

/**
 * @param had { own, standIns, backedUp } 上次報給伺服器的件數
 * @param onImportFile(file) 選了備份檔(App 用跟歡迎畫面同一套匯入)
 * @param onQuickStart 重新點代表款
 * @param onRestart 沒有備份,當成新的開始(cookie 拿掉,換回歡迎畫面)
 */
export function Wiped({ had, onImportFile, onQuickStart, onRestart }) {
  const fileRef = useRef(null);
  const iosSafari = isIos() && !isStandalone();
  const total = had.own + had.standIns;
  const onlyStandIns = !had.own;
  const pickFile = () => fileRef.current?.click();

  return (
    <section className="wiped" aria-labelledby="wiped-title">
      <Logo className="wiped-logo" />
      <h2 id="wiped-title" className="wiped-title">
        {onlyStandIns
          ? <><span>上次點的 {had.standIns} 件代表款，</span><span>現在不在了。</span></>
          : <><span>上次這裡有 {total} 件衣服，</span><span>現在不在了。</span></>}
      </h2>

      <p className="wiped-why">
        {iosSafari
          ? "最常見的原因：iPhone 的 Safari 有一陣子沒開這個網站，會自動清掉它存的資料，衣服就存在裡面。"
          : "這個瀏覽器存的網站資料被清掉了，衣服就存在裡面。"}
      </p>

      {onlyStandIns ? (
        <>
          <p className="wiped-how">代表款不是你拍的，重點一次就回來，不到一分鐘。</p>
          <div className="wiped-actions">
            <button type="button" className="primary-button" onClick={onQuickStart}>重新點代表款</button>
            <button type="button" className="secondary-button" onClick={pickFile}>選備份檔</button>
          </div>
        </>
      ) : (
        <>
          <p className="wiped-how">
            {/* 檔名整段不斷行:iPhone 上會在連字號斷成「wardrobe-」「backup」兩行(2026-10-29 截圖) */}
            {had.backedUp
              ? <>你在這裡匯出或匯入過備份。檔名是 <span className="nowrap">wardrobe-backup</span> 開頭的 ZIP，{isIos() ? "通常在「檔案」app 的「下載項目」" : "通常在「下載」資料夾"}。選最新的那份，備份當時有的衣服都會回來。</>
              : "這裡之前沒有匯出過備份，這次救不回來。別的裝置匯出的備份檔也能用。"}
          </p>
          <div className="wiped-actions">
            {had.backedUp ? (
              <>
                <button type="button" className="primary-button" onClick={pickFile}>選備份檔</button>
                <button type="button" className="secondary-button" onClick={onRestart}>沒有備份，重新開始</button>
              </>
            ) : (
              <>
                <button type="button" className="primary-button" onClick={onRestart}>重新開始</button>
                <button type="button" className="secondary-button" onClick={pickFile}>我有備份檔</button>
              </>
            )}
          </div>
        </>
      )}

      {iosSafari && (
        <p className="wiped-tip">
          不想再被清：先從分享鈕「加入主畫面」，從主畫面打開，在那邊選備份檔或重新加。主畫面版不會被清。
        </p>
      )}
      {onlyStandIns && (
        <p className="wiped-skip"><button type="button" onClick={onRestart}>重新開始，看入口</button></p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="application/zip,.zip,application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onImportFile(file);
        }}
      />
    </section>
  );
}
