// [本 fork 新增] 貼商品連結 → 認出品牌、商品編號、品名線索。全部在瀏覽器裡算,不連品牌的伺服器。
//
// GU 台灣(2026-10-01 實測):商品圖放在 www.gu-global.com/tw/hmall/test/{code}/main/...,
// 回應帶 Access-Control-Allow-Origin: *,瀏覽器可以直接下載拿去去背;網址只靠商品編號就算得出來。
// 品名在 d.gu-global.com 的內部 API,但那支 CORS 不放行,瀏覽器讀不到,所以這裡不碰。
// Zara 整站有機器人驗證,讀不到頁面;只能從網址路徑拿品名。

import { findUrl } from "./localWardrobe.js";
import { brandInUrl } from "./brands.js";

/* 同一套商品頁系統的品牌。圖片網址規則一樣,只差網域。
   手機打開會被轉到 m. 開頭的手機版(2026-10-03 實測 301),商品頁是 /tw/product?pid=u…,
   電腦版是 www. 開頭、/tw/zh_TW/product-detail.html?productCode=u…;兩種、加上沒有 www 的都認。 */
const HMALL = {
  "gu-global.com": { key: "gu", brand: "GU", imageHost: "https://www.gu-global.com" },
  "uniqlo.com": { key: "uniqlo", brand: "UNIQLO", imageHost: "https://www.uniqlo.com" },
};

const MAX_IMAGES = 15;

/* 分享文字裡的品名,品名 API 失敗或還沒回來時先填。GU App 的分享長這樣(2026-10-03 本人貼的):
   「快來看看【男裝 男女適穿 Puffy蓬鬆柔軟V領開襟外套CL 361759】。在GU台灣網路商店查看更多…。 https://m.gu-global.com/tw/product?pid=…」
   有【】就只取裡面,去掉開頭的「男裝/女裝」和結尾的貨號;沒有就拿網址以外、第一個句號前的那段。 */
function nameFromShare(text) {
  const raw = String(text || "");
  const tidy = (part) => part
    .replace(/^\s*(男裝|女裝|童裝|嬰幼兒|男童|女童)\s+/, "")
    .replace(/\s+\d{5,7}\s*$/, "")
    .replace(/[[\]「」【】]/g, " ").replace(/\b(GU|UNIQLO)\b/gi, "").replace(/\s+/g, " ").trim();
  // 【】裡只有品牌名(「【GU】寬版牛仔褲 https://…」)就改拿括號外面那段
  const bracket = tidy((raw.match(/【([^】]+)】/) || [])[1] || "");
  const outside = tidy(raw.replace(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}\/\S*/gi, " ").split(/[。!！]/)[0]);
  return (bracket || outside).slice(0, 60);
}

/** 認不出來回 null。text 可以是網址,也可以是 App「分享」拷出來的整段文字。 */
export function parseBrandLink(text) {
  const href = findUrl(text);
  if (!href) return null;
  const url = new URL(href);
  const nameHint = nameFromShare(text);

  const hmall = HMALL[url.host.replace(/^(www|m)\./, "")];
  const code = url.searchParams.get("productCode") || url.searchParams.get("pid") || (href.match(/u\d{9,}/) || [])[0];
  const first = url.pathname.split("/")[1];
  const region = /^[a-z]{2}$/.test(first) ? first : "tw";
  if (hmall && code && /^u\d{8,}$/.test(code)) {
    return {
      brand: hmall.brand, url: href, name: nameHint, images: hmallImages(hmall.imageHost, region, code),
      lookup: { brand: hmall.key, region, code },
      key: `${hmall.key}:${code}`,   // 同一件商品的身分證:手機版、電腦版網址不同,比重複時用這個
    };
  }
  // 品牌的網址、但不是單一商品頁(首頁、分類頁、搜尋結果):舊版當成「這個網站的圖抓不到」(審查 F59),
  // 其實是找不到商品編號。講清楚要貼哪一種。日本、美國站的商品頁(/jp/ja/products/E465185-000/00)編號格式不同,
  // 抓不到圖但網址還是要存,不能也當成「不是商品頁」
  if (hmall && !/product|goods|\/p\//i.test(url.pathname + url.search)) {
    return { brand: hmall.brand, url: href, name: nameHint, images: [], notProduct: true };
  }

  if (url.host.endsWith("zara.com")) {
    const slug = decodeURIComponent(url.pathname.split("/").pop() || "");
    const name = slug.replace(/-p\d+\.html$/, "").replace(/-/g, " ").trim();
    return { brand: "Zara", url: href, name: name || nameHint, images: [] };
  }

  // 其他品牌:圖和品名問自己的 /api/product-page(讀商品頁公開的分享資料,見 functions/_product-page-core.mjs)。
  // 品牌先照網域填(beams.co.jp → Beams;蝦皮這類賣場留空),商品頁讀到品牌再換掉
  return { brand: brandInUrl(href) || "", url: href, name: nameHint, images: [], page: true };
}

/** 照商品網址找價錢:GU、UNIQLO 問商品 API,其他品牌讀商品頁;找不到(擋機器人、頁面沒寫)回 null。
 *  回傳 { amount, currency }。給「想買的」補價錢用。 */
export async function fetchPriceForUrl(url) {
  const parsed = parseBrandLink(url);
  if (!parsed || parsed.notProduct) return null;
  if (parsed.lookup) return (await fetchBrandProduct(parsed.lookup))?.price || null;
  if (parsed.page) return (await fetchProductPage(parsed.url).catch(() => null))?.price || null;
  return null;
}

/** 讀其他品牌的商品頁:{ name, brand, images: [{ thumb, full }] },擋住了回 { blocked: true },其他失敗回 { error }。 */
export async function fetchProductPage(url, signal) {
  try {
    const response = await fetch(`/api/product-page?${new URLSearchParams({ url })}`, { signal: signal || AbortSignal.timeout(15000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { error: data.error || `讀取失敗(${response.status})`, images: [] };
    return { ...data, images: Array.isArray(data.images) ? data.images : [] };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return { error: navigator.onLine === false ? "現在沒有網路" : "讀不到這個商品頁", images: [] };
  }
}

/** 兩個商品網址是不是同一件:認得出商品編號就比編號(手機版、電腦版、分享連結都算同一件),不然比網址。 */
export function sameProduct(a, b) {
  if (!a || !b) return false;
  const left = parseBrandLink(a), right = parseBrandLink(b);
  if (left?.key && right?.key) return left.key === right.key;
  return Boolean(left?.url) && left?.url === right?.url;
}

/** 問自己的 /api/brand-product 拿品名與分類;失敗回 null,前端就讓人手動填。 */
export async function fetchBrandProduct(lookup) {
  if (!lookup) return null;
  try {
    const response = await fetch(`/api/brand-product?${new URLSearchParams(lookup)}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    const { name, categories, price } = await response.json();
    return name ? { name, categories: categories || [], price: price || null } : null;
  } catch {
    return null;
  }
}

/* main/first 是第一張,main/other{i} 是其餘;張數每件不同,載不到的由畫面自己藏起來。
   thumb 給挑圖用,full 給去背用。 */
function hmallImages(host, region, code) {
  const base = `${host}/${region}/hmall/test/${code}/main`;
  const list = [{ thumb: `${base}/first/561/1.jpg`, full: `${base}/first/1000/1.jpg` }];
  for (let i = 1; i < MAX_IMAGES; i += 1) {
    list.push({ thumb: `${base}/other${i}/480/${i + 1}.jpg`, full: `${base}/other${i}/1000/${i + 1}.jpg` });
  }
  return list;
}

/* 從品名猜分類:取「最後出現」的關鍵字,因為中文的主詞在尾巴(針織外套→外套、毛絨針織上衣→上衣)。
   同一個位置有兩個字時,照下面的順序(「船型襪」的襪排在鞋前面)。 */
const PART_WORDS = [
  // 隨身小物排在包前面:「錢包」「皮夾」跟「包」同一個位置結束時算小物
  ["carry", /鋼筆|原子筆|鋼珠筆|筆|打火機|皮夾|錢包|名片夾|鑰匙圈|\b(pens?|fountain\s?pens?|lighters?|wallets?|card\s?holders?|keychains?)\b/i],
  ["socks", /襪|\bsocks?\b/i],
  ["shoes", /鞋|靴|拖|\b(shoes?|sneakers?|boots?|loafers?|sandals?|slides?|trainers?|mules?)\b/i],
  ["bag", /包|袋|\b(bags?|backpacks?|totes?|purses?|crossbody|duffel|weekender|clutch|pouch|luggage|suitcase)\b/i],
  ["eyewear", /眼鏡|墨鏡|\b(sunglasses|glasses|eyewear)\b/i],
  // 手錶、手環;皮帶、項鍊、戒指各自一類(2026-10-06);耳環、帽子、圍巾這類放在「其他配件」
  ["wrist", /錶|手環|手鍊|\b(watch|watches|bracelets?|bangles?)\b/i],
  ["belt", /皮帶|腰帶|\bbelts?\b/i],
  ["necklace", /項鍊|項链|墜飾|\b(necklaces?|pendants?)\b/i],
  ["ring", /戒指|指環|\brings?\b/i],
  ["accessories_up", /耳環|帽子|棒球帽|毛帽|圍巾|\b(earrings?|caps?|hats?|beanies?|scarf|scarves)\b/i],
  ["wholebody_up", /外套|夾克|大衣|風衣|背心外套|羽絨|教練|西裝|\b(jackets?|coats?|blazers?|parkas?|windbreakers?|cardigans?)\b/i],
  ["lowerbody", /褲|裙|\b(pants|trousers|jeans|shorts|skirts?|chinos|joggers?|leggings)\b/i],
  ["upperbody", /T恤|襯衫|上衣|針織|毛衣|衛衣|帽T|POLO|Polo|背心|連帽|\b(t-?shirts?|tees?|shirts?|polos?|sweaters?|hoodies?|sweatshirts?|tops?|tanks?|knit)\b/i],
];

export function partFromName(name) {
  let best = null, bestAt = -1;
  for (const [part, pattern] of PART_WORDS) {
    const global = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
    for (const match of String(name || "").matchAll(global)) {
      const end = match.index + match[0].length;
      if (end > bestAt) { best = part; bestAt = end; }
    }
  }
  return best;
}

/** 品名優先;品名猜不出來才看品牌給的分類標籤(成套家居服的標籤裡常同時有「褲」)。 */
export function partFromProduct(name, categories = []) {
  return partFromName(name) || partFromName(categories.join(" "));
}
