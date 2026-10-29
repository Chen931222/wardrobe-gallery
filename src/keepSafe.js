// [本 fork 新增] 訪客的衣服只存在這個瀏覽器裡:盡量不讓它不見,會不見之前先講清楚。
//
// 2026-10-05:網站給了好幾個朋友,「衣櫃不見」有三條常見的路:
//   1. 從 LINE／IG 點連結,其實是開在那個 app 自己的瀏覽器裡,之後用 Safari 開是空的;
//   2. iPhone 的 Safari 約一週沒開這個網站會清資料(加到主畫面的不會;persist() 在 Safari 上不一定給);
//   3. 清瀏覽資料、換手機。
// 這裡不上雲端,只做三件事:認出 app 內建瀏覽器、跟瀏覽器要「不要自動清」、加了新衣服沒備份就再提醒。
// 2026-10-29 加第四件:被清掉之後認得出來(noteCloset／wipedCloset),入口不再當他是新訪客。
const MARK_KEY = "open-wardrobe-backup-mark-v1";
const OLD_HINT_KEY = "open-wardrobe-keep-hint-v1";   // 舊版「知道了」只記一次,之後再也不提醒

/** 開在哪個 app 的內建瀏覽器裡(回 app 名);一般瀏覽器回 null。 */
export function inAppBrowser(ua = typeof navigator === "undefined" ? "" : navigator.userAgent) {
  if (/\bLine\//i.test(ua)) return "LINE";
  if (/Instagram/i.test(ua)) return "Instagram";
  if (/Barcelona/.test(ua)) return "Threads";
  if (/Messenger|MessengerForiOS|FB_IAB\/MESSENGER|Orca-Android/i.test(ua)) return "Messenger";
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "Facebook";
  if (/MicroMessenger/i.test(ua)) return "微信";
  return null;
}

export function isIos() {
  return typeof navigator !== "undefined"
    && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
}

/** 從主畫面打開的(iPhone 的主畫面版不受「一週沒開就清」影響)。 */
export function isStandalone() {
  return typeof window !== "undefined"
    && (window.navigator.standalone === true || Boolean(window.matchMedia?.("(display-mode: standalone)").matches));
}

/** 跟瀏覽器要「空間不夠時不要自動清這個網站」。給不給由瀏覽器決定,不會跳視窗(Firefox 例外)。 */
export function requestPersist() {
  try { navigator.storage?.persist?.().catch(() => {}); } catch { /* 沒這個 API 就算了 */ }
}

function readMark() {
  try {
    const mark = JSON.parse(localStorage.getItem(MARK_KEY) || "null");
    if (mark && typeof mark === "object") return { backedAt: mark.backedAt || null, snoozedAt: mark.snoozedAt || null };
    // 舊版按過「知道了」的:當成現在才按,之後再加新衣服會再提醒
    if (localStorage.getItem(OLD_HINT_KEY) === "1") {
      const migrated = { backedAt: null, snoozedAt: new Date().toISOString() };
      localStorage.setItem(MARK_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch { /* 讀不到就當沒備份過 */ }
  return { backedAt: null, snoozedAt: null };
}

function writeMark(patch) {
  try { localStorage.setItem(MARK_KEY, JSON.stringify({ ...readMark(), ...patch })); } catch { /* 存不了就下次再提醒 */ }
}

/** 剛匯出或剛匯入一份備份:手上有檔了。 */
export function markBackedUp() {
  writeMark({ backedAt: new Date().toISOString() });
  // 搭配頁「紀錄備份」匯出的也要讓 App 知道:提醒收起來、cookie 的「備份過」更新。以前只有提醒裡那顆會(驗收抓到:
  // 從搭配頁匯出又很久沒回來的人,被清掉後會被說「沒有匯出過備份」)
  if (typeof window !== "undefined") window.dispatchEvent(new Event("wardrobe-backed-up"));
}

/** 按了「知道了」:先不吵,再加幾件才提醒。 */
export function snoozeBackupHint() { writeMark({ snoozedAt: new Date().toISOString() }); }

/**
 * 該不該提醒留備份。
 * @param ownItems 自己加的衣服,代表款不算(要有 createdAt;代表款換成自己的圖的,看 photoAt)
 * @returns null 不用提醒;或 { fresh: 上次備份/按知道了之後新加的件數, backedUp: 備份過沒 }
 * 從沒備份也沒按過知道了:有 1 件就提醒;之後每新加 3 件再提醒一次。
 * 2026-10-29 起代表款不算:只點代表款的,不見了重點一次就回來;第一張自己拍的存好,才是值得留備份的時候。
 */
export function backupReminder(ownItems) {
  const { backedAt, snoozedAt } = readMark();
  const since = [backedAt, snoozedAt].filter(Boolean).sort().pop() || "";
  const fresh = ownItems.filter((item) => (item.photoAt || item.createdAt || "") > since).length;
  const need = since ? 3 : 1;
  return fresh >= need ? { fresh, backedUp: Boolean(backedAt) } : null;
}

/* 被清掉之後認得出來(2026-10-29)。Safari 清的是網站自己寫的資料(IndexedDB、localStorage…),衣服和下面這個本機標記一起不見;
   伺服器用 Set-Cookie 設的 cookie 不在那張清單裡(functions/keep.mjs 有出處)。
   衣櫃件數有變就報一次給伺服器記成 cookie,同一份也記在本機。之後「cookie 說上次有衣服、本機標記卻不見了」就是被清掉:
   自己把衣服刪光的,本機標記還在,不會誤認。換手機、無痕、連 cookie 一起清掉的,認不出來,照舊是歡迎畫面。 */
const HAD_KEY = "open-wardrobe-had-v1";
const HAD_COOKIE = /(?:^|;\s*)pt_had=(\d{1,4})\.(\d{1,4})\.([01])(?:;|$)/;

/** 衣櫃現在有幾件報給伺服器(跟上次報的一樣就不報)。own:自己加的;standIns:代表款。讀衣櫃失敗時不要叫,0 件會把 cookie 拿掉 */
export function noteCloset(own, standIns) {
  let last;
  try { last = localStorage.getItem(HAD_KEY); } catch { return; }
  const value = `${Math.min(own, 9999)}.${Math.min(standIns, 9999)}.${readMark().backedAt ? 1 : 0}`;
  if (value === last || (!last && !own && !standIns)) return;   // 沒變;或從來沒有過衣服
  fetch("/api/keep", { method: "POST", body: value, keepalive: true })
    .then((response) => { if (response.ok) localStorage.setItem(HAD_KEY, value); })
    .catch(() => { /* 沒網路就下次件數變了再報 */ });
}

/** 衣櫃被清掉了嗎:回 { own, standIns, backedUp }(上次報的件數),不是就回 null。只在自己的衣櫃空著時問 */
export function wipedCloset() {
  try { if (localStorage.getItem(HAD_KEY)) return null; } catch { return null; }
  const match = typeof document === "undefined" ? null : HAD_COOKIE.exec(document.cookie);
  return match ? { own: Number(match[1]), standIns: Number(match[2]), backedUp: match[3] === "1" } : null;
}

/** 這次被清掉,第一次看到復原頁嗎(重新整理不重記)。鍵名不用 open-wardrobe- 開頭:不進備份檔 */
export function firstSightOfWipe(had) {
  const value = `${had.own}.${had.standIns}.${had.backedUp ? 1 : 0}`;
  try {
    if (localStorage.getItem("pairthis-wipe-noted") === value) return false;
    localStorage.setItem("pairthis-wipe-noted", value);
  } catch { /* 存不了就每次都記 */ }
  return true;
}

/** 「重新開始」:cookie 拿掉,本機從 0 件算起;之後再加衣服照常報。
 *  伺服器回了才記本機標記:沒拿掉成功就讓下次打開再問一次,不然 cookie 留著舊件數,之後真的被清掉又講錯(驗收抓到) */
export function forgetWipe() {
  fetch("/api/keep", { method: "POST", body: "0.0.0", keepalive: true })
    .then((response) => { if (response.ok) localStorage.setItem(HAD_KEY, "0.0.0"); })
    .catch(() => {});
}
