// [本 fork 新增] 第一次打開、自己的衣櫃還空著時的歡迎畫面。
//
// 2026-10-05:舊版只有一段字和兩顆按鈕,看不出這個站能做什麼(成果都藏在「先看看示範」後面)。
// 現在直接放一套示範穿搭穿在人台上、配今天的天氣(城市可以選,預設台中),一眼看懂;再講清楚加兩件就能配出第一套。
// 示範用的是站主衣櫃的那一小份樣本(App 的 demoSample),不會多露出別的衣服。
import { useEffect, useMemo, useRef, useState } from "react";
import { Silhouette, useMedia } from "./OutfitStudio.jsx";
import { DOLL, MEASURED_SLOTS, SLOT_STYLE, cachedShape, placeGarment, shapeFromImage } from "./dollLayout.js";
import { fetchWeather, recommendOutfit } from "./recommend.js";
import { CitySelect, useCity } from "./CitySelect.jsx";
import { inAppBrowser, isIos, isStandalone } from "./keepSafe.js";
import { Feedback } from "./Feedback.jsx";
import { Logo } from "./Brand.jsx";
import { track } from "./analytics.js";

const FALLBACK_WEATHER = { temp: null, feelsLike: 25, desc: "", rainProb: 0, tMax: 27, tMin: 22 };
// 理由裡引號框住的單品名整段換行,不從中間斷(「深藍連帽防風／外套」,2026-10-24 手機截圖)。
// 用 inline-block 不用 nowrap:一行放不下整個品名時才在品名裡面斷,不會撐出窄欄被切掉(320 寬的「駝色斜紋厚棉襯衫式外套」,驗收)
const keepQuotes = (text) => text.split(/(「[^」]+」)/).map((part, i) => (i % 2 ? <span key={i} className="keep-together">{part}</span> : part));

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
// 2026-10-24 本人「下面不知道怎麼區分」:三章各一種版式,不是同一個模子換左右。編號 01–03 是有理由的:三章是有順序的三步
const STEPS = [
  { key: "add", no: "01", title: ["網購過的，", "貼商品連結就好"], body: "挑一張商品圖，去背在這台裝置上算。讀不到圖的網站用截圖；沒有連結的，拍一張平放的。" },
  { key: "weather", no: "02", title: ["照你那邊的天氣", "配一套，說為什麼"], body: "天氣照你選的城市，從基隆到金門、馬祖都有。第一件進櫃時，缺的先跟示範衣櫃借；配出來的那套會寫理由。" },
  { key: "talk", no: "03", title: ["不喜歡，", "打一句話就換"], body: "要先有自己的上衣和下身；還沒有的話，先在示範衣櫃試。下面是示範衣櫃打一句話前後的兩套。" },
];
// 第二章旁邊的理由:影片裡那一格寫的全部六條(films/pairthis-intro/rec/marks.json 的 add_reason,錄影 2026-10-23 台中 23°、毛毛雨),
// 字照原文、標點換全形;從手機畫面裡拉出來排成字,手機上讀得到。不用入口上面那套今天的理由:跟影片對不起來(溫度、天氣不同)
const RECORDED_REASONS = [
  "第一件進櫃了。這套是你的「男女適穿 棉質圓領T恤(GU)」配示範衣櫃的 5 件挑的；再加幾件自己的，就能整套都用自己的。",
  "體感 23°，薄長袖或短袖都行",
  "有點涼，搭「深藍連帽防風外套」",
  "降雨 100%，記得帶傘",
  "會下雨，帆布、真皮的鞋先收著",
  "只有「深藍連帽防風外套」有顏色，其他低調色襯著它",
];
// 第三章前後對照:示範衣櫃實際配出來的兩套(work/preview-2026-10-23-brand/scripts/capture-talk.mjs,2026-10-24,台中 23°、體感 26°、降雨 100%)。
// 推薦有隨機,腳本重試到「今日推薦有外套」那次才存;人台上的 ✕ 和選取框截圖時藏起來;衣服和位置是 app 真的配出來的。理由是那次的原文。
// 照「上課」整套重挑,不只拿掉外套:上衣和下身也換了,註記照實寫
const TALK = {
  before: { src: "/media/talk-before.jpg", label: "今日推薦", why: "會下雨，加件「深藍連帽防風外套」" },
  // why 照 2026-10-24 修過的引擎改寫(同一個情況:26°、降雨 100%,外套是因為雨才加的,不是因為冷)
  after: { src: "/media/talk-after.jpg", label: "照這句挑之後", why: "照你說的不要外套；會下雨，本來會加件外套，怕淋濕就自己帶一件" },
  note: "示範衣櫃實際配出來的兩套，10 月 24 日台中體感 26°、降雨 100%。照「上課」整套重挑，外套拿掉，上衣和下身也跟著換。",
};

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
 *   onDemo(demo):demo = { outfit, daily } 是這頁配好的那套(天氣是假的時 daily 為 null);還沒配好時是 null
 */
/** @param trashCount 垃圾桶裡有幾件(刪光了回到這裡,還要找得到);onOpenTrash 打開垃圾桶 */
export function Welcome({ demoItems, onAdd, onDemo, onSync, onImportFile, trashCount = 0, onOpenTrash = null, onUpdates = null }) {
  const fileRef = useRef(null);
  const [weather, setWeather] = useState(null);
  const city = useCity();
  useEffect(() => {
    let alive = true;
    setWeather(null);   // 換城市:舊天氣先清掉,不然新的還沒回來時按示範,會把上一個城市的天氣帶進搭配頁(驗收抓到)
    fetchWeather().then((result) => { if (alive) setWeather(result); }).catch(() => { if (alive) setWeather(FALLBACK_WEATHER); });
    return () => { alive = false; };
  }, [city.key]);
  // 天氣到了才配,配一次就固定(不然每次重新 render 都換一套)。理由也留著:標題說「告訴你為什麼」,示範就要真的說(最多三條)
  const idsKey = demoItems.map((item) => item.id).join("|");
  const look = useMemo(() => {
    if (!weather || !demoItems.length) return null;
    const result = recommendOutfit(demoItems, weather, {});
    // 引擎的句子是半形標點(全站還沒改),入口這頁都是全形,這裡換掉免得一頁兩種
    const fullWidth = (text) => text.replace(/,/g, "，").replace(/;/g, "；").replace(/:/g, "：");
    // raw:引擎原本的句子(半形),帶進搭配頁用,那頁全是半形
    return result.error ? null : { outfit: result.outfit, reasons: (result.reasons || []).slice(0, 3).map(fullWidth), raw: result.reasons || [], details: result.details || [] };
  }, [weather, idsKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  // 天氣抓不到時用的是假天氣(FALLBACK_WEATHER),那時的理由會講出假的體感,不顯示
  const realWeather = weather && weather.temp !== null;
  // 帶進搭配頁的那套:天氣是假的就不帶理由(會講出假的體感)
  const demoPayload = () => (look ? { outfit: look.outfit, daily: realWeather ? { weather, reasons: look.raw, details: look.details } : null } : null);
  // 那套還沒配好就按(正式站按鈕出現後約 0.75 秒天氣才回來,驗收抓到):先記著,配好就帶進去;4 秒還沒好就照舊停在入口
  const [demoWanted, setDemoWanted] = useState(false);
  useEffect(() => {
    if (!demoWanted) return undefined;
    if (look) { setDemoWanted(false); onDemo(demoPayload()); return undefined; }
    const timer = setTimeout(() => { setDemoWanted(false); onDemo(null); }, 4000);
    return () => clearTimeout(timer);
  }, [demoWanted, look]);   // eslint-disable-line react-hooks/exhaustive-deps

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
    }, { threshold: 0.1, rootMargin: "0px 0px -8% 0px" });   // 0.25→0.1(2026-10-24 驗收):第 02 章高 1100–1200px,橫放手機那種矮視窗永遠到不了 25%,整章一直透明
    root.querySelectorAll(".story-step, .story-intro").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  // 25 秒介紹:點了才載入、才播(有聲音;按鈕本身就是使用者的手勢,瀏覽器准有聲自動播)。
  // 按鈕換成播放器之後焦點移到播放器上,不然鍵盤使用者的焦點掉回 body(驗收)
  const [intro, setIntro] = useState(false);
  const introRef = useRef(null);
  useEffect(() => { if (intro) introRef.current?.focus(); }, [intro]);
  // 示範:人台穿一套,旁邊是它給的理由。理由是引擎真的算出來的(recommendOutfit 的 reasons),不是寫死的句子。
  // 天氣還沒回來時先放空人台佔位:手機上示範排在按鈕前面,晚出現會把按鈕往下推 296px(驗收:天氣慢 2.5 秒時按鈕從 276 跳到 572)
  const demo = look ? (
    <figure className="welcome-look">
      <MiniLook outfit={look.outfit} />
      <figcaption>
        <span className="welcome-look-when">{realWeather ? <><CitySelect /> {weather.temp}°，</> : ""}<span className="nowrap">{realWeather ? "示範衣櫃今天這樣穿" : "示範衣櫃的一套"}{realWeather && look.reasons.length ? "：" : ""}</span></span>
        {realWeather && look.reasons.length > 0 && (
          <ul className="welcome-look-why">{look.reasons.map((reason) => <li key={reason}>{keepQuotes(reason)}</li>)}</ul>
        )}
      </figcaption>
    </figure>
  ) : !weather && demoItems.length > 0 ? (
    <figure className="welcome-look" aria-hidden="true">
      <div className="mini-look"><Silhouette /></div>
    </figure>
  ) : null;
  // 手機:示範在按鈕前面;桌機示範在右欄,DOM 放按鈕後面。DOM 跟著畫面換,不只靠 grid 搬:Tab 和讀屏的順序要跟眼睛看的一樣(驗收)。
  // LINE／IG 裡開的不管寬窄都是按鈕那塊先:「用瀏覽器開啟」要先看到
  const narrow = useMedia("(max-width: 760px)");
  const demoFirst = narrow && !app;
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(here); setCopied("已複製，到 Safari 或 Chrome 貼上"); }
    catch { setCopied(`複製不了，手動輸入：${here.replace(/^https?:\/\//, "")}`); }
  };

  return (
    <section className={app ? "welcome is-inapp" : "welcome"} aria-labelledby="welcome-title">
      {/* 站名(2026-10-23 本人定):PairThis,中文「搭這件」;網址 pairthis.app、帳號 @pairthis.app 同名。
          同日本人「入口有點醜、沒有商標」:頂端放標誌(src/Brand.jsx,本人選的 design.com 那張),原本的第一段升成大字標題,
          示範穿搭放大。排版用 grid:桌機示範穿搭在右欄;手機(2026-10-24 本人「看起來只是文字排版」)依序是
          標題、示範那套(一條米紙帶)、按鈕:講它做什麼 → 真的配一套給你看 → 開始。三樣在 393×700(iPhone Safari)和 375×548(SE)都在第一屏。
          從 LINE／IG 開的(is-inapp)例外,按鈕那塊排回示範前面:要先看到「用瀏覽器開啟」,不然衣服加在 LINE 裡。
          標點改全形:半形逗號夾在中文裡會擠在一起,大字更明顯(站上其他頁還是半形,還沒改) */}
      <Logo className="welcome-logo" />
      {/* 入口的字(2026-10-22 本人「寫的太 AI」):不做條列、不做「兩個字加粗當標題」,就幾段講話,長短不齊。每句都是實測過的事,限制照講 */}
      <h2 id="welcome-title" className="welcome-lede">
        <span>用你已有的衣服，</span><span>照今天的天氣搭一套，</span><span>告訴你為什麼。</span>
      </h2>

      {demoFirst && demo}

      {/* 按鈕(2026-10-23 本人「讓入門者知道他們在做什麼」)。
          標題下原本有三句「加第一件就會配出一套…／網購過的貼商品連結，不用拍／沒有連結的，拍一張平放的」,
          2026-10-24 本人「下面已經有介紹了,上面是不是就不需要」拿掉。意思都在下面:缺的先借在 02 章,貼連結是 01 章標題,
          拍平放的在 01 章內文(一字不差)。「不用拍」三個字這頁沒有了,在新增那頁的第一句;「加一件就配一套」加完第一件時 App 會講(firstLook 那條理由) */}
      <div className="welcome-start">
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
          <button type="button" className="primary-button" onClick={onAdd}>加入第一件衣服</button>
          {/* 2026-10-24(試用者:「打一句話就能改」藏太深):直接帶這頁那套進搭配,不再先停在衣服環繞的入口 */}
          {!!demoItems.length && <button type="button" className="secondary-button" onClick={() => (look ? onDemo(demoPayload()) : setDemoWanted(true))} disabled={demoWanted} aria-busy={demoWanted}>看看穿搭示範</button>}
        </div>
        {ios && !standalone && !app && (
          // 2026-10-24 縮成兩行(事實不變):手機上它排在示範和按鈕後面,三行時第三行掉出 iPhone 第一屏
          <p className="welcome-tip">
            iPhone 建議先從分享鈕「加入主畫面」，再從主畫面打開來加。只放在 Safari 久沒開，資料可能被系統清掉。
          </p>
        )}
      </div>

      {!demoFirst && demo}

      {/* 先講清楚的事:隱私、怎麼用、會錯的地方。放在按鈕和示範後面,想知道的人往下讀。
          2026-10-24 文案(本人「照你的修正版改」):「照片不會離開你的手機」說太滿,開了同步照片會加密上傳;
          「手機自己算」電腦上的人會卡住。限制照講,只拿掉「會錯的地方先講」那個開頭。
          同日再改:「要同步到別台時,上傳前會先加密」訪客讀了會以為自己能同步,其實同步只開給站主(SyncPanel 訪客只能輸入碼);
          改講訪客真的能做的:換手機用備份檔搬 */}
      <div className="welcome-copy">
        <p className="welcome-para">不用註冊，衣櫃存在這個瀏覽器裡。去背在你的裝置上算。換手機時用備份檔搬，同步還沒開放。</p>
        {/* 「用講的換一套」那段拿掉了(2026-10-24):下面第三章講同一件事,連條件「要先有自己的上衣和下身」都寫了,這裡講第二遍 */}
        <p className="welcome-para">穿搭預覽用的是平放的照片，穿起來的垂墜感會不一樣。分類是自動猜的，猜錯點一下就能改。</p>
        {/* 回報鈕獨立一行(2026-10-22 本人「放個訪客問題回報」):原本夾在下面那排連結裡,看不到 */}
        <p className="welcome-feedback">卡住的話，一句話就好：<Feedback where="歡迎" /></p>
        {/* 用過的人的入口:同步、備份、垃圾桶。排在「怎麼用」那段上面(2026-10-24 驗收):換裝置要輸入同步碼、
            刪光衣服要找垃圾桶的人都從這排進去,放到最底要先捲過三列影片(1280×800 從 y930 掉到 3035)。
            2026-10-24 第二版(試用者:「這排看起來像頁尾,以為整頁結束了」):拿掉細線、搬進這一欄接在回報那行下面,更新、隱私搬到真正的頁尾(最下面) */}
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

      <section ref={storyRef} className={reveal ? "welcome-story can-reveal" : "welcome-story"} aria-label="怎麼用">
        {/* 2026-10-24 本人「像 Apple 一樣有分層」:每段一整幅橫跨整頁的章節,底色紙／米紙交替、標題放大、影片放大左右交替;
            最後一章墨色底放 25 秒介紹。借的是章節的節奏,不做視差、不發光 */}
        {/* 2026-10-24 第二版:寬螢幕 960→1200;三章三種版式——01 字左影片右;02 影片左、字右,旁邊把影片裡的理由排成字;
            03 字在上,下面前後兩套人台夾著那句話。每章頂上一條墨色粗線＋大編號,像雜誌的章節頁。影片寬照視窗高度算,不會比螢幕高 */}
        {STEPS.map((step) => (
          <article key={step.key} className={`story-step story-${step.key}`}>
            <div className="story-inner">
              <span className="story-no" aria-hidden="true">{step.no}</span>
              <div className="story-text">
                <h3>{step.title.map((part) => <span key={part} className="nowrap">{part}</span>)}</h3>
                <p>{step.body}</p>
              </div>
              {step.key !== "talk" && (
                <div className="story-media">
                  <StoryLoop name={step.key} label={`示範畫面：${step.title.join("")}`} />
                </div>
              )}
              {step.key === "weather" && (
                <figure className="story-notes">
                  <figcaption>錄影那天，台中 23°、毛毛雨，它寫的是：</figcaption>
                  <ul>{RECORDED_REASONS.map((reason) => <li key={reason}>{keepQuotes(reason)}</li>)}</ul>
                </figure>
              )}
              {step.key === "talk" && (
                <figure className="story-pair">
                  <div className="story-pair-side story-pair-before">
                    <img src={TALK.before.src} alt={`${TALK.before.label}：有深藍連帽防風外套的一套`} loading="lazy" />
                    <p><b>{TALK.before.label}</b>{TALK.before.why}</p>
                  </div>
                  <p className="story-pair-cmd"><span className="nowrap">「上課，</span><span className="nowrap">不要外套」</span></p>
                  <div className="story-pair-side story-pair-after">
                    <img src={TALK.after.src} alt={`${TALK.after.label}：拿掉外套、換成上課穿的一套`} loading="lazy" />
                    <p><b>{TALK.after.label}</b>{TALK.after.why}</p>
                  </div>
                  <figcaption>{TALK.note}</figcaption>
                </figure>
              )}
            </div>
          </article>
        ))}
        <div className="story-intro">
          <div className="story-inner">
            <div className="story-text">
              <h3><span className="nowrap">25 秒，</span><span className="nowrap">從放進來到配好</span></h3>
              <p>有聲音，點了才載入，約 1.6 MB。畫面是真的在站上操作錄下來的。</p>
              {!intro && (
                <button type="button" className="story-intro-open" onClick={() => { setIntro(true); track("看介紹影片", { 頁: "入口" }); }}>看 25 秒介紹</button>
              )}
            </div>
            <div className="story-media story-media-intro">
              {intro ? (
                <video ref={introRef} className="story-intro-video" src="/media/intro.mp4" poster="/media/intro.jpg" controls autoPlay playsInline aria-label="PairThis 搭這件 25 秒介紹" />
              ) : (
                <img src="/media/intro.jpg" alt="" loading="lazy" />
              )}
            </div>
          </div>
        </div>
      </section>

      <footer className="welcome-foot">
        {onUpdates && (
          <>
            最近改了什麼？<button type="button" onClick={onUpdates}>看更新</button>
            <span aria-hidden="true"> · </span>
          </>
        )}
        <a href="/privacy.html">隱私與使用說明</a>
      </footer>
    </section>
  );
}
