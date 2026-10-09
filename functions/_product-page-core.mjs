// [本 fork 新增] 任意品牌的商品頁:讀出品名和商品圖,圖由這裡代為下載。
//
// 只讀公開給「分享預覽」看的那份資料:JSON-LD 的 Product、og:image / og:title(LINE、Facebook 貼連結時顯示的那張),
// Shopify 店另外讀它公開的 /products/<handle>.js(整組商品圖都在裡面)。User-Agent 照實寫是預覽工具,
// 對方擋機器人(403、驗證頁)就照實回「擋住了」,不繞過——蝦皮、Zara 這類就是改用截圖。
//
// 為什麼圖也要經過這裡:很多品牌的圖不給別的網站直接下載(沒有 CORS,2026-10-04 實測 Seiko、Longchamp),
// 瀏覽器拿不到就沒辦法去背;CSP 也就不用為了每個品牌開圖片網域。
// 不是開放代理:圖的網址必須是這裡剛從商品頁讀出來、用 secret 簽過名的;secret 每次部署重新產生(tools/export-static.mjs)。
// 也只收常見的點陣圖(svg 能帶程式,從我們的網域送出去等於開一個洞)。

import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const UA = "Mozilla/5.0 (compatible; WardrobeLinkPreview/1.0; +https://wardrobe-gallery.vercel.app)";
const MAX_HTML = 2_000_000;
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_IMAGES = 12;
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|avif)$/;

/** 只收 http(s)、公開的網域;IP、localhost、內部網域、奇怪的 port 一律不打。轉址的每一站也要過這關。 */
export function checkUrl(text) {
  let url;
  try { url = new URL(String(text || "")); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return null;
  if (/(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/.test(host)) return null;
  if (url.port && url.port !== "80" && url.port !== "443") return null;
  if (url.username || url.password) return null;
  return url;
}

/* 網域實際指到哪(2026-10-09 資安盤點):checkUrl 只看網址字串,擋得掉 127.0.0.1,擋不掉「名字正常、但解析到內網」的網域
   (實測 localtest.me → 127.0.0.1、169.254.169.254.nip.io → 雲端主機資訊位址,舊版都真的連過去,只是 Vercel 上那裡沒東西)。
   連線前先查 DNS,任何一個位址是內網、本機、保留段就不打。限制:查完到真正連線之間 DNS 還是可能換(rebinding),
   要完全擋得改成連到查到的那個 IP;Vercel 上目前沒有可以打的內部服務,先做到這樣。 */
function isPrivateIp(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v6 = address.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
}
async function assertPublicHost(url) {
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isPrivateIp(record.address))) throw new Error("這個網址指到不允許的位址");
}

/** 自己跟轉址(最多 5 次,每一站都檢查:網址字串＋實際解析到的位址),讀到上限就停。 */
async function fetchLimited(start, accept, limit, { truncate }) {
  let current = start;
  for (let hop = 0; hop < 6; hop += 1) {
    await assertPublicHost(current);
    const response = await fetch(current, {
      headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.6" },
      redirect: "manual",
      signal: AbortSignal.timeout(9000),
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      const next = checkUrl(new URL(location, current).href);
      if (!next) throw new Error("轉到不允許的網址");
      current = next;
      continue;
    }
    const chunks = [];
    let kept = 0;
    const reader = response.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      if (kept + value.length > limit) {
        await reader.cancel().catch(() => {});
        if (!truncate) throw new Error("檔案太大");
        break;
      }
      chunks.push(value);
      kept += value.length;
    }
    const bytes = new Uint8Array(kept);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { response, url: current, bytes };
  }
  throw new Error("轉址太多次");
}

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", reg: "®", trade: "™", copy: "©", hellip: "…",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", times: "×", middot: "·",
  aacute: "á", agrave: "à", acirc: "â", auml: "ä", atilde: "ã", ccedil: "ç", eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  iacute: "í", igrave: "ì", icirc: "î", iuml: "ï", ntilde: "ñ", oacute: "ó", ograve: "ò", ocirc: "ô", ouml: "ö", otilde: "õ",
  uacute: "ú", ugrave: "ù", ucirc: "û", uuml: "ü", szlig: "ß", oslash: "ø", aring: "å", aelig: "æ",
};
const decode = (text) => String(text || "")
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&([a-z]+);/gi, (all, name) => ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? all)
  .replace(/\s+/g, " ")
  .trim();

function metaContents(html, key) {
  const out = [];
  for (const [tag] of html.matchAll(/<meta\s[^>]*>/gi)) {
    if (!new RegExp(`(?:property|name|itemprop)\\s*=\\s*["']${key}["']`, "i").test(tag)) continue;
    const content = (tag.match(/content\s*=\s*"([^"]*)"/i) || tag.match(/content\s*=\s*'([^']*)'/i) || [])[1];
    if (content) out.push(decode(content));
  }
  return out;
}

/* 品名、品牌整理:分享標題常帶價格(MUJI「…黑色 NT$714」)和網站名(「… | LONGINES TW」、「LEVI'S®官方旗艦店」) */
const PRICE = /\s*(NT\$|US\$|HK\$|\$|¥|￥|€|£)\s?[\d,]+(\.\d+)?\s*起?\s*$/i;
const STORE_WORDS = /官方(網路)?(旗艦店|網站|購物網站|商城|商店|線上商店)|官網|線上購物|網路商店|official\s*(online\s*)?(store|shop|site|website)|online\s*(store|shop)/gi;
const squash = (text) => String(text || "").toLowerCase().replace(/[\s®™'’.]/g, "");

/* 賣場、平台:網站名(「蝦皮購物」「momo購物網」)和網域都不是這件衣服的品牌,只信商品資料裡的 brand */
const MARKETPLACE = /(^|\.)(shopee|momoshop|pchome|24h\.pchome|ruten|rakuten|amazon|zozo|farfetch|ssense|mrporter|net-a-porter|asos|yoox|taobao|tmall|aliexpress|temu|shein|etsy|ebay|pinkoi|etmall|books|costco)\./i;
export const isMarketplaceHost = (host) => MARKETPLACE.test(`.${String(host || "").toLowerCase()}`);

export function cleanBrand(brand, host) {
  const cleaned = decode(brand).replace(STORE_WORDS, "").replace(/[|｜:\-–—\s]+$/, "").replace(/(.+?)\s*(台灣|taiwan|tw)$/i, "$1").trim();
  if (cleaned) return cleaned.replace(/^[a-z]/, (letter) => letter.toUpperCase());
  if (isMarketplaceHost(host)) return "";
  // 網站沒寫品牌:拿網域,首字大寫(本人 2026-10-08);三個字母以內是縮寫,整段大寫(dw.com → DW)。
  // 認得的品牌(muji → MUJI)前端 canonicalBrand 會再換成標準寫法
  const label = String(host || "").replace(/^(www\d?|m|tw|shop|store)\./, "").split(".")[0] || "";
  return label.length <= 3 ? label.toUpperCase() : label.charAt(0).toUpperCase() + label.slice(1);
}

export function cleanName(name, brand) {
  const parts = decode(name).split(/\s*[|｜]\s*/).map((part) => part.replace(PRICE, "").trim()).filter(Boolean);
  const b = squash(brand);
  const noise = (part) => {
    const n = squash(part);
    STORE_WORDS.lastIndex = 0;
    return STORE_WORDS.test(part) || (b && (n === b || (n.startsWith(b) && /^(tw|taiwan|台灣|hk|us|jp)$/.test(n.slice(b.length)))));
  };
  return parts.filter((part, index) => index === 0 || !noise(part)).join(" ").replace(PRICE, "").trim();
}

/* ---------- 價錢 ----------
   2026-10-05 實測各品牌放在哪:og:price / product:price(Shopify 店:DW、Timex、Herschel)、
   itemprop="price"(91APP:MUJI、Levi's)、JSON-LD offers(Lativ、LONGINES)、標題裡的「NT$714」(最後才用)。
   Nike 頁面裡沒有價錢(是瀏覽器跑起來才載入),就沒有。幣別照頁面寫的,不換算。 */
const amountOf = (text) => {
  const n = Number(String(text ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
function guessCurrency(url) {
  const host = url.hostname, path = url.pathname.toLowerCase();
  if (/\.tw$/.test(host) || /(^|[/_-])(zh-tw|zh_tw|tw)([/_-]|$)/.test(path) || /^tw\./.test(host)) return "TWD";
  if (/\.jp$/.test(host) || /\/(ja|jp)([/_-]|$)/.test(path)) return "JPY";
  if (/\.hk$/.test(host) || /\/(zh-hk|hk)([/_-]|$)/.test(path)) return "HKD";
  return "USD";
}
const SYMBOLS = [["NT$", "TWD"], ["US$", "USD"], ["HK$", "HKD"], ["€", "EUR"], ["£", "GBP"], ["￥", "JPY"], ["¥", "JPY"]];
function offerPrice(offers) {
  for (const offer of [].concat(offers || []).flatMap((o) => [o, ...[].concat(o?.offers || [])])) {
    const amount = amountOf(offer?.price ?? offer?.lowPrice ?? offer?.priceSpecification?.price);
    if (amount) return { amount, currency: String(offer.priceCurrency || offer.priceSpecification?.priceCurrency || "").toUpperCase() || null };
  }
  return null;
}
function priceFromPage(html, ldOffers, title, url) {
  for (const [amountKey, currencyKey] of [["og:price:amount", "og:price:currency"], ["product:price:amount", "product:price:currency"], ["price", "priceCurrency"]]) {
    const amount = amountOf(metaContents(html, amountKey)[0]);
    if (amount) return { amount, currency: (metaContents(html, currencyKey)[0] || guessCurrency(url)).toUpperCase() };
  }
  const fromLd = offerPrice(ldOffers);
  if (fromLd) return { amount: fromLd.amount, currency: fromLd.currency || guessCurrency(url) };
  const inTitle = String(title || "").match(/(NT\$|US\$|HK\$|€|£|￥|¥|\$)\s?([\d,]+(?:\.\d+)?)/);
  if (inTitle) {
    const amount = amountOf(inTitle[2]);
    if (amount) return { amount, currency: SYMBOLS.find(([symbol]) => symbol === inTitle[1])?.[1] || guessCurrency(url) };
  }
  return null;
}

const imageUrls = (value) => [].concat(value || []).flatMap((entry) => (typeof entry === "string" ? [entry] : entry?.url ? [entry.url] : entry?.contentUrl ? [entry.contentUrl] : []));

function productFromLd(html) {
  for (const [, body] of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(body.trim()); } catch { continue; }
    const nodes = [].concat(data).flatMap((node) => [node, ...[].concat(node?.["@graph"] || [])]);
    for (const node of nodes) {
      const type = [].concat(node?.["@type"] || []).join(" ");
      if (!/\bProduct\b|ProductGroup/i.test(type)) continue;
      const variants = [].concat(node.hasVariant || []);
      return {
        name: decode(node.name),
        brand: decode(typeof node.brand === "string" ? node.brand : node.brand?.name),
        images: [...imageUrls(node.image), ...variants.flatMap((variant) => imageUrls(variant?.image))],
        offers: [node.offers, ...variants.map((variant) => variant?.offers)].filter(Boolean),
      };
    }
  }
  return null;
}

const looksBlocked = (status, html) => status === 403 || status === 429 || status === 503
  || /captcha|cf-chl|challenge-platform|px-captcha|are you a robot|verify you are human|access denied/i.test(html.slice(0, 30000));

/* Shopify 的圖可以用網址參數要小一點的:挑圖時給 480 寬,下載去背給 1400 寬,不用整張原圖 */
function sized(src, width) {
  try {
    const url = new URL(src);
    if (!/(^|\.)cdn\.shopify\.com$/.test(url.hostname) && !url.pathname.includes("/cdn/shop/")) return src;
    url.searchParams.set("width", String(width));
    return url.href;
  } catch { return src; }
}

const sign = (secret, src) => createHmac("sha256", secret).update(src).digest("base64url").slice(0, 32);

/** 讀商品頁。回 { status, body };body = { name, brand, images: [{ thumb, full }] } 或 { blocked } / { error }。 */
export async function readProductPage(pageUrl, secret) {
  const start = checkUrl(pageUrl);
  if (!start) return { status: 400, body: { error: "這個網址不能讀" } };
  let page;
  try {
    page = await fetchLimited(start, "text/html,application/xhtml+xml", MAX_HTML, { truncate: true });
  } catch (error) {
    // 不拒絕也不回應(H&M 實測等 30 秒都沒回),是大品牌常見的擋法:當成擋住了,前端叫人改用截圖
    if (error?.name === "TimeoutError") return { status: 200, body: { blocked: true, timeout: true, images: [] } };
    throw error;
  }
  const { response, url, bytes } = page;
  const html = new TextDecoder().decode(bytes);
  if (!response.ok || !/html/i.test(response.headers.get("content-type") || "html")) {
    return { status: 200, body: { blocked: looksBlocked(response.status, html), images: [], status: response.status } };
  }

  let name = "", brand = "", sources = [];
  // Shopify:/products/<handle> 有一份公開的 .js,整組圖都在裡面
  const handle = url.pathname.match(/^(.*\/products\/[^/?#]+)/)?.[1];
  if (handle && /Shopify|cdn\/shop\//.test(html)) {
    try {
      const shop = await fetchLimited(new URL(`${handle}.js`, url.origin), "application/json", MAX_HTML, { truncate: false });
      const data = JSON.parse(new TextDecoder().decode(shop.bytes));
      name = decode(data.title);
      brand = decode(data.vendor);
      sources = imageUrls(data.images).map((src) => (src.startsWith("//") ? `https:${src}` : src));
    } catch { /* 拿不到就照一般網頁讀 */ }
  }
  const ld = productFromLd(html);
  const ogTitle = metaContents(html, "og:title")[0] || "";
  const price = priceFromPage(html, ld?.offers, ogTitle, url);
  // 分享標題比 JSON-LD 的品名完整就用它(LONGINES:「巨擘系列」vs「巨擘系列 | Ø 40.00 mm, 銀色 | L2.793.4.73.2 | LONGINES TW」)
  const ldName = ld?.name && ogTitle.includes(ld.name) && ogTitle.length > ld.name.length ? ogTitle : ld?.name;
  name ||= ldName || ogTitle || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]);
  // 賣場的 og:site_name 是賣場名,不是品牌
  brand ||= ld?.brand || (isMarketplaceHost(url.hostname) ? "" : metaContents(html, "og:site_name")[0]) || "";
  brand = cleanBrand(brand, url.hostname);
  name = cleanName(name, brand);
  sources = [...sources, ...(ld?.images || []), ...metaContents(html, "og:image"), ...metaContents(html, "og:image:secure_url"), ...metaContents(html, "twitter:image")];

  const seen = new Set();
  const images = [];
  for (const raw of sources) {
    let src;
    try { src = new URL(raw, url).href; } catch { continue; }
    if (!checkUrl(src) || /\.svg(\?|$)/i.test(src)) continue;
    const key = src.replace(/[?#].*$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const thumb = sized(src, 480), full = sized(src, 1400);
    images.push({
      thumb: `/api/product-image?u=${encodeURIComponent(thumb)}&s=${sign(secret, thumb)}`,
      full: `/api/product-image?u=${encodeURIComponent(full)}&s=${sign(secret, full)}`,
    });
    if (images.length >= MAX_IMAGES) break;
  }
  const blocked = !images.length && !ld && looksBlocked(response.status, html);
  return { status: 200, body: { name: name.slice(0, 120), brand: brand.slice(0, 60), images, price, blocked } };
}

/** 代為下載一張商品圖。只收這裡簽過名的網址。回 { status, body, type }。 */
export async function fetchProductImage(src, signature, secret) {
  const expected = Buffer.from(sign(secret, String(src || "")));
  const given = Buffer.from(String(signature || ""));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { status: 403, body: null };
  const url = checkUrl(src);
  if (!url) return { status: 400, body: null };
  const { response, bytes } = await fetchLimited(url, "image/avif,image/webp,image/png,image/jpeg,image/*", MAX_IMAGE, { truncate: false });
  const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!response.ok || !IMAGE_TYPES.test(type)) return { status: 502, body: null };
  return { status: 200, body: bytes, type };
}
