// [本 fork 新增] 貼商品連結 → 認出品牌、商品編號、品名線索。全部在瀏覽器裡算,不連品牌的伺服器。
//
// GU 台灣(2026-10-01 實測):商品圖放在 www.gu-global.com/tw/hmall/test/{code}/main/...,
// 回應帶 Access-Control-Allow-Origin: *,瀏覽器可以直接下載拿去去背;網址只靠商品編號就算得出來。
// 品名在 d.gu-global.com 的內部 API,但那支 CORS 不放行,瀏覽器讀不到,所以這裡不碰。
// Zara 整站有機器人驗證,讀不到頁面;只能從網址路徑拿品名。

import { cleanUrl } from "./localWardrobe.js";

/* 同一套商品頁系統的品牌。圖片網址規則一樣,只差網域。 */
const HMALL = {
  "www.gu-global.com": { brand: "GU", imageHost: "https://www.gu-global.com" },
  "www.uniqlo.com": { brand: "UNIQLO", imageHost: "https://www.uniqlo.com" },
};

const MAX_IMAGES = 15;

/** 認不出來回 null。 */
export function parseBrandLink(text) {
  const href = cleanUrl(text);
  if (!href) return null;
  const url = new URL(href);

  const hmall = HMALL[url.host];
  const code = url.searchParams.get("productCode");
  const region = url.pathname.split("/")[1];
  if (hmall && code && /^u\d{8,}$/.test(code) && /^[a-z]{2}$/.test(region)) {
    return { brand: hmall.brand, url: href, name: "", images: hmallImages(hmall.imageHost, region, code) };
  }

  if (url.host.endsWith("zara.com")) {
    const slug = decodeURIComponent(url.pathname.split("/").pop() || "");
    const name = slug.replace(/-p\d+\.html$/, "").replace(/-/g, " ").trim();
    return { brand: "Zara", url: href, name, images: [] };
  }

  return { brand: "", url: href, name: "", images: [] };
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

/* 從品名猜分類。順序有意義:「外套」要先於「T恤」,「襪」要先於「鞋」(船型襪)。 */
const PART_WORDS = [
  ["socks", /襪/],
  ["shoes", /鞋|靴|拖/],
  ["bag", /包|袋/],
  ["eyewear", /眼鏡|墨鏡/],
  ["wrist", /錶|手環/],
  ["wholebody_up", /外套|夾克|大衣|風衣|背心外套|羽絨|教練|西裝/],
  ["lowerbody", /褲|裙/],
  ["upperbody", /T恤|襯衫|上衣|針織|毛衣|衛衣|帽T|POLO|Polo|背心|連帽/],
];

export function partFromName(name) {
  for (const [part, pattern] of PART_WORDS) if (pattern.test(name || "")) return part;
  return null;
}
