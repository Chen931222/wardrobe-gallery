// [本 fork 新增] 訪客的衣服只存在這個瀏覽器裡:盡量不讓它不見,會不見之前先講清楚。
//
// 2026-10-05:網站給了好幾個朋友,「衣櫃不見」有三條常見的路:
//   1. 從 LINE／IG 點連結,其實是開在那個 app 自己的瀏覽器裡,之後用 Safari 開是空的;
//   2. iPhone 的 Safari 約一週沒開這個網站會清資料(加到主畫面的不會;persist() 在 Safari 上不一定給);
//   3. 清瀏覽資料、換手機。
// 這裡不上雲端,只做三件事:認出 app 內建瀏覽器、跟瀏覽器要「不要自動清」、加了新衣服沒備份就再提醒。
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
export function markBackedUp() { writeMark({ backedAt: new Date().toISOString() }); }

/** 按了「知道了」:先不吵,再加幾件才提醒。 */
export function snoozeBackupHint() { writeMark({ snoozedAt: new Date().toISOString() }); }

/**
 * 該不該提醒留備份。
 * @param localItems 自己在網頁加的衣服(要有 createdAt)
 * @returns null 不用提醒;或 { fresh: 上次備份/按知道了之後新加的件數, backedUp: 備份過沒 }
 * 從沒備份也沒按過知道了:有 1 件就提醒;之後每新加 3 件再提醒一次。
 */
export function backupReminder(localItems) {
  const { backedAt, snoozedAt } = readMark();
  const since = [backedAt, snoozedAt].filter(Boolean).sort().pop() || "";
  const fresh = localItems.filter((item) => (item.createdAt || "") > since).length;
  const need = since ? 3 : 1;
  return fresh >= need ? { fresh, backedUp: Boolean(backedAt) } : null;
}
