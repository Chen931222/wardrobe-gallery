// [本 fork 修改] 上游 tandpfun/wardrobe 既有檔案。本 fork 的改動見下面「2026-10-06」那段。
/* 2026-10-06 本人回報「網站載入有點慢」。舊版只管開頁面(先問網路)和 /_ipx/ 的圖(線上版沒有 IPX,等於沒管),
   JS、CSS、字型、衣服的圖每次打開都要一個個問過伺服器才肯用(Vercel 預設 max-age=0)。現在:
   ① /assets/:檔名帶內容雜湊,內容變了檔名就變 → 有存就直接用,不問。
      去背模型那幾個大檔(.wasm、ort*)不存:一個 24MB,跟衣服的資料庫共用這個網站的儲存額度,塞滿了衣服會存不進去
   ② /data/ 的衣服圖:先給存著的那張,背景再問一次有沒有換過(下次打開才看得到新的)
   ③ 開頁面:照舊先問網路,拿到最新版;2.5 秒還沒回(訊號差)先給上次存的那份,網路回來了背景更新
   存的東西都有上限,超過從最舊的丟。 */
const SHELL_CACHE = "open-wardrobe-shell-v1";
const ASSET_CACHE = "open-wardrobe-assets-v1";
const IMAGE_CACHE = "wardrobe-images-v1";
const ACTIVE_CACHES = new Set([SHELL_CACHE, ASSET_CACHE, IMAGE_CACHE]);
const MAX_IMAGE_ENTRIES = 800;
const MAX_ASSET_ENTRIES = 240;
const NAV_TIMEOUT = 2500;
const SHELL = ["/", "/manifest.webmanifest"];
const SKIP_ASSET = /\.wasm$|\/ort[.-]/;

async function trim(cache, max) {
  const keys = await cache.keys();
  const overflow = keys.length - max;
  if (overflow > 0) await Promise.all(keys.slice(0, overflow).map((request) => cache.delete(request)));
}

async function fetchAndCache(request, cacheName, max, accept) {
  const response = await fetch(request);
  if (response.ok && !response.redirected && accept(response)) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone()).catch(() => undefined);   // 額度滿了就不存,照樣回給頁面
    await trim(cache, max).catch(() => undefined);
  }
  return response;
}

const isImage = (response) => (response.headers.get("content-type") || "").startsWith("image/");

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => !ACTIVE_CACHES.has(key)).map((key) => caches.delete(key)))),
  ]));
  self.clients.claim();
});

/** 有存就用存的;沒有就去拿,拿到存起來 */
function cacheFirst(event, cacheName, max, accept) {
  event.respondWith(caches.open(cacheName).then(async (cache) => {
    const cached = await cache.match(event.request);
    return cached || fetchAndCache(event.request, cacheName, max, accept);
  }));
}

/** 先給存著的,背景再拿一次新的換掉(沒存過就等網路) */
function staleWhileRevalidate(event, cacheName, max, accept) {
  event.respondWith(caches.open(cacheName).then(async (cache) => {
    const cached = await cache.match(event.request);
    const update = fetchAndCache(event.request, cacheName, max, accept);
    if (cached) {
      event.waitUntil(update.catch(() => undefined));
      return cached;
    }
    return update;
  }));
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.headers.has("range")) return;

  if (url.pathname.startsWith("/assets/")) {
    if (!SKIP_ASSET.test(url.pathname)) cacheFirst(event, ASSET_CACHE, MAX_ASSET_ENTRIES, () => true);
    return;
  }

  if (url.pathname.startsWith("/_ipx/") || (url.pathname.startsWith("/data/") && url.pathname.endsWith(".webp"))) {
    staleWhileRevalidate(event, IMAGE_CACHE, MAX_IMAGE_ENTRIES, isImage);
    return;
  }

  if (request.mode === "navigate") {
    // 只有一頁(SPA):不管網址帶什麼參數,存的都是同一份 index.html
    let saving = null;
    const network = fetch(request).then((response) => {
      if (response.ok && !response.redirected) {
        const copy = response.clone();
        saving = caches.open(SHELL_CACHE).then((cache) => cache.put("/", copy)).catch(() => undefined);
      }
      return response;
    });
    event.waitUntil(network.then(() => saving, () => undefined));
    const fallback = network.catch(() => caches.match("/").then((cached) => cached || Response.error()));
    const slow = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT)).then(() => caches.match("/"));
    event.respondWith(Promise.race([fallback, slow.then((cached) => cached || fallback)]));
  }
});
