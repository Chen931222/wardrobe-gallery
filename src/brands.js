// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
/* 品牌(2026-10-07 本人要的「品牌分類」)。站主那 104 件本來沒有品牌欄位(verified 2026-10-07:library.json 0 件有),
   品牌只寫在品名(「白色 adidas 藍車線連帽帽T」「…(GU)」)和標籤(adidas、nike…)裡,大約 20 件看得出來。
   所以品牌是「看得出來就自動判斷,人可以改」,順序:
     ① 自己填的(單品頁、新增時的「品牌」欄;存成空白 = 刻意不寫,不再猜)
     ② 商品網址的網域(gu-global.com → GU)
     ③ 品名和標籤裡最前面出現的品牌字(「(Nike MLB)」算 Nike)
   都沒有 → null(目錄裡的「沒寫」)。 */

// [顯示的名字, ...認得的寫法]。英文照單字比對(gu 不會比到 gucci);中文照字串。
// 大寫才算的:COACH(coach jacket 是外套款式,不是品牌)
const BRANDS = [
  ["adidas", "adidas", "愛迪達"], ["Nike", "nike", "耐吉"], ["MLB", "mlb"], ["GU", "gu"], ["UNIQLO", "uniqlo", "優衣庫"],
  ["Lacoste", "lacoste"], ["New Balance", "new balance"], ["Dickies", "dickies"], ["Samsonite", "samsonite"],
  ["Timberland", "timberland"], ["Under Armour", "under armour", "ua"], ["Polo Ralph Lauren", "polo ralph lauren", "ralph lauren", "polo-rl"],
  ["TOD'S", "tod's", "tods"], ["COACH", { exact: "COACH" }], ["Massimo Dutti", "massimo dutti"], ["Zara", "zara"],
  ["MUJI", "muji", "無印良品"], ["Levi's", "levi's", "levis"], ["Champion", "champion"], ["Carhartt", "carhartt"],
  ["The North Face", "the north face", "north face"], ["Converse", "converse"], ["Vans", "vans"], ["PUMA", "puma"],
  ["ASICS", "asics"], ["Onitsuka Tiger", "onitsuka tiger"], ["BEEN IDEA", "been idea"], ["H&M", "h&m"], ["Arket", "arket"],
  ["Patagonia", "patagonia"], ["Arc'teryx", "arc'teryx", "arcteryx"], ["Columbia", "columbia"], ["Birkenstock", "birkenstock"],
  ["Dr. Martens", "dr. martens", "dr martens"], ["Crocs", "crocs"], ["Salomon", "salomon"], ["HOKA", "hoka"], ["FILA", "fila"],
  ["Kangol", "kangol"], ["Herschel", "herschel"], ["PORTER", "porter", "吉田"], ["Longines", "longines", "浪琴"],
  ["Casio", "casio"], ["Seiko", "seiko"], ["Ray-Ban", "ray-ban", "rayban"], ["Montblanc", "montblanc", "萬寶龍"],
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
function brandInUrl(url) {
  let host;
  try { host = new URL(String(url || "")).hostname.toLowerCase(); } catch { return null; }
  for (const [domain, name] of Object.entries(DOMAINS)) if (host === domain || host.endsWith(`.${domain}`)) return name;
  const words = host.split(".").filter((word) => !["www", "com", "tw", "jp", "net", "shop", "store", "co"].includes(word));
  for (const word of words) {
    const name = BRANDS.find(([, ...ways]) => ways.some((way) => typeof way === "string" && way.replace(/[^a-z0-9]/g, "") === word))?.[0];
    if (name) return name;
  }
  return null;
}

/** 這件的品牌;不知道回 null */
export function brandOf(item) {
  if (!item) return null;
  if (typeof item.brand === "string") return item.brand.trim() || null;
  return brandInUrl(item.sourceUrl) || brandInText([item.name, ...(item.tags || [])].join(" "));
}

/** 品牌欄的建議清單:衣櫃裡已經有的排前面,再接常見的 */
export function brandSuggestions(items = []) {
  const mine = [...new Set(items.map(brandOf).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return [...mine, ...BRANDS.map(([name]) => name).filter((name) => !mine.includes(name))];
}
