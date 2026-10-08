// [本 fork 新增] 第一次打開、自己的衣櫃還空著時的歡迎畫面。
//
// 2026-10-05:舊版只有一段字和兩顆按鈕,看不出這個站能做什麼(成果都藏在「先看看示範」後面)。
// 現在直接放一套示範穿搭穿在人台上、配今天的天氣(城市可以選,預設台中),一眼看懂;再講清楚加兩件就能配出第一套。
// 示範用的是站主衣櫃的那一小份樣本(App 的 demoSample),不會多露出別的衣服。
import { useEffect, useMemo, useRef, useState } from "react";
import { SLOT_STYLE, Silhouette } from "./OutfitStudio.jsx";
import { fetchWeather, recommendOutfit } from "./recommend.js";
import { CitySelect, useCity } from "./CitySelect.jsx";
import { inAppBrowser, isIos, isStandalone } from "./keepSafe.js";

const FALLBACK_WEATHER = { temp: null, feelsLike: 25, desc: "", rainProb: 0, tMax: 27, tMin: 22 };

/** 一套穿搭穿在人台上,只看不能動。 */
function MiniLook({ outfit }) {
  return (
    <div className="mini-look" role="img" aria-label={`示範穿搭:${Object.values(outfit).filter(Boolean).map((item) => item.name).join("、")}`}>
      <Silhouette />
      {Object.entries(outfit).map(([slot, item]) => {
        const place = SLOT_STYLE[slot];
        if (!item || !place || slot === "socks") return null;
        return (
          <img
            key={slot}
            className="studio-garment"
            src={item.thumbnail || item.image /* 人台只有 128–240px 寬,縮圖(長邊 460px)就夠;原圖一張 ~150KB,新訪客第一眼要下載四張 */}
            alt=""
            draggable={false}
            style={{ left: `${place.left}%`, top: `${place.top}%`, width: `${place.width}%`, height: `${place.height}%`, zIndex: place.z }}
          />
        );
      })}
    </div>
  );
}

/**
 * @param demoItems 示範衣櫃的那份樣本(沒有就不畫示範穿搭)
 * @param onAdd / onDemo / onSync 三個出口;onImportFile(file) 匯入備份檔
 */
/** @param trashCount 垃圾桶裡有幾件(刪光了回到這裡,還要找得到);onOpenTrash 打開垃圾桶 */
export function Welcome({ demoItems, onAdd, onDemo, onSync, onImportFile, trashCount = 0, onOpenTrash = null, onUpdates = null }) {
  const fileRef = useRef(null);
  const [weather, setWeather] = useState(null);
  const city = useCity();
  useEffect(() => {
    let alive = true;
    fetchWeather().then((result) => { if (alive) setWeather(result); }).catch(() => { if (alive) setWeather(FALLBACK_WEATHER); });
    return () => { alive = false; };
  }, [city.key]);
  // 天氣到了才配,配一次就固定(不然每次重新 render 都換一套)
  const idsKey = demoItems.map((item) => item.id).join("|");
  const look = useMemo(() => {
    if (!weather || !demoItems.length) return null;
    const result = recommendOutfit(demoItems, weather, {});
    return result.error ? null : result.outfit;
  }, [weather, idsKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  // iPhone 的 Safari(不是從主畫面開的):資料久沒用可能被系統清掉,而且主畫面版和 Safari 的資料是分開的,
  // 所以要在還沒加衣服的這個時候講,加完才搬就看不到了
  const ios = isIos();
  const standalone = isStandalone();
  // 從 LINE／IG 點連結進來的:其實開在那個 app 自己的瀏覽器裡,在這裡加的衣服 Safari 看不到。一樣要在加之前講
  const app = inAppBrowser();
  const here = typeof window === "undefined" ? "" : window.location.origin;
  const [copied, setCopied] = useState("");
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(here); setCopied("已複製,到 Safari 或 Chrome 貼上"); }
    catch { setCopied(`複製不了,手動輸入:${here.replace(/^https?:\/\//, "")}`); }
  };

  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <div className="welcome-copy">
        <h2 id="welcome-title">我的衣櫃</h2>
        <p>把自己的衣服拍照、或貼品牌的商品連結放進來,每天照你那邊的天氣配一套。</p>
        <p className="welcome-steps">先加<b>一件上衣</b>和<b>一件下身</b>,就能配出第一套。衣服只存在你這台裝置裡,別人看不到。</p>
        {app && (
          <p className="welcome-tip is-warning" role="note">
            你現在是在 {app} 裡面開的。在這裡加的衣服只存在 {app} 裡,之後用 Safari 或 Chrome 打開會是空的。
            先從 {app} 的選單選「用瀏覽器開啟」,再開始加。
            <span className="welcome-tip-actions">
              {/* LINE 認這個參數:帶著它的連結會改用手機的預設瀏覽器開 */}
              {app === "LINE" && <a href={`${here}/?openExternalBrowser=1`}>用瀏覽器開啟</a>}
              <button type="button" onClick={copyLink}>複製網址</button>
            </span>
            {copied && <span className="welcome-tip-status" role="status">{copied}</span>}
          </p>
        )}
        <div className="welcome-actions">
          <button type="button" className="primary-button" onClick={onAdd}>新增第一件</button>
          {!!demoItems.length && <button type="button" className="secondary-button" onClick={onDemo}>先看看示範</button>}
        </div>
        {ios && !standalone && !app && (
          <p className="welcome-tip">
            用 iPhone 建議先按分享鈕 →「加入主畫面」,之後從主畫面打開再加衣服。只放在 Safari 裡久沒開,資料可能被系統清掉。
          </p>
        )}
        <p className="welcome-note">
          在別台同步過了?<button type="button" onClick={onSync}>輸入同步碼</button>
          <span aria-hidden="true"> · </span>
          有備份檔?<button type="button" onClick={() => fileRef.current?.click()}>匯入備份</button>
          {trashCount > 0 && onOpenTrash && (
            <>
              <span aria-hidden="true"> · </span>
              垃圾桶裡有 {trashCount} 件<button type="button" onClick={onOpenTrash}>打開</button>
            </>
          )}
          {onUpdates && (
            <>
              <span aria-hidden="true"> · </span>
              最近改了什麼?<button type="button" onClick={onUpdates}>看更新</button>
            </>
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
        </p>
      </div>

      {look && (
        <figure className="welcome-look">
          <MiniLook outfit={look} />
          <figcaption>
            {weather.temp !== null ? <><CitySelect /> {weather.temp}°,</> : ""}今天這樣穿
            <span className="welcome-look-items">示範衣櫃:{["wholebody_up", "upperbody", "lowerbody", "shoes"].map((slot) => look[slot]?.name).filter(Boolean).join(" / ")}</span>
          </figcaption>
        </figure>
      )}
    </section>
  );
}
