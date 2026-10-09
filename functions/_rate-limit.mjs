// [本 fork 新增] 公開 API 的次數限制(2026-10-09 資安盤點):讀商品頁、商品圖、GU/UNIQLO 品名三支沒有任何限制,
// 實測連打 20 次全收,別人可以把這個網站當免費的爬蟲代理,燒掉 Function 額度(Hobby 每月 100 萬次、CPU 4 小時,用完整站停)。
//
// 每個 IP 每分鐘幾次,超過回 429。計數記在 function 的記憶體:Vercel 同時開好幾台時各算各的,
// 擋的是大量亂打,不是精準攻擊;要嚴格得換成共用的計數(Redis 之類)。CDN 快取命中的請求不會進到這裡,本來就不花額度。
// IP 用 Vercel 填的 x-forwarded-for 第一個(Vercel 會覆寫這個標頭,使用者偽造不了)。

const buckets = new Map();
const WINDOW = 60_000;

/** 超過上限回要等幾秒,沒超過回 0 */
export function overLimit(request, name, max) {
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
  const now = Date.now();
  const key = `${name}:${ip}`;
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= WINDOW) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (buckets.size > 5000) for (const [k, b] of buckets) if (now - b.start >= WINDOW) buckets.delete(k);
  return bucket.count > max ? Math.max(1, Math.ceil((bucket.start + WINDOW - now) / 1000)) : 0;
}

export function tooMany(retryAfter) {
  return Response.json({ error: "太頻繁了,等一下再試", images: [] }, {
    status: 429,
    headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
  });
}
