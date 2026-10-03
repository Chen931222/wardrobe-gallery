// [本 fork 新增] 用同步碼讓手機、平板、電腦看到同一個衣櫃。
//
// 同步的是「自己加的」:IndexedDB 裡的衣服(含想買的、去背圖)和下面 SYNC_KEYS 那幾份 localStorage
// (穿著紀錄、收藏、微調、對 104 件的編輯與隱藏)。站主那 104 件本來就在網站上,不用同步。
//
// 端對端加密:清單和圖都先在這裡用同步碼推出的金鑰(HKDF → AES-GCM)加密才上傳,雲端只有密文;
// 圖的編號用 HMAC,雲端也無從拿官方圖的雜湊去比對。同步碼一丟,雲端那份就沒人打得開——包括我們自己。
//
// 合併是三方的:手上這台、雲端、上次同步完的樣子(存在 BASE_KEY)。只有一邊改過就取那一邊;
// 兩邊都改過同一件時,剛輸入同步碼的那台讓雲端贏(加入別人的衣櫃),之後讓手上這台贏。
// 編輯、隱藏這類一整包 JSON 的,再往下一層逐項合,兩台各改不同件時不會互相蓋掉。

import { deleteLocalItem, putLocalRecord, readLocalRecord, readLocalRecords, shrinkImage } from "./localWardrobe.js";

const CODE_KEY = "open-wardrobe-sync-code";
const BASE_KEY = "open-wardrobe-sync-base-v2";     // v2 = 加密後;v1 的 base 用不同的圖編號,留著只會誤判
const OLD_BASE_KEY = "open-wardrobe-sync-base";
const LAST_KEY = "open-wardrobe-sync-last";
const NOTICE_KEY = "open-wardrobe-sync-notice";      // 這台被停掉時留一句話給同步面板
const STALE_KEY = "open-wardrobe-sync-stale";        // 換新碼後沒刪成功的舊碼:下次同步成功時再刪一次
const ERROR_KEY = "open-wardrobe-sync-error";        // 最近一次同步失敗的原因,成功就清掉;入口「同步」旁的小點看它(審查 F40)
const SYNC_KEYS = [
  "open-wardrobe-wearlog-v1", "open-wardrobe-looks-v1", "open-wardrobe-fit-v1",
  "open-wardrobe-edits-v1", "open-wardrobe-deleted-v1",
];
// 不同步「身上這套」(open-wardrobe-wearing-v1):搭配頁每換一件就寫一次,同步它會把免費寫入額度
// (每月 2,000 次)燒在試穿上,而且兩台各自試穿本來就不該互相干擾。
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* 私密瀏覽 */ }
}

export function newSyncCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => ALPHABET[byte % 32]).join("");
}
// NFKC:中文輸入法打出來的全形英數(ＡＢＣ１２)先換成半形,不然整組被當成不合法(審查 F62)
export const normalizeCode = (text) => String(text || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const formatCode = (code) => (code.match(/.{1,4}/g) || []).join("-");
export const isValidCode = (code) => /^[A-HJ-NP-Z2-9]{16}$/.test(code);

export const syncCode = () => storageGet(CODE_KEY);
export const lastSynced = () => storageGet(LAST_KEY);
export const syncNotice = () => storageGet(NOTICE_KEY);
export const lastSyncError = () => storageGet(ERROR_KEY);

export function setSyncCode(code) {
  storageSet(CODE_KEY, code);
  storageSet(BASE_KEY, null);       // 換一組碼 = 重新加入,沒有「上次同步」可比
  storageSet(OLD_BASE_KEY, null);
  storageSet(LAST_KEY, null);
  storageSet(NOTICE_KEY, null);
  storageSet(ERROR_KEY, null);
}
export function stopSync(notice = null) {
  setSyncCode(null);
  storageSet(NOTICE_KEY, notice);
}

/* ---------- 加密 ---------- */

const text = new TextEncoder();
const keyCache = new Map();

/** 同步碼 → 兩把金鑰:加解密用、算圖編號用。同步碼本身是 80 bits 亂數,HKDF 就夠,不必慢速雜湊。 */
function keysFor(code) {
  if (!keyCache.has(code)) {
    keyCache.set(code, (async () => {
      const raw = await crypto.subtle.importKey("raw", text.encode(code), "HKDF", false, ["deriveKey"]);
      const derive = (info, algorithm, usages) => crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: text.encode("open-wardrobe-sync-v2"), info: text.encode(info) },
        raw, algorithm, false, usages,
      );
      return {
        cipher: await derive("encrypt", { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]),
        mac: await derive("image-id", { name: "HMAC", hash: "SHA-256", length: 256 }, ["sign"]),
      };
    })());
  }
  return keyCache.get(code);
}

async function seal(keys, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, keys.cipher, bytes));
  const out = new Uint8Array(12 + sealed.length);
  out.set(iv);
  out.set(sealed, 12);
  return out;
}
async function open(keys, bytes) {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, keys.cipher, bytes.slice(12)));
  } catch {
    throw new Error("解不開雲端的資料,同步碼可能打錯了");
  }
}
const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const toBase64 = (bytes) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

/* ---------- 比對工具 ---------- */

const stable = (value) => JSON.stringify(value, (key, inner) => (
  inner && typeof inner === "object" && !Array.isArray(inner)
    ? Object.fromEntries(Object.keys(inner).sort().map((name) => [name, inner[name]]))
    : inner
));
const same = (a, b) => stable(a ?? null) === stable(b ?? null);

/** 這台現在的樣子。圖用 HMAC 編號代表,每次重算(換過圖就會不同,不靠記錄)。 */
async function entryOf(keys, { blob, ...meta }) {
  const img = blob ? hex(await crypto.subtle.sign("HMAC", keys.mac, await blob.arrayBuffer())) : null;
  return { entry: { meta, img, type: blob?.type || null }, blob };
}

async function snapshot(keys) {
  const items = {}, blobs = {};
  for (const record of await readLocalRecords()) {
    const { entry, blob } = await entryOf(keys, record);
    items[record.id] = entry;
    if (entry.img) blobs[entry.img] = blob;
  }
  const values = {};
  for (const key of SYNC_KEYS) {
    const value = storageGet(key);
    if (value !== null) values[key] = value;
  }
  return { items, keys: values, blobs };
}

/* 帶 id 的物件清單合併完,要照寫入那邊的規則排、截,不然下次存檔時兩邊對不上。
   收藏的穿搭見 OutfitStudio.jsx 的 saveLook:id 是 look-<Date.now()>、新的放最前面、只留 30 筆。
   沒列在這裡的清單照「手上這台的順序,再接雲端多出來的」,不截。 */
const idTime = (id) => Number(String(id).match(/(\d+)$/)?.[1]) || 0;
const LIST_RULES = {
  "open-wardrobe-looks-v1": { order: (a, b) => idTime(b.id) - idTime(a.id), limit: 30 },
};
const hasId = (x) => Boolean(x) && typeof x === "object" && !Array.isArray(x)
  && (typeof x.id === "string" || (typeof x.id === "number" && Number.isFinite(x.id)));
const byId = (list) => {
  const map = new Map();
  for (const x of list) if (hasId(x) && !map.has(x.id)) map.set(x.id, x);
  return map;
};

/* 兩邊都改過同一份 JSON 時往下一層合:物件逐欄、字串陣列取聯集再扣掉某一邊刪掉的,
   帶 id 的物件陣列(收藏的穿搭)以 id 做同一件事。storageKey 是 localStorage 的鍵,拿來查 LIST_RULES。 */
function mergeJsonText(local, base, remote, storageKey) {
  let l, b, r;
  try { l = JSON.parse(local); r = JSON.parse(remote); b = base == null ? null : JSON.parse(base); } catch { return local; }
  if (Array.isArray(l) && Array.isArray(r) && l.every((x) => typeof x !== "object") && r.every((x) => typeof x !== "object")) {
    const was = new Set(Array.isArray(b) ? b : []);
    const removed = new Set([...was].filter((x) => !l.includes(x) || !r.includes(x)));
    return JSON.stringify([...new Set([...l, ...r])].filter((x) => !removed.has(x)));
  }
  // 以前這種整份取手上這台:兩台各「收藏這套」,後推的那台會把另一台那筆整個蓋掉,沒有任何提示。
  // 現在跟字串陣列一樣:兩邊的都留,上次同步有、但某一邊已經拿掉的才算刪;
  // 同一筆兩邊都改過就手上這台贏(跟下面物件逐欄一樣)。沒有 id 的物件陣列合不了,照舊取手上這台。
  if (Array.isArray(l) && Array.isArray(r) && l.every(hasId) && r.every(hasId)) {
    const mine = byId(l), theirs = byId(r);
    const was = Array.isArray(b) ? byId(b) : new Map();
    const out = [];
    for (const id of new Set([...mine.keys(), ...theirs.keys()])) {
      const lx = mine.get(id), rx = theirs.get(id), bx = was.get(id);
      if (was.has(id) && (!lx || !rx)) continue;        // 某一邊刪了(含存滿 30 筆被擠掉的)
      out.push(!lx ? rx : !rx ? lx
        : same(lx, bx) ? rx                              // 只有雲端改過這一筆
        : lx);
    }
    const rule = LIST_RULES[storageKey];
    if (!rule) return JSON.stringify(out);
    return JSON.stringify(out.sort(rule.order).slice(0, rule.limit));   // sort 是穩定的,同一毫秒照上面的順序
  }
  if (isPlain(l) && isPlain(r)) return JSON.stringify(mergeFields(l, isPlain(b) ? b : {}, r));
  return local;
}

const isPlain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/* 物件逐欄三方合併。同一欄兩邊都改了、而且兩邊都是物件時(edits 裡同一件衣服:一台改名、一台改顏色),
   再往下一層逐欄合,不讓後存的那台整件蓋掉另一台;真的同一欄兩邊都改了才是手上這台贏。
   base 裡沒有這件(兩台都是第一次改它)時,把「沒改過」(空物件)當底:edits 只記改過的欄位
   (App 的 persistEdit,2026-10-03 起),所以一台只有 name、一台只有 color,兩欄都留得住。 */
function mergeFields(l, was, r) {
  const out = {};
  for (const name of new Set([...Object.keys(l), ...Object.keys(r), ...Object.keys(was)])) {
    let pick;
    if (same(l[name], r[name])) pick = l[name];
    else if (same(l[name], was[name])) pick = r[name];
    else if (same(r[name], was[name])) pick = l[name];
    else if (isPlain(l[name]) && isPlain(r[name]) && (isPlain(was[name]) || was[name] === undefined)) pick = mergeFields(l[name], was[name] || {}, r[name]);
    else pick = l[name];
    if (pick !== undefined) out[name] = pick;
  }
  return out;
}

/** 三方合併一個表。回傳合併結果,以及哪些要寫回這台。 */
function merge3(local, base, remote, { remoteWins, deep }) {
  const result = {}, pull = [];
  for (const id of new Set([...Object.keys(local), ...Object.keys(base), ...Object.keys(remote)])) {
    const l = local[id], b = base[id], r = remote[id];
    let pick;
    if (same(l, r)) pick = l;
    else if (same(l, b)) pick = r;
    else if (same(r, b)) pick = l;
    else if (deep && l !== undefined && r !== undefined) pick = mergeJsonText(l, b, r, id);
    else pick = remoteWins ? r : l;
    if (pick !== undefined) result[id] = pick;
    if (!same(pick, l)) pull.push(id);
  }
  return { result, pull };
}

/* ---------- 網路 ---------- */

class SyncGone extends Error {}

/* 一次同步裡,這台少了這麼多件「雲端還有」的衣服,就先停下來問:可能是真的刪了,
   也可能是瀏覽器把資料清掉了。問過才決定推刪除(push)還是從雲端拿回來(restore)。 */
const MASS_DELETE = 3;
/* 只看件數會漏掉小衣櫃:自己加的只有 1–2 件時,IndexedDB 被瀏覽器單獨清掉(空間不足被逐出、資料庫壞掉,
   localStorage 和同步碼還在),少的件數不到門檻就不問,直接把「全刪」推到雲端和每一台,連圖一起救不回來。
   所以「上次同步過的衣服,這台一件都不剩」卻要推出刪除,也一律先問。不只看「這台現在 0 件」:
   清掉之後、第一次同步成功之前(例如離線)又加了一件,這台就不是 0 件,但同步過的還是全不見了。
   代價是真的刪掉最後一件時會多問一次;問的時候按「取消」(或背景中瀏覽器直接回 false)
   走的是從雲端拿回來,是安全的那一邊。 */
const askBeforeDeleting = (leaving, syncedLeft) => leaving >= MASS_DELETE || (leaving > 0 && syncedLeft === 0);
/* 這次打開網站後,使用者自己按「刪除」也確認過的衣服,不用再問一次:5 秒內刪 3 件,三個「確定刪除」之後
   又跳第四個「這台少了 3 件」,按取消三件全部回來(審查 F41)。只記在記憶體,重新整理就忘,忘了就照舊問。 */
const deliberate = new Set();
export function noteDeliberateDelete(id) { deliberate.add(id); }
class MassDelete extends Error {
  constructor(count) {
    super(`這台少了 ${count} 件自己加的衣服,先不同步。`);
    this.count = count;
  }
}

async function api(code, { method = "GET", img, body, type, parent } = {}) {
  const url = img ? `/api/sync?img=${img}` : "/api/sync";
  try {
    return await fetch(url, {
      method,
      headers: {
        "X-Sync-Code": code,
        ...(parent ? { "X-Sync-Parent": parent } : {}),
        ...(type ? { "Content-Type": type } : {}),
      },
      body,
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    // 斷線時瀏覽器只給「Failed to fetch」(Safari 是「Load failed」),面板上直接露出英文(審查 F60)
    if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new Error("網路太慢,同步逾時;等一下會自動再試");
    throw new Error(typeof navigator !== "undefined" && navigator.onLine === false
      ? "現在沒有網路;改動留在這台,有網路時會自動補上"
      : "連不上同步服務;改動留在這台,等一下會自動再試");
  }
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (response.status === 403 && data.reason === "unknown-space") throw new SyncGone(data.error);
  if (!response.ok && response.status !== 409) throw new Error(data.error || `同步服務回 ${response.status}`);
  return data;
}

/** 在雲端開一個新空間。parent 是手上這組舊碼(換新碼時);第一次開通不用。 */
async function openSpace(code, parent) {
  await readJson(await api(code, { method: "POST", parent }));
}

/** 這台跟上次同步比有沒有改過(不連網,用來決定要不要上傳)。 */
export async function hasLocalChanges() {
  const code = syncCode();
  const base = JSON.parse(storageGet(BASE_KEY) || "null");
  if (!code || !base) return Boolean(code);
  const { items, keys } = await snapshot(await keysFor(code));
  return !same(items, base.items) || !same(keys, base.keys);
}

let running = null;
let rotating = null;   // 換新碼進行中;這段時間叫的同步排在它後面,換好之後用新碼跑
let timer = null;
let changedWhileRunning = false;   // 同步跑的時候使用者又改了東西

/**
 * 跑一次同步,跑完發 wardrobe-synced 事件(detail: { pulled, pushed, keysChanged, keys, error, stopped, at }),
 * App 和搭配頁聽到就重讀各自的資料(不整頁重新整理);同一時間只跑一個,再叫一次會等前一個結束。
 */
export function syncNow(options = {}) {
  // 換碼途中叫的(切回前景、5 秒後推、問完大量刪除的選擇):等換完再照原本的要求跑,不能拿換碼那份結果交差
  if (rotating) return rotating.then(() => syncNow(options));
  if (!running) {
    running = runSync(options)
      .then((result) => ({ ...result, error: null }))
      .catch((error) => {
        if (error instanceof SyncGone) {
          // 碼被換掉或雲端被刪了:這台停下來,不要每次切回來都白打一次
          stopSync("這組同步碼已經失效(換了新碼,或雲端那份被刪了)。要繼續,到另一台按「看同步碼」,用新碼重新加入。");
          return { pulled: 0, pushed: 0, keysChanged: false, error: syncNotice(), stopped: true };
        }
        if (error instanceof MassDelete) {
          return { pulled: 0, pushed: 0, keysChanged: false, error: error.message, pendingDeletes: error.count };
        }
        return { pulled: 0, pushed: 0, keysChanged: false, error: error?.message || String(error) };
      })
      .then((result) => {
        // 停掉的有 NOTICE_KEY 講;要問刪除的不算失敗(問完就會再同步)
        if (!result.error) storageSet(ERROR_KEY, null);
        else if (!result.stopped && !result.pendingDeletes && syncCode()) storageSet(ERROR_KEY, result.error);
        window.dispatchEvent(new CustomEvent("wardrobe-synced", { detail: { ...result, at: lastSynced() } }));
        return result;
      })
      .finally(() => {
        running = null;
        if (changedWhileRunning) { changedWhileRunning = false; scheduleSync(); }
      });
  }
  return running;
}

/** 等手上這一輪跑完,再單獨跑一件事(換新碼)。不丟錯,錯誤放在 error 裡,跟 syncNow 一樣。 */
async function exclusive(work) {
  while (running) await running;
  rotating = work()
    .then((result) => ({ ...result, error: null }))
    .catch((error) => ({ error: error?.message || String(error) }))
    .finally(() => { rotating = null; });
  return rotating;
}

/** 衣服剛改過:等 5 秒再同步,連續改好幾件只傳一次。同步自己寫回這台時不算。 */
export function scheduleSync(event) {
  if (!syncCode() || event?.detail?.fromSync) return;   // 同步自己把別台的衣服寫進來,不算這台改的
  // 同步中改的,等這一輪結束再排一次,不然要等下次切到背景才推得上去
  if (running) { changedWhileRunning = true; return; }
  clearTimeout(timer);
  timer = setTimeout(() => { timer = null; syncNow(); }, 5000);
}

/** 第一台:開通一個新空間,把這台的衣櫃傳上去。 */
export async function startSync() {
  const code = newSyncCode();
  await openSpace(code);
  setSyncCode(code);
  return syncNow();
}

/** 其他台:用另一台的碼加入。碼不對就不留在這台。 */
export async function joinSync(code) {
  setSyncCode(code);
  const result = await syncNow();
  if (!result.error) return result;
  stopSync();
  return { ...result, error: result.stopped ? "找不到這組同步碼,再對一次(或另一台已經換了新碼)" : result.error };
}

/**
 * 換新碼:用舊碼開一個新空間、整個衣櫃傳過去、再刪掉舊空間。
 * 外流的舊碼從此打不開任何東西;其他裝置下次同步會被停下,要輸入新碼。
 */
export async function rotateCode() {
  const old = syncCode();
  if (!old) throw new Error("這台還沒開始同步");
  const first = await syncNow();                     // 先把舊空間的最新內容拿下來,換碼時才不會漏
  if (first.error) throw new Error(first.error);
  const next = newSyncCode();
  await openSpace(next, old);
  // 先用新碼把整個衣櫃傳上去、確定成功,才把這台換成新碼,最後才刪舊的。舊版先換碼再傳:剛好在那一秒斷線,
  // 這台換到新碼(雲端是空的)、其他台留在舊空間,兩邊都顯示正常,從此各同步各的(審查 F6)
  const moved = await exclusive(async () => {
    const result = await runSync({ code: next });
    // 換碼和存「上次同步」跟上傳放在同一段:排隊等著的同步一開始跑,用的就已經是新碼
    setSyncCode(next);
    storageSet(BASE_KEY, JSON.stringify(result.base));
    storageSet(LAST_KEY, new Date().toISOString());
    return result;
  });
  if (moved.error) throw new Error(`換碼沒成功,這台還在用舊碼:${moved.error}`);
  // 舊空間刪不掉(斷線)的話,其他台會繼續用舊碼同步、跟這台分家;記下來,下次同步成功時再刪一次
  try {
    await readJson(await api(old, { method: "DELETE" }));
  } catch (error) {
    if (!(error instanceof SyncGone)) storageSet(STALE_KEY, old);
  }
  return next;
}

/** 刪掉雲端那份,這台也停止同步。衣服都還在這台。 */
export async function deleteCloud() {
  const code = syncCode();
  if (!code) return;
  await readJson(await api(code, { method: "DELETE" }));
  stopSync();
}

/* 雲端一張圖最多 3MB(_sync-core.mjs 的 MAX_IMAGE)。超過的那張每次都回 413,同一批的小件也跟著上不去,
   面板卻還寫「上次同步」(審查 F5)。同步前先把傳不上去的圖縮小、寫回這台,之後算的圖編號就是縮過的那張。
   只縮真的超過上限的:2.5–3MB 的照傳,不然每台各自重新壓一次,同一件會變成兩台都改過。 */
const UPLOAD_LIMIT = 3 * 1024 * 1024 - 64;   // 加密多 28 bytes,留一點
async function shrinkOversized() {
  for (const record of await readLocalRecords()) {
    if (!record.blob || record.blob.size <= UPLOAD_LIMIT) continue;
    try {
      const blob = await shrinkImage(record.blob);
      if (!blob || blob.size >= record.blob.size) continue;
      // 縮圖要花幾百毫秒:這段時間裡被刪掉或改過的,不拿舊的那份寫回去
      const now = await readLocalRecord(record.id);
      if (!now || now.blob?.size !== record.blob.size || stable({ ...now, blob: null }) !== stable({ ...record, blob: null })) continue;
      await putLocalRecord({ ...now, blob }, { fromSync: true });
    } catch { /* 這張縮不了就照原樣,上傳時遇到 413 會講是哪一件 */ }
  }
}

/** 換碼時沒刪成功的舊空間,這次再刪一次;已經不在(403)也算刪好了。斷線就留到下次 */
async function removeStaleSpace(code) {
  const stale = storageGet(STALE_KEY);
  if (!stale || stale === code) return;
  try {
    await readJson(await api(stale, { method: "DELETE" }));
    storageSet(STALE_KEY, null);
  } catch (error) {
    if (error instanceof SyncGone) storageSet(STALE_KEY, null);
  }
}

/**
 * @param {{ deletes?: "push" | "restore", code?: string }} options
 *   deletes 問過使用者之後才帶:一次少很多件時要推刪除還是拿回來。
 *   code 換新碼時用:把這台整份傳到這組碼的新空間;不讀也不寫這台的同步紀錄,新的「上次同步」交給呼叫端存。
 */
async function runSync(options = {}) {
  const detached = Boolean(options.code);
  const code = options.code || syncCode();
  if (!code) return { pulled: 0, pushed: 0, keysChanged: false };
  const keys = await keysFor(code);
  let pulled = 0, pushed = 0, keysChanged = false;
  await shrinkOversized();
  const uploaded = new Set();   // 409 重來時,上一輪已經傳上去的圖不再傳(審查 F68;伺服器不會刪還沒進清單的圖)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const saved = detached ? null : JSON.parse(storageGet(BASE_KEY) || "null");
    const joining = !saved && !detached;
    const base = saved ? { ...saved, items: { ...saved.items } } : { items: {}, keys: {} };
    const cloud = await readJson(await api(code));
    // 加密前的舊格式(沒有 data)當作空的:這台的東西全部以密文重傳,伺服器會順手刪掉舊的明文圖
    const remote = cloud.data
      ? JSON.parse(new TextDecoder().decode(await open(keys, fromBase64(cloud.data))))
      : { items: {}, keys: {} };
    const rev = cloud.rev || 0;
    const mine = await snapshot(keys);

    // 上次同步還在、這台現在沒有、雲端也還有 = 這台要推出去的刪除
    const leaving = Object.keys(base.items).filter((id) => !mine.items[id] && remote.items?.[id]);
    const syncedLeft = Object.keys(base.items).filter((id) => mine.items[id]).length;
    const unasked = leaving.filter((id) => !deliberate.has(id));   // 剛剛自己按刪除、確認過的不再問
    if (askBeforeDeleting(unasked.length, syncedLeft) && options.deletes !== "push") {
      if (options.deletes !== "restore") throw new MassDelete(unasked.length);
      for (const id of unasked) delete base.items[id];   // 當作沒同步過這幾件:合併時雲端那份會被拿回來
    }

    const items = merge3(mine.items, base.items, remote.items || {}, { remoteWins: joining });
    const values = merge3(mine.keys, base.keys, remote.keys || {}, { remoteWins: joining, deep: true });

    // 1) 先把要上傳的圖傳上去,清單才不會指到雲端沒有的圖
    let savedRev = rev;
    const changed = !cloud.data || !same(items.result, remote.items || {}) || !same(values.result, remote.keys || {});
    if (changed) {
      const cloudImages = new Set(cloud.imgs || []);
      for (const entry of Object.values(items.result)) {
        if (!entry.img || cloudImages.has(entry.img) || uploaded.has(entry.img) || !mine.blobs[entry.img]) continue;
        const sealed = await seal(keys, new Uint8Array(await mine.blobs[entry.img].arrayBuffer()));
        const response = await api(code, { method: "PUT", img: entry.img, body: sealed, type: "application/octet-stream" });
        if (response.status === 413) throw new Error(`「${entry.meta.name || "一件衣服"}」的圖太大,傳不上去;刪掉重新加一次`);
        await readJson(response);
        cloudImages.add(entry.img);
        uploaded.add(entry.img);
      }
      const data = toBase64(await seal(keys, text.encode(JSON.stringify({ items: items.result, keys: values.result }))));
      const imgs = [...new Set(Object.values(items.result).map((entry) => entry.img).filter(Boolean))];
      const response = await api(code, { method: "PUT", type: "application/json", body: JSON.stringify({ baseRev: rev, imgs, data }) });
      if (response.status === 409) continue;          // 另一台剛寫過:用新的雲端重新合一次
      savedRev = (await readJson(response)).rev;
      pushed += 1;
    }

    // 2) 寫回這台。寫入時帶 fromSync,發出的 wardrobe-local-change 才不會被當成這台改的。
    //    寫之前先重讀這件:網路來回那幾秒裡這台改過或刪過它,就不寫回(不蓋掉剛做的),
    //    上次同步的底留這台原本那份,下一輪三方合併再處理。
    const skipped = [];
    for (const id of items.pull) {
      const entry = items.result[id];
      const current = await readLocalRecord(id).catch(() => { throw new Error("讀不到這台存的衣服,先不同步(免得把雲端當成全刪了)"); });
      const now = current ? (await entryOf(keys, current)).entry : undefined;
      if (!same(now, mine.items[id])) { skipped.push(id); changedWhileRunning = true; continue; }
      if (!entry) { await deleteLocalItem(id, { fromSync: true }); pulled += 1; continue; }
      let blob = entry.img ? mine.blobs[entry.img] : null;
      if (entry.img && !blob) {
        const response = await api(code, { img: entry.img });
        if (!response.ok) throw new Error(`下載「${entry.meta.name || id}」的圖失敗`);
        const plain = await open(keys, new Uint8Array(await response.arrayBuffer()));
        blob = new Blob([plain], { type: entry.type || "image/png" });
      }
      await putLocalRecord({ ...entry.meta, blob }, { fromSync: true });
      pulled += 1;
    }
    for (const key of values.pull) {
      // 網路來回那幾秒裡這台又改了這個鍵(剛按收藏、今天穿這套、存了名稱):把剛改的跟合併結果再合一次,
      // 直接寫回會把它蓋掉。下一次同步看到這台跟上次同步的不同,就會推上去。
      const now = storageGet(key);
      const before = mine.keys[key] ?? null;
      const merged = values.result[key] ?? null;
      storageSet(key, now === before || now === null || merged === null ? merged : mergeJsonText(now, before, merged, key));
      keysChanged = true;
    }

    const baseItems = { ...items.result };
    for (const id of skipped) {
      if (mine.items[id]) baseItems[id] = mine.items[id];
      else delete baseItems[id];
    }
    const nextBase = { rev: savedRev, items: baseItems, keys: values.result };
    if (detached) return { pulled, pushed, keysChanged, keys: values.pull, base: nextBase };
    storageSet(BASE_KEY, JSON.stringify(nextBase));
    await removeStaleSpace(code);
    storageSet(OLD_BASE_KEY, null);
    storageSet(LAST_KEY, new Date().toISOString());
    return { pulled, pushed, keysChanged, keys: values.pull };
  }
  throw new Error("另一台一直在同步,等一下再試");
}

// 給 node 小測試用(合併規則和大量刪除的判斷是純函式,不用開瀏覽器就能測);App 不用這幾個。
export { mergeJsonText as mergeJsonTextForTest, merge3 as merge3ForTest, askBeforeDeleting as askBeforeDeletingForTest };
