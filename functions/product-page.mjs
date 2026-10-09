// [本 fork 新增] /api/product-page?url=…:讀任意品牌商品頁的品名和商品圖。規則在 _product-page-core.mjs。
// _proxy-secret.mjs 不在 repo 裡:tools/export-static.mjs 每次匯出產生一份新的(簽圖片網址用)。
import { readProductPage } from "./_product-page-core.mjs";
import { SECRET } from "./_proxy-secret.mjs";
import { overLimit, tooMany } from "./_rate-limit.mjs";

export async function GET(request) {
  const wait = overLimit(request, "product-page", 20);   // 每個 IP 每分鐘 20 個商品頁(一般人一分鐘貼不到幾個連結)
  if (wait) return tooMany(wait);
  const url = new URL(request.url).searchParams.get("url");
  let result;
  try {
    result = await readProductPage(url, SECRET);
  } catch (error) {
    result = { status: 200, body: { error: error?.name === "TimeoutError" ? "對方太慢" : String(error?.message || error), images: [] } };
  }
  return Response.json(result.body, {
    status: result.status,
    headers: result.status === 200 && result.body.images?.length ? { "Cache-Control": "public, s-maxage=3600" } : { "Cache-Control": "no-store" },
  });
}
