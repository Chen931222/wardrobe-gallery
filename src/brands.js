// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
/* 品牌(2026-10-07 本人要的「品牌分類」)。站主那 104 件本來沒有品牌欄位(verified 2026-10-07:library.json 0 件有),
   品牌只寫在品名(「白色 adidas 藍車線連帽帽T」「…(GU)」)和標籤(adidas、nike…)裡,大約 20 件看得出來。
   所以品牌是「看得出來就自動判斷,人可以改」,順序:
     ① 自己填的(單品頁、新增時的「品牌」欄;存成空白 = 刻意不寫,不再猜)
     ② 商品網址的網域(gu-global.com → GU;不認得的網域照網域名、首字大寫,beams.co.jp → Beams;蝦皮、momo 這類賣場不算)
     ③ 品名和標籤裡最前面出現的品牌字(「(Nike MLB)」算 Nike)
   都沒有 → null(目錄裡的「沒寫」)。 */

// [顯示的名字, ...認得的寫法]。英文照單字比對(gu 不會比到 gucci);中文照字串。
// 大寫才算的:COACH(coach jacket 是外套款式,不是品牌)
const BRANDS = [
  ["Adidas", "adidas", "愛迪達"], ["Nike", "nike", "耐吉"], ["MLB", "mlb"], ["GU", "gu"], ["UNIQLO", "uniqlo", "優衣庫"],
  ["Lacoste", "lacoste"], ["New Balance", "new balance"], ["Dickies", "dickies"], ["Samsonite", "samsonite"],
  ["Timberland", "timberland"], ["Under Armour", "under armour", "ua"], ["Polo Ralph Lauren", "polo ralph lauren", "ralph lauren", "polo-rl"],
  ["TOD'S", "tod's", "tods"], ["COACH", { exact: "COACH" }], ["Massimo Dutti", "massimo dutti"], ["Zara", "zara"],
  ["MUJI", "muji", "無印良品"], ["Levi's", "levi's", "levis"], ["Champion", "champion"], ["Carhartt", "carhartt"],
  ["The North Face", "the north face", "north face"], ["Converse", "converse"], ["Vans", "vans"], ["PUMA", "puma"],
  ["ASICS", "asics"], ["Onitsuka Tiger", "onitsuka tiger"], ["BEEN IDEA", "been idea"], ["H&M", "h&m"], ["Arket", "arket"],
  ["Patagonia", "patagonia"], ["Arc'teryx", "arc'teryx", "arcteryx"], ["Columbia", "columbia"], ["Birkenstock", "birkenstock"],
  ["Dr. Martens", "dr. martens", "dr martens"], ["Crocs", "crocs"], ["Salomon", "salomon"], ["HOKA", "hoka"], ["FILA", "fila"],
  ["Kangol", "kangol"], ["Herschel", "herschel"], ["PORTER", "porter", "吉田"], ["Longines", "longines", "浪琴"],
  ["Casio", "casio"], ["Seiko", "seiko"], ["ALONEMASTER", "alonemaster"], ["Lativ", "lativ"], ["BEAMS", "beams"], ["Ray-Ban", "ray-ban", "rayban"], ["Montblanc", "montblanc", "萬寶龍"],
  ["LAMY", "lamy"], ["Pilot", "pilot"], ["Sailor", "sailor"], ["Parker", "parker"], ["Zippo", "zippo"],
];

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MATCHERS = BRANDS.flatMap(([name, ...ways]) => ways.map((way) => {
  if (typeof way === "object") return { name, re: new RegExp(`(^|[^A-Za-z0-9])${escape(way.exact)}(?=[^A-Za-z0-9]|$)`) };
  if (/[㐀-鿿]/.test(way)) return { name, re: new RegExp(escape(way)) };
  return { name, re: new RegExp(`(^|[^a-z0-9])${escape(way)}(?=[^a-z0-9]|$)`, "i") };
}));

/** 一段文字裡最前面出現的品牌;沒有回 null */
export function brandInText(text) {
  const source = String(text || "");
  let best = null, at = Infinity;
  for (const { name, re } of MATCHERS) {
    const match = re.exec(source);
    if (!match) continue;
    const index = match.index + (match[1] ? match[1].length : 0);
    if (index < at) { at = index; best = name; }
  }
  return best;
}

// 網域 → 品牌:主要的名字和品牌字不一樣的才列;其他照網域裡的單字比對(www.coach.com → COACH)
const DOMAINS = { "gu-global.com": "GU", "coach.com": "COACH", "massimodutti.com": "Massimo Dutti", "thenorthface.com": "The North Face", "newbalance.com": "New Balance", "levi.com": "Levi's", "hm.com": "H&M", "ralphlauren.com": "Polo Ralph Lauren", "underarmour.com": "Under Armour" };

/* 網域本身是賣場、短網址、社群,不是品牌(蝦皮、momo、PChome…):這些站讀不到品牌就留空,
   不能把「Shopee」當成這件衣服的牌子。品牌要從商品頁的資料(JSON-LD 的 brand)拿。 */
const NOT_BRAND_SITES = new Set([
  "shopee", "shp", "momoshop", "momo", "pchome", "24h", "ruten", "yahoo", "tw.bid", "rakuten", "amazon", "amzn",
  "zozo", "zozotown", "farfetch", "ssense", "mrporter", "net-a-porter", "asos", "yoox", "taobao", "tmall", "jd",
  "aliexpress", "temu", "shein", "etsy", "ebay", "pinkoi", "etmall", "friday", "books", "costco", "carrefour",
  "line", "lin", "instagram", "facebook", "fb", "threads", "twitter", "x", "google", "goo", "youtube", "youtu",
  "bit", "tinyurl", "reurl", "lihi", "lihi1", "lihi2", "pse", "linktr",
]);
// 網域尾巴和前綴:剩下的那一段才是品牌(www.beams.co.jp → beams、tw.puma.com → puma、xxx.myshopify.com → xxx)
const SUFFIX = new Set(["com", "net", "org", "co", "io", "shop", "store", "tw", "jp", "kr", "hk", "cn", "us", "uk", "eu", "de", "fr", "it", "au", "sg", "myshopify", "global"]);
const PREFIX = new Set(["www", "www2", "m", "shop", "store", "tw", "en", "jp", "us", "global", "online", "eshop", "official"]);
const squash = (text) => String(text || "").toLowerCase().replace(/[\s®™'’.\-&_]/g, "");

/** 品牌的寫法統一:認得的換成標準寫法(adidas、ADIDAS → Adidas;north face → The North Face),
 *  其他照原樣、只把第一個字母改大寫(beams → Beams)。空的回 null。 */
export function canonicalBrand(text) {
  let raw = String(text || "").trim();
  if (!raw) return null;
  // 英文品牌後面接中文公司名(商品頁的網站名「lativ 米格國際」「UNIQLO 優衣庫」)只留英文那段
  const latinHead = raw.match(/^([A-Za-z][A-Za-z0-9&'’.\- ]*?)\s+[㐀-鿿][㐀-鿿\s]*$/);
  if (latinHead) raw = latinHead[1].trim();
  const key = squash(raw);
  const known = BRANDS.find(([name, ...ways]) => squash(name) === key
    || ways.some((way) => squash(typeof way === "object" ? way.exact : way) === key));
  if (known) return known[0];
  return raw.replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

/** 網址看得出來的品牌;賣場、短網址、看不出來回 null */
export function brandInUrl(url) {
  let host;
  try { host = new URL(String(url || "")).hostname.toLowerCase(); } catch { return null; }
  for (const [domain, name] of Object.entries(DOMAINS)) if (host === domain || host.endsWith(`.${domain}`)) return name;
  const labels = host.split(".");
  if (labels.some((label) => NOT_BRAND_SITES.has(label)) || NOT_BRAND_SITES.has(labels.slice(-2).join("."))) return null;
  // 認得的品牌字在網域裡任何一段都算(store.nike.com、shop.muji.tw)
  for (const label of labels) {
    const name = BRANDS.find(([, ...ways]) => ways.some((way) => typeof way === "string" && squash(way) === label.replace(/-/g, "")))?.[0];
    if (name) return name;
  }
  // 不認得:拿掉尾巴和前綴,剩下最後一段當品牌,連字號換空白、每個字首字大寫(beams.co.jp → Beams、our-legacy.com → Our Legacy);
  // 三個字母以內多半是縮寫,整段大寫(dw.com → DW)
  const core = labels.filter((label) => !SUFFIX.has(label));
  while (core.length > 1 && PREFIX.has(core[0])) core.shift();
  const label = core[core.length - 1];
  if (!label || PREFIX.has(label) || /^\d+$/.test(label) || label.length < 2) return null;
  if (label.length <= 3) return label.toUpperCase();
  return label.split("-").filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/** 這個網址是不是賣場或短網址(網域不是品牌) */
export function isMarketplaceUrl(url) {
  try {
    const labels = new URL(String(url || "")).hostname.toLowerCase().split(".");
    return labels.some((label) => NOT_BRAND_SITES.has(label));
  } catch { return false; }
}

/** 這件的品牌;不知道回 null */
export function brandOf(item) {
  if (!item) return null;
  // 自己填的也統一寫法:「adidas」「ADIDAS」不會在目錄裡變成兩個品牌
  if (typeof item.brand === "string") return canonicalBrand(item.brand);
  return brandInUrl(item.sourceUrl) || brandInText([item.name, ...(item.tags || [])].join(" "));
}

/** 品牌欄的建議清單:衣櫃裡已經有的排前面,再接常見的 */
export function brandSuggestions(items = []) {
  const mine = [...new Set(items.map(brandOf).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return [...mine, ...BRANDS.map(([name]) => name).filter((name) => !mine.includes(name))];
}
