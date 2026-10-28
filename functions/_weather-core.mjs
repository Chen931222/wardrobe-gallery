// [本 fork 新增] /api/weather 的規則:今天的天氣,改由這個網站的伺服器去問(2026-10-26)。
//
// 為什麼換、為什麼經過伺服器(2026-10-26 授權盤點,本人選「換中央氣象署」):
//   原本瀏覽器直接問 Open-Meteo。它的免費版只准非商業用途,條款把「有訂閱或廣告的網站」列為商用,開始收費那天就違約。
//   中央氣象署的開放資料依「政府資料開放授權條款－第1版」,可以商用,寫出處就好;要一組授權碼(本人註冊,存在 Vercel 的環境變數 CWA_API_KEY)。
//   授權碼不能放進前端,所以由伺服器去問;順便:使用者的網路位址不再送到天氣服務,同一個城市半小時內只問一次(CDN 快取)。
//   還沒設定授權碼時改問 Open-Meteo,網站照常能用;設好之後就不再用它。
//
// 用的資料集:F-D0047-089「臺灣未來 3 天天氣預報」(縣市層級,逐 3 小時):溫度、體感溫度、3 小時降雨機率、天氣現象。
// 欄位名稱照氣象署產品說明文件(F-D0047-001_093.pdf,2024-12-10 版):records.Locations[].Location[].WeatherElement[]
// .ElementName / .Time[].DataTime 或 StartTime、EndTime / .ElementValue[].Temperature 等。讀的時候大小寫都認(舊版 API 是小寫)。
//
// 回給前端的跟以前 fetchWeather 回的一樣:{ temp, feelsLike, desc, rainProb, tMax, tMin },外加 source(cwa / open-meteo)。
// 「今天」照接下來 24 小時算:降雨機率取最大、最高最低溫取這段的(以前是 Open-Meteo 的整個日曆日)。

const CWA_URL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-089";
const CWA_ELEMENTS = ["溫度", "體感溫度", "3小時降雨機率", "天氣現象"];
const DAY = 24 * 60 * 60 * 1000;

const WMO_DESC = {
  0: "晴朗", 1: "大致晴朗", 2: "多雲", 3: "陰天", 45: "起霧", 48: "起霧",
  51: "毛毛雨", 53: "毛毛雨", 55: "毛毛雨", 61: "小雨", 63: "中雨", 65: "大雨",
  80: "陣雨", 81: "陣雨", 82: "強陣雨", 95: "雷雨", 96: "雷雨", 99: "雷雨",
};

/** 物件的某個鍵,大小寫都認(Locations / locations) */
function pick(object, name) {
  if (!object || typeof object !== "object") return undefined;
  if (name in object) return object[name];
  const lower = name.toLowerCase();
  const key = Object.keys(object).find((candidate) => candidate.toLowerCase() === lower);
  return key === undefined ? undefined : object[key];
}
const list = (value) => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

/** 一個氣象因子的時間序列:[{ start, end, value }],value 是 ElementValue 裡第一個值(數字的轉成數字) */
function series(element) {
  return list(pick(element, "Time")).map((slot) => {
    const start = Date.parse(pick(slot, "DataTime") ?? pick(slot, "StartTime"));
    const end = Date.parse(pick(slot, "EndTime")) || start + 3 * 60 * 60 * 1000;
    const raw = list(pick(slot, "ElementValue"))[0];
    const first = raw && typeof raw === "object" ? Object.values(raw)[0] : raw;
    const number = Number(first);
    return { start, end, value: first !== "" && first !== null && Number.isFinite(number) ? number : first };
  }).filter((slot) => Number.isFinite(slot.start));
}

/** 解析氣象署回的 JSON(拆出來,沒有授權碼也能拿範例測) */
export function parseCwa(data, now = Date.now()) {
  const locations = list(pick(pick(data, "records"), "Locations"));
  const location = list(pick(locations[0], "Location"))[0];
  if (!location) throw new Error("氣象署回的資料裡沒有這個縣市");
  const elements = new Map(list(pick(location, "WeatherElement")).map((element) => [pick(element, "ElementName"), series(element)]));
  const missing = CWA_ELEMENTS.filter((name) => !elements.get(name)?.length);
  if (missing.length) throw new Error(`氣象署回的資料少了:${missing.join("、")}`);

  // 現在落在哪一格:開始時間 ≤ 現在的最後一格;都在未來(剛發布)就拿第一格
  const current = (slots) => slots.filter((slot) => slot.start <= now).at(-1) || slots[0];
  const ahead = (slots) => slots.filter((slot) => slot.end > now && slot.start < now + DAY);
  const temps = ahead(elements.get("溫度")).map((slot) => slot.value).filter(Number.isFinite);
  const rain = ahead(elements.get("3小時降雨機率")).map((slot) => slot.value).filter(Number.isFinite);
  const temp = current(elements.get("溫度")).value;
  const feelsLike = current(elements.get("體感溫度")).value;
  if (!Number.isFinite(temp) || !Number.isFinite(feelsLike)) throw new Error("氣象署回的溫度不是數字");
  return {
    temp: Math.round(temp),
    feelsLike: Math.round(feelsLike),
    desc: String(current(elements.get("天氣現象")).value ?? ""),
    rainProb: rain.length ? Math.max(...rain) : 0,
    tMax: Math.round(temps.length ? Math.max(...temps) : temp),
    tMin: Math.round(temps.length ? Math.min(...temps) : temp),
  };
}

async function fromCwa(city, apiKey, fetchImpl, now) {
  const params = new URLSearchParams({ Authorization: apiKey, format: "JSON", LocationName: city.county, ElementName: CWA_ELEMENTS.join(",") });
  const response = await fetchImpl(`${CWA_URL}?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`氣象署回 ${response.status}`);
  return parseCwa(await response.json(), now);
}

async function fromOpenMeteo(city, fetchImpl) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}`
    + `&current=temperature_2m,apparent_temperature,weather_code`
    + `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max`
    + `&timezone=Asia%2FTaipei&forecast_days=1`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Open-Meteo 回 ${response.status}`);
  const data = await response.json();
  return {
    temp: Math.round(data.current.temperature_2m),
    feelsLike: Math.round(data.current.apparent_temperature),
    desc: WMO_DESC[data.current.weather_code] || "",
    rainProb: data.daily.precipitation_probability_max[0] ?? 0,
    tMax: Math.round(data.daily.temperature_2m_max[0]),
    tMin: Math.round(data.daily.temperature_2m_min[0]),
  };
}

// 同一台 function 半小時內同一個城市只問一次(CDN 沒命中時的第二道)
const memo = new Map();
const MEMO_FOR = 30 * 60 * 1000;

/**
 * GET /api/weather?city=<key>。只收 city 一個參數:多帶別的參數會繞過 CDN 快取、每次都打到氣象署,直接 400。
 * @param cities src/city.js 的 CITIES(每個有 key、label、county、lat、lon)
 */
export async function handleWeather(request, { cities, apiKey, fetchImpl = fetch, now = Date.now() }) {
  const json = (body, status, cache) => Response.json(body, { status, headers: { "Cache-Control": cache } });
  if (request.method !== "GET") return json({ error: "只收 GET" }, 405, "no-store");
  const params = new URL(request.url).searchParams;
  const city = cities.find((candidate) => candidate.key === params.get("city"));
  if (!city || [...params.keys()].some((key) => key !== "city")) return json({ error: "城市不對" }, 400, "no-store");
  const source = apiKey ? "cwa" : "open-meteo";
  const memoKey = `${source}:${city.key}`;
  const hit = memo.get(memoKey);
  try {
    const weather = hit && now - hit.at < MEMO_FOR ? hit.weather
      : apiKey ? await fromCwa(city, apiKey, fetchImpl, now) : await fromOpenMeteo(city, fetchImpl);
    if (!hit || hit.weather !== weather) memo.set(memoKey, { at: now, weather });
    return json({ ...weather, source }, 200, "public, max-age=600, s-maxage=1800, stale-while-revalidate=1800");
  } catch (error) {
    return json({ error: `抓不到天氣:${error?.message || error}` }, 502, "no-store");
  }
}
