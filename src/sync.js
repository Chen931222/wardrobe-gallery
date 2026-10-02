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

import { deleteLocalItem, dumpLocalRecords, putLocalRecord } from "./localWardrobe.js";

const CODE_KEY = "open-wardrobe-sync-code";
const BASE_KEY = "open-wardrobe-sync-base-v2";     // v2 = 加密後;v1 的 base 用不同的圖編號,留著只會誤判
const OLD_BASE_KEY = "open-wardrobe-sync-base";
const LAST_KEY = "open-wardrobe-sync-last";
const NOTICE_KEY = "open-wardrobe-sync-notice";      // 這台被停掉時留一句話給同步面板
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
export const normalizeCode = (text) => String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const formatCode = (code) => (code.match(/.{1,4}/g) || []).join("-");
export const isValidCode = (code) => /^[A-HJ-NP-Z2-9]{16}$/.test(code);

export const syncCode = () => storageGet(CODE_KEY);
export const lastSynced = () => storageGet(LAST_KEY);
export const syncNotice = () => storageGet(NOTICE_KEY);

export function setSyncCode(code) {
  storageSet(CODE_KEY, code);
  storageSet(BASE_KEY, null);       // 換一組碼 = 重新加入,沒有「上次同步」可比
  storageSet(OLD_BASE_KEY, null);
  storageSet(LAST_KEY, null);
  storageSet(NOTICE_KEY, null);
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
async function snapshot(keys) {
  const items = {}, blobs = {};
  for (const { blob, ...meta } of await dumpLocalRecords()) {
    const img = blob ? hex(await crypto.subtle.sign("HMAC", keys.mac, await blob.arrayBuffer())) : null;
    items[meta.id] = { meta, img, type: blob?.type || null };
    if (img) blobs[img] = blob;
  }
  const values = {};
  for (const key of SYNC_KEYS) {
    const value = storageGet(key);
    if (value !== null) values[key] = value;
  }
  return { items, keys: values, blobs };
}

/* 兩邊都改過同一份 JSON 時往下一層合:物件逐欄、字串陣列取聯集再扣掉某一邊刪掉的。 */
function mergeJsonText(local, base, remote) {
  let l, b, r;
  try { l = JSON.parse(local); r = JSON.parse(remote); b = base == null ? null : JSON.parse(base); } catch { return local; }
  if (Array.isArray(l) && Array.isArray(r) && l.every((x) => typeof x !== "object") && r.every((x) => typeof x !== "object")) {
    const was = new Set(Array.isArray(b) ? b : []);
    const removed = new Set([...was].filter((x) => !l.includes(x) || !r.includes(x)));
    return JSON.stringify([...new Set([...l, ...r])].filter((x) => !removed.has(x)));
  }
  if (l && r && typeof l === "object" && typeof r === "object" && !Array.isArray(l) && !Array.isArray(r)) {
    const was = b && typeof b === "object" && !Array.isArray(b) ? b : {};
    const out = {};
    for (const name of new Set([...Object.keys(l), ...Object.keys(r), ...Object.keys(was)])) {
      const pick = same(l[name], r[name]) ? l[name]
        : same(l[name], was[name]) ? r[name]
        : l[name];                                  // 這一欄兩邊都改了:手上這台贏
      if (pick !== undefined) out[name] = pick;
    }
    return JSON.stringify(out);
  }
  return local;
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
    else if (deep && l !== undefined && r !== undefined) pick = mergeJsonText(l, b, r);
    else pick = remoteWins ? r : l;
    if (pick !== undefined) result[id] = pick;
    if (!same(pick, l)) pull.push(id);
  }
  return { result, pull };
}

/* ---------- 網路 ---------- */

class SyncGone extends Error {}

async function api(code, { method = "GET", img, body, type, parent } = {}) {
  const url = img ? `/api/sync?img=${img}` : "/api/sync";
  return fetch(url, {
    method,
    headers: {
      "X-Sync-Code": code,
      ...(parent ? { "X-Sync-Parent": parent } : {}),
      ...(type ? { "Content-Type": type } : {}),
    },
    body,
    signal: AbortSignal.timeout(20000),
  });
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
let timer = null;

/**
 * 跑一次同步,跑完發 wardrobe-synced 事件(detail: { pulled, pushed, keysChanged, error, stopped, at }),
 * App 聽到就重新整理畫面;同一時間只跑一個,再叫一次會等前一個結束。
 */
export function syncNow() {
  if (!running) {
    running = runSync()
      .then((result) => ({ ...result, error: null }))
      .catch((error) => {
        if (error instanceof SyncGone) {
          // 碼被換掉或雲端被刪了:這台停下來,不要每次切回來都白打一次
          stopSync("這組同步碼已經失效(換了新碼,或雲端那份被刪了)。要繼續,到另一台按「看同步碼」,用新碼重新加入。");
          return { pulled: 0, pushed: 0, keysChanged: false, error: syncNotice(), stopped: true };
        }
        return { pulled: 0, pushed: 0, keysChanged: false, error: error?.message || String(error) };
      })
      .then((result) => {
        window.dispatchEvent(new CustomEvent("wardrobe-synced", { detail: { ...result, at: lastSynced() } }));
        return result;
      })
      .finally(() => { running = null; });
  }
  return running;
}

/** 衣服剛改過:等 5 秒再同步,連續改好幾件只傳一次。同步自己寫回這台時不算。 */
export function scheduleSync() {
  if (running || !syncCode()) return;
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
  setSyncCode(next);
  const result = await syncNow();
  if (result.error) throw new Error(result.error);
  await readJson(await api(old, { method: "DELETE" })).catch(() => {});
  return next;
}

/** 刪掉雲端那份,這台也停止同步。衣服都還在這台。 */
export async function deleteCloud() {
  const code = syncCode();
  if (!code) return;
  await readJson(await api(code, { method: "DELETE" }));
  stopSync();
}

async function runSync() {
  const code = syncCode();
  if (!code) return { pulled: 0, pushed: 0, keysChanged: false };
  const keys = await keysFor(code);
  let pulled = 0, pushed = 0, keysChanged = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const saved = JSON.parse(storageGet(BASE_KEY) || "null");
    const joining = !saved;
    const base = saved || { items: {}, keys: {} };
    const cloud = await readJson(await api(code));
    // 加密前的舊格式(沒有 data)當作空的:這台的東西全部以密文重傳,伺服器會順手刪掉舊的明文圖
    const remote = cloud.data
      ? JSON.parse(new TextDecoder().decode(await open(keys, fromBase64(cloud.data))))
      : { items: {}, keys: {} };
    const rev = cloud.rev || 0;
    const mine = await snapshot(keys);

    const items = merge3(mine.items, base.items, remote.items || {}, { remoteWins: joining });
    const values = merge3(mine.keys, base.keys, remote.keys || {}, { remoteWins: joining, deep: true });

    // 1) 先把要上傳的圖傳上去,清單才不會指到雲端沒有的圖
    let savedRev = rev;
    const changed = !cloud.data || !same(items.result, remote.items || {}) || !same(values.result, remote.keys || {});
    if (changed) {
      const cloudImages = new Set(cloud.imgs || []);
      for (const entry of Object.values(items.result)) {
        if (!entry.img || cloudImages.has(entry.img) || !mine.blobs[entry.img]) continue;
        const sealed = await seal(keys, new Uint8Array(await mine.blobs[entry.img].arrayBuffer()));
        await readJson(await api(code, { method: "PUT", img: entry.img, body: sealed, type: "application/octet-stream" }));
        cloudImages.add(entry.img);
      }
      const data = toBase64(await seal(keys, text.encode(JSON.stringify({ items: items.result, keys: values.result }))));
      const imgs = [...new Set(Object.values(items.result).map((entry) => entry.img).filter(Boolean))];
      const response = await api(code, { method: "PUT", type: "application/json", body: JSON.stringify({ baseRev: rev, imgs, data }) });
      if (response.status === 409) continue;          // 另一台剛寫過:用新的雲端重新合一次
      savedRev = (await readJson(response)).rev;
      pushed += 1;
    }

    // 2) 寫回這台
    for (const id of items.pull) {
      const entry = items.result[id];
      if (!entry) { await deleteLocalItem(id); pulled += 1; continue; }
      let blob = entry.img ? mine.blobs[entry.img] : null;
      if (entry.img && !blob) {
        const response = await api(code, { img: entry.img });
        if (!response.ok) throw new Error(`下載「${entry.meta.name || id}」的圖失敗`);
        const plain = await open(keys, new Uint8Array(await response.arrayBuffer()));
        blob = new Blob([plain], { type: entry.type || "image/png" });
      }
      await putLocalRecord({ ...entry.meta, blob });
      pulled += 1;
    }
    for (const key of values.pull) {
      storageSet(key, values.result[key] ?? null);
      keysChanged = true;
    }

    storageSet(BASE_KEY, JSON.stringify({ rev: savedRev, items: items.result, keys: values.result }));
    storageSet(OLD_BASE_KEY, null);
    storageSet(LAST_KEY, new Date().toISOString());
    return { pulled, pushed, keysChanged };
  }
  throw new Error("另一台一直在同步,等一下再試");
}
