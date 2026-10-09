// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
//
// functions/brand-product.mjs — 用商品編號問 GU／UNIQLO 品名與分類。
//
// 為什麼要伺服器:兩家的商品資料 API 回 Access-Control-Allow-Origin: 0,瀏覽器讀不到(2026-10-01 實測)。
// 線上由 tools/export-static.mjs 複製成 wardrobe-gallery/api/brand-product.mjs,變成 Vercel function;
// 開發時由 scripts/wardrobe-data-api.mjs 掛在同一個路徑。
//
// 不是開放代理:只打兩個寫死的網域,商品編號與地區都先過格式檢查,回傳也只挑品名和分類。
// 這兩支 API 沒有公開文件,品牌一改版就會壞;壞了前端照樣能手動填品名。

import { overLimit, tooMany } from "./_rate-limit.mjs";
const HOSTS = {
  gu: "https://d.gu-global.com",
  uniqlo: "https://d.uniqlo.com",
};

const REGION_CURRENCY = {
  tw: "TWD", jp: "JPY", us: "USD", hk: "HKD", kr: "KRW", sg: "SGD", my: "MYR", th: "THB", ph: "PHP", id: "IDR",
  vn: "VND", au: "AUD", ca: "CAD", uk: "GBP", gb: "GBP", fr: "EUR", de: "EUR", es: "EUR", it: "EUR", nl: "EUR", be: "EUR", cn: "CNY",
};

export async function lookupBrandProduct({ brand, region, code }) {
  const host = HOSTS[brand];
  if (!host || !/^[a-z]{2}$/.test(region || "") || !/^u\d{8,16}$/.test(code || "")) {
    return { status: 400, body: { error: "格式不對" } };
  }
  const url = `${host}/${region}/p/product/detail?productCode=${code}&distribution=EXPRESS&type=DETAIL`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return { status: 502, body: { error: `品牌回 ${response.status}` } };
  const summary = (await response.json())?.resp?.[0]?.spuInfo?.summary;
  if (!summary?.name) return { status: 404, body: { error: "找不到這件" } };
  // 價錢:特價後的最低價,沒有就原價(2026-10-05 實測 GU:minPrice 690、originPrice 690)
  const amount = Number(summary.minPrice ?? summary.originPrice);
  return {
    status: 200,
    body: {
      price: Number.isFinite(amount) && amount > 0 ? { amount, currency: REGION_CURRENCY[region] || null } : null,
      name: summary.name,
      categories: (summary.categoryNames || []).filter((label) => typeof label === "string" && label !== "全商品"),
    },
  };
}

/* Vercel function 入口(Web 標準 Request/Response)。 */
export async function GET(request) {
  const wait = overLimit(request, "brand-product", 30);   // 每個 IP 每分鐘 30 次(2026-10-09 資安盤點)
  if (wait) return tooMany(wait);
  const params = new URL(request.url).searchParams;
  let result;
  try {
    result = await lookupBrandProduct({ brand: params.get("brand"), region: params.get("region"), code: params.get("code") });
  } catch (error) {
    result = { status: 502, body: { error: String(error?.name === "TimeoutError" ? "品牌太慢" : error?.message || error) } };
  }
  return Response.json(result.body, {
    status: result.status,
    headers: result.status === 200 ? { "Cache-Control": "public, s-maxage=86400" } : {},
  });
}
