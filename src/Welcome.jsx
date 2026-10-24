// [本 fork 新增] 第一次打開、自己的衣櫃還空著時的歡迎畫面。
//
// 2026-10-05:舊版只有一段字和兩顆按鈕,看不出這個站能做什麼(成果都藏在「先看看示範」後面)。
// 現在直接放一套示範穿搭穿在人台上、配今天的天氣(城市可以選,預設台中),一眼看懂;再講清楚加兩件就能配出第一套。
// 示範用的是站主衣櫃的那一小份樣本(App 的 demoSample),不會多露出別的衣服。
import { useEffect, useMemo, useRef, useState } from "react";
import { Silhouette } from "./OutfitStudio.jsx";
import { DOLL, MEASURED_SLOTS, SLOT_STYLE, cachedShape, placeGarment, shapeFromImage } from "./dollLayout.js";
import { fetchWeather, recommendOutfit } from "./recommend.js";
import { CitySelect, useCity } from "./CitySelect.jsx";
import { inAppBrowser, isIos, isStandalone } from "./keepSafe.js";
import { Feedback } from "./Feedback.jsx";
import { Logo } from "./Brand.jsx";
import { track } from "./analytics.js";

const FALLBACK_WEATHER = { temp: null, feelsLike: 25, desc: "", rainProb: 0, tMax: 27, tMin: 22 };

/** 一套穿搭穿在人台上,只看不能動。比例跟搭配頁同一把尺(src/dollLayout.js):圖載入時量身形,量好才顯示。 */
function MiniLook({ outfit }) {
  const [nats, setNats] = useState({});
  const [, setTick] = useState(0);
  return (
    <div className="mini-look" role="img" aria-label={`示範穿搭：${Object.values(outfit).filter(Boolean).map((item) => item.name).join("、")}`}>
      <Silhouette />
      {Object.entries(outfit).map(([slot, item]) => {
        if (!item || !SLOT_STYLE[slot] || slot === "socks") return null;
        const src = item.thumbnail || item.image;   // 人台只有 128–240px 寬,縮圖(長邊 460px)就夠;原圖一張 ~150KB,新訪客第一眼要下載四張
        const shape = cachedShape(slot, src);
        const p = placeGarment(slot, shape ?? null, typeof nats[item.id] === "object" ? nats[item.id] : undefined, null);
        const ready = nats[item.id] === "broken" || (Boolean(nats[item.id]) && (!MEASURED_SLOTS.includes(slot) || shape !== undefined));
        return (
          <img
            key={slot}
            className="studio-garment"
            src={src}
            alt=""
            draggable={false}
            crossOrigin="anonymous"
            onLoad={(event) => {
              const img = event.currentTarget;
              shapeFromImage(img, slot);
              setNats((current) => ({ ...current, [item.id]: { w: img.naturalWidth, h: img.naturalHeight } }));
              setTick((n) => n + 1);
            }}
            onError={() => setNats((current) => ({ ...current, [item.id]: "broken" }))}
            style={{
              left: `${(p.x / DOLL.w) * 100}%`, top: `${(p.y / DOLL.h) * 100}%`,
              width: `${(p.w / DOLL.w) * 100}%`, height: `${(p.h / DOLL.h) * 100}%`,
              zIndex: SLOT_STYLE[slot].z, opacity: ready ? undefined : 0, objectFit: "fill",
            }}
          />
        );
      })}
    </div>
  );
}

/* 往下捲的「怎麼用」三列(2026-10-23 本人:「像 Apple 官網那樣…隨著慢慢往下滾動,會帶出越來越多內容」)。
   借的是節奏(一列一件事、捲到才出現),不借特效:不鎖捲動、不用滾輪刷影片。
   影片是 _video-lab/films/pairthis-intro 錄的真實畫面(訪客從空衣櫃開始那條路),變速和示範衣櫃的標籤燒在畫面裡。
   每句都對過程式:城市是 city.js 的 CITIES(20 筆,從基隆到金門、馬祖;新竹、嘉義縣市各併一筆,所以不寫「20 個縣市」,驗收抓到);
   「缺的先借」是 App.jsx 的 firstLook(第一件才借);
   打一句話換要自己有上衣和下身(搭配頁講話只用自己的衣服,只有一件會回「還差下身」) */
// title 拆成幾段,只在段和段之間換行(手機窄欄會斷成「貼／商品連結」「打／一句話」,2026-10-23 截圖)
const STEPS = [
  { key: "add", title: ["網購過的，", "貼商品連結就好"], body: "挑一張商品圖，去背在這台裝置上算。讀不到圖的網站用截圖；沒有連結的，拍一張平放的。" },
  { key: "weather", title: ["照你那邊的天氣", "配一套，說為什麼"], body: "天氣照你選的城市，從基隆到金門、馬祖都有。第一件進櫃時，缺的先跟示範衣櫃借；配出來的那套會寫理由。" },
  { key: "talk", title: ["不喜歡，", "打一句話就換"], body: "像「上課，不要外套」。要先有自己的上衣和下身；還沒有的話，先在示範衣櫃試。" },
];

/** 一段循環短片:捲到看得見才播、捲走就停,省電也省流量(preload none,封面先頂著)。減少動態的人不自動播,給播放鈕。
 *  一直動超過 5 秒要能停(WCAG 2.2.2,驗收抓到):點一下影片(或 Tab 到按 Enter)暫停,再點繼續;自己停的不會因為捲回來又自己播 */
function StoryLoop({ name, label }) {
  const ref = useRef(null);
  const [still] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);
  heldRef.current = held;
  useEffect(() => {
    const video = ref.current;
    if (!video || still || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !heldRef.current) video.play().catch(() => {});
      else video.pause();
    }, { threshold: 0.4 });
    observer.observe(video);
    return () => observer.disconnect();
  }, [still]);
  const video = (
    <video
      ref={ref}
      className="story-video"
      src={`/media/loop-${name}.mp4`}
      poster={`/media/loop-${name}.jpg`}
      muted
      loop
      playsInline
      preload="none"
      controls={still}
      aria-label={label}
    />
  );
  if (still) return video;
  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (held) { setHeld(false); v.play().catch(() => {}); } else { setHeld(true); v.pause(); }
  };
  return (
    <button type="button" className="story-toggle" onClick={toggle} aria-pressed={held} aria-label={`${label}（${held ? "已暫停，按一下繼續播" : "按一下暫停"}）`}>
      {video}
      {held && <span className="story-paused" aria-hidden="true">已暫停</span>}
    </button>
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
  // 天氣到了才配,配一次就固定(不然每次重新 render 都換一套)。理由也留著:標題說「說為什麼」,示範就要真的說(最多三條)
  const idsKey = demoItems.map((item) => item.id).join("|");
  const look = useMemo(() => {
    if (!weather || !demoItems.length) return null;
    const result = recommendOutfit(demoItems, weather, {});
    // 引擎的句子是半形標點(全站還沒改),入口這頁都是全形,這裡換掉免得一頁兩種
    const fullWidth = (text) => text.replace(/,/g, "，").replace(/;/g, "；").replace(/:/g, "：");
    return result.error ? null : { outfit: result.outfit, reasons: (result.reasons || []).slice(0, 3).map(fullWidth) };
  }, [weather, idsKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  // 天氣抓不到時用的是假天氣(FALLBACK_WEATHER),那時的理由會講出假的體感,不顯示
  const realWeather = weather && weather.temp !== null;

  // iPhone 的 Safari(不是從主畫面開的):資料久沒用可能被系統清掉,而且主畫面版和 Safari 的資料是分開的,
  // 所以要在還沒加衣服的這個時候講,加完才搬就看不到了
  const ios = isIos();
  const standalone = isStandalone();
  // 從 LINE／IG 點連結進來的:其實開在那個 app 自己的瀏覽器裡,在這裡加的衣服 Safari 看不到。一樣要在加之前講
  const app = inAppBrowser();
  const here = typeof window === "undefined" ? "" : window.location.origin;
  const [copied, setCopied] = useState("");
  // 捲到才出現:一列進到畫面就加 is-in(只加一次)。沒有 IntersectionObserver 就全部直接顯示
  const storyRef = useRef(null);
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    const root = storyRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return undefined;
    setReveal(true);
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add("is-in"); observer.unobserve(entry.target); }
    }, { threshold: 0.25, rootMargin: "0px 0px -8% 0px" });
    root.querySelectorAll(".story-step").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  // 25 秒介紹:點了才載入、才播(有聲音;按鈕本身就是使用者的手勢,瀏覽器准有聲自動播)。
  // 按鈕換成播放器之後焦點移到播放器上,不然鍵盤使用者的焦點掉回 body(驗收)
  const [intro, setIntro] = useState(false);
  const introRef = useRef(null);
  useEffect(() => { if (intro) introRef.current?.focus(); }, [intro]);
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(here); setCopied("已複製，到 Safari 或 Chrome 貼上"); }
    catch { setCopied(`複製不了，手動輸入：${here.replace(/^https?:\/\//, "")}`); }
  };

  return (
    <section className="welcome" aria-labelledby="welcome-title">
      {/* 站名(2026-10-23 本人定):PairThis,中文「搭這件」;網址 pairthis.app、帳號 @pairthis.app 同名。
          同日本人「入口有點醜、沒有商標」:頂端放標誌(src/Brand.jsx,本人選的 design.com 那張),原本的第一段升成大字標題,
          示範穿搭放大。排版用 grid:桌機示範穿搭在右欄;手機依序是標題、第一步和按鈕、示範(按鈕要在第一屏)。
          標點改全形:半形逗號夾在中文裡會擠在一起,大字更明顯(站上其他頁還是半形,還沒改) */}
      <Logo className="welcome-logo" />
      {/* 入口的字(2026-10-22 本人「寫的太 AI」):不做條列、不做「兩個字加粗當標題」,就幾段講話,長短不齊。每句都是實測過的事,限制照講 */}
      <h2 id="welcome-title" className="welcome-lede">
        <span>把自己的衣服放進來，</span><span>它照你那邊的天氣配一套，</span><span>說為什麼。</span>
      </h2>

      {/* 第一步(2026-10-23 本人「讓入門者知道他們在做什麼」):原本按鈕排在三段說明後面,手機要捲才看得到。
          現在標題下面直接講按下去會發生什麼,再放按鈕。「加一件就配一套」是 App.jsx 的 firstLook(10-21 上線):
          缺的格子從示範衣櫃借;舊句「先加一件上衣、一件下身」從那天起就不對了 */}
      <div className="welcome-start">
        {/* 貼連結平常預設「想買」,但衣櫃還空著時預設「已經有了」(AddGarment.jsx closetEmpty,2026-10-23),
            這頁只在衣櫃空著時出現,所以不用叫人去點 */}
        <p className="welcome-steps">
          <span>加第一件就會配出一套，缺的先跟示範衣櫃借。</span>
          <span>網購過的貼商品連結，不用拍。</span>
          <span>沒有連結的，拍一張平放的。</span>
        </p>
        {app && (
          <p className="welcome-tip is-warning" role="note">
            你現在是在 {app} 裡面開的。在這裡加的衣服只存在 {app} 裡，之後用 Safari 或 Chrome 打開會是空的。
            先從 {app} 的選單選「用瀏覽器開啟」，再開始加。
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
            用 iPhone 建議先按分享鈕 →「加入主畫面」，之後從主畫面打開再加衣服。只放在 Safari 裡久沒開，資料可能被系統清掉。
          </p>
        )}
      </div>

      {/* 示範:人台穿一套,底下是它給的理由。理由是引擎真的算出來的(recommendOutfit 的 reasons),不是寫死的句子 */}
      {look && (
        <figure className="welcome-look">
          <MiniLook outfit={look.outfit} />
          <figcaption>
            <span className="welcome-look-when">{realWeather ? <><CitySelect /> {weather.temp}°，</> : ""}<span className="nowrap">{realWeather ? "示範衣櫃今天這樣穿" : "示範衣櫃的一套"}{realWeather && look.reasons.length ? "：" : ""}</span></span>
            {realWeather && look.reasons.length > 0 && (
              <ul className="welcome-look-why">{look.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            )}
          </figcaption>
        </figure>
      )}

      {/* 先講清楚的事:隱私、怎麼用、會錯的地方。放在按鈕和示範後面,想知道的人往下讀 */}
      <div className="welcome-copy">
        <p className="welcome-para">照片不會離開你的手機。去背是手機自己算的，沒有帳號，衣櫃就存在這台瀏覽器裡。</p>
        {/* 搭配頁講話只用自己的衣服(借來的不算),自己沒有上衣加下身會回「還差下身」 */}
        <p className="welcome-para">自己有一件上衣、一件下身之後，想換就用講的，<span className="nowrap">「上課，不要外套」</span>這樣。</p>
        <p className="welcome-para">會錯的地方先講：衣服是平放的照片，袖子不會垂。分類是猜的，猜錯了點一下改。</p>
        {/* 回報鈕獨立一行(2026-10-22 本人「放個訪客問題回報」):原本夾在下面那排連結裡,看不到 */}
        <p className="welcome-feedback">試了之後哪裡卡住，一句話就好：<Feedback where="歡迎" /></p>
      </div>

      {/* 頁腳:同步、備份、更新、隱私。一排小字,上面一條細線跟正文隔開。
          排在「怎麼用」那段上面(2026-10-24 驗收):換裝置要輸入同步碼、刪光衣服要找垃圾桶的人都從這排進去,
          放到最底要先捲過三列影片(1280×800 從 y930 掉到 3035) */}
      <p className="welcome-note">
        在別台同步過了？<button type="button" onClick={onSync}>輸入同步碼</button>
        <span aria-hidden="true"> · </span>
        有備份檔？<button type="button" onClick={() => fileRef.current?.click()}>匯入備份</button>
        {trashCount > 0 && onOpenTrash && (
          <>
            <span aria-hidden="true"> · </span>
            垃圾桶裡有 {trashCount} 件<button type="button" onClick={onOpenTrash}>打開</button>
          </>
        )}
        {onUpdates && (
          <>
            <span aria-hidden="true"> · </span>
            最近改了什麼？<button type="button" onClick={onUpdates}>看更新</button>
          </>
        )}
        <span aria-hidden="true"> · </span>
        <a href="/privacy.html">隱私與使用說明</a>
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

      <section ref={storyRef} className={reveal ? "welcome-story can-reveal" : "welcome-story"} aria-label="怎麼用">
        {STEPS.map((step) => (
          <div key={step.key} className="story-step">
            <div className="story-text">
              <h3>{step.title.map((part) => <span key={part} className="nowrap">{part}</span>)}</h3>
              <p>{step.body}</p>
            </div>
            <div className="story-media">
              <StoryLoop name={step.key} label={`示範畫面：${step.title.join("")}`} />
            </div>
          </div>
        ))}
        <div className="story-intro">
          {intro ? (
            <video ref={introRef} className="story-intro-video" src="/media/intro.mp4" poster="/media/intro.jpg" controls autoPlay playsInline aria-label="PairThis 搭這件 25 秒介紹" />
          ) : (
            <button type="button" className="story-intro-open" onClick={() => { setIntro(true); track("看介紹影片", { 頁: "入口" }); }}>
              <img src="/media/intro.jpg" alt="" loading="lazy" />
              <span>看 25 秒介紹<small>有聲音，點了才載入，約 1.6 MB</small></span>
            </button>
          )}
        </div>
      </section>
    </section>
  );
}
