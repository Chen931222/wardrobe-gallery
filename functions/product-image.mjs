// [本 fork 新增] /api/product-image?u=…&s=…:代為下載 product-page 讀出來、簽過名的商品圖。規則在 _product-page-core.mjs。
import { fetchProductImage } from "./_product-page-core.mjs";
import { SECRET } from "./_proxy-secret.mjs";
import { overLimit, tooMany } from "./_rate-limit.mjs";

export async function GET(request) {
  const wait = overLimit(request, "product-image", 60);   // 一個商品頁最多 12 張、縮圖＋原圖,一分鐘 60 張夠挑好幾件
  if (wait) return new Response(null, { status: 429, headers: { "Retry-After": String(wait), "Cache-Control": "no-store" } });
  const params = new URL(request.url).searchParams;
  let result;
  try {
    result = await fetchProductImage(params.get("u"), params.get("s"), SECRET);
  } catch {
    result = { status: 502, body: null };
  }
  if (result.status !== 200) return new Response(null, { status: result.status, headers: { "Cache-Control": "no-store" } });
  return new Response(result.body, {
    headers: { "Content-Type": result.type, "Cache-Control": "private, max-age=86400" },   // 2026-10-09:不再公開快取 7 天(品牌的圖只給貼連結的那個人)
  });
}
