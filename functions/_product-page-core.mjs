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

/** 自己跟轉址(最多 5 次,每一站都檢查),讀到上限就停。 */
async function fetchLimited(start, accept, limit, { truncate }) {
  let current = start;
  for (let hop = 0; hop < 6; hop += 1) {
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
  const { response, url, bytes } = await fetchLimited(start, "text/html,application/xhtml+xml", MAX_HTML, { truncate: true });
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
  name ||= ld?.name || metaContents(html, "og:title")[0] || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]);
  brand ||= ld?.brand || metaContents(html, "og:site_name")[0] || "";
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
  return { status: 200, body: { name: name.slice(0, 120), brand: brand.slice(0, 60), images, blocked } };
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
