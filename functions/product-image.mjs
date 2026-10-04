// [本 fork 新增] /api/product-image?u=…&s=…:代為下載 product-page 讀出來、簽過名的商品圖。規則在 _product-page-core.mjs。
import { fetchProductImage } from "./_product-page-core.mjs";
import { SECRET } from "./_proxy-secret.mjs";

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  let result;
  try {
    result = await fetchProductImage(params.get("u"), params.get("s"), SECRET);
  } catch {
    result = { status: 502, body: null };
  }
  if (result.status !== 200) return new Response(null, { status: result.status, headers: { "Cache-Control": "no-store" } });
  return new Response(result.body, {
    headers: { "Content-Type": result.type, "Cache-Control": "public, max-age=86400, s-maxage=604800" },
  });
}
