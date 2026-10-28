// [本 fork 新增] /api/weather 的 Vercel function 入口:規則在 _weather-core.mjs。
// 授權碼是 Vercel 的環境變數(vercel env add CWA_API_KEY production,本人自己加),程式碼裡沒有;沒設就改問 Open-Meteo。
// _city.mjs 由 tools/export-static.mjs 匯出時從 src/city.js 複製過來,城市清單跟畫面上的選單同一份。
import { handleWeather } from "./_weather-core.mjs";
import { overLimit, tooMany } from "./_rate-limit.mjs";
import { CITIES } from "./_city.mjs";

export async function GET(request) {
  const wait = overLimit(request, "weather", 60);   // 正常人一分鐘換不到幾次城市;快取命中的不會進到這裡
  if (wait) return tooMany(wait);
  return handleWeather(request, { cities: CITIES, apiKey: (process.env.CWA_API_KEY || "").trim() });
}
