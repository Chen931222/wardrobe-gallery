// [本 fork 新增] 第一次打開、自己的衣櫃還空著時的歡迎畫面。
//
// 2026-10-05:舊版只有一段字和兩顆按鈕,看不出這個站能做什麼(成果都藏在「先看看示範」後面)。
// 現在直接放一套示範穿搭穿在人台上、配今天的天氣(城市可以選,預設台中),一眼看懂;再講清楚加兩件就能配出第一套。
// 示範用的是站主衣櫃的那一小份樣本(App 的 demoSample),不會多露出別的衣服。
import { useEffect, useMemo, useRef, useState } from "react";
import { SLOT_STYLE, Silhouette } from "./OutfitStudio.jsx";
import { fetchWeather, recommendOutfit } from "./recommend.js";
import { CitySelect, useCity } from "./CitySelect.jsx";

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
            src={item.image}
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
export function Welcome({ demoItems, onAdd, onDemo, onSync, onImportFile }) {
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
  const ios = typeof navigator !== "undefined"
    && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  const standalone = typeof window !== "undefined"
    && (window.navigator.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches);

  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <div className="welcome-copy">
        <h2 id="welcome-title">我的衣櫃</h2>
        <p>把自己的衣服拍照、或貼品牌的商品連結放進來,每天照你那邊的天氣配一套。</p>
        <p className="welcome-steps">先加<b>一件上衣</b>和<b>一件下身</b>,就能配出第一套。衣服只存在你這台裝置裡,別人看不到。</p>
        <div className="welcome-actions">
          <button type="button" className="primary-button" onClick={onAdd}>新增第一件</button>
          {!!demoItems.length && <button type="button" className="secondary-button" onClick={onDemo}>先看看示範</button>}
        </div>
        {ios && !standalone && (
          <p className="welcome-tip">
            用 iPhone 建議先按分享鈕 →「加入主畫面」,之後從主畫面打開再加衣服。只放在 Safari 裡久沒開,資料可能被系統清掉。
          </p>
        )}
        <p className="welcome-note">
          在別台同步過了?<button type="button" onClick={onSync}>輸入同步碼</button>
          <span aria-hidden="true"> · </span>
          有備份檔?<button type="button" onClick={() => fileRef.current?.click()}>匯入備份</button>
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
