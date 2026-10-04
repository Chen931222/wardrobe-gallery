// [本 fork 新增] /api/product-page?url=…:讀任意品牌商品頁的品名和商品圖。規則在 _product-page-core.mjs。
// _proxy-secret.mjs 不在 repo 裡:tools/export-static.mjs 每次匯出產生一份新的(簽圖片網址用)。
import { readProductPage } from "./_product-page-core.mjs";
import { SECRET } from "./_proxy-secret.mjs";

export async function GET(request) {
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
