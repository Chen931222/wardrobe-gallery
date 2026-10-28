// [本 fork 新增] 開發伺服器上的 /api/weather,和線上共用 functions/_weather-core.mjs。
// 氣象署授權碼:先看環境變數 CWA_API_KEY,沒有就讀專案根目錄的 .env(CWA_API_KEY=…,.env 不進 git)。
// 每次請求重讀,放好 .env 不用重開開發伺服器。都沒有就跟線上一樣改問 Open-Meteo。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { handleWeather } from "../functions/_weather-core.mjs";
import { CITIES } from "../src/city.js";

async function apiKey() {
  if (process.env.CWA_API_KEY?.trim()) return process.env.CWA_API_KEY.trim();
  try {
    const text = await readFile(join(process.cwd(), ".env"), "utf8");
    return (text.match(/^\s*CWA_API_KEY\s*=\s*"?([^"\r\n]+)"?\s*$/m) || [])[1]?.trim() || "";
  } catch {
    return "";
  }
}

export function weatherApi() {
  return {
    name: "weather-api",
    configureServer(server) {
      server.middlewares.use("/api/weather", async (req, res) => {
        const response = await handleWeather(new Request(`http://localhost${req.originalUrl || req.url}`), { cities: CITIES, apiKey: await apiKey() });
        res.statusCode = response.status;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", response.headers.get("Cache-Control") || "no-store");
        res.end(await response.text());
      });
    },
  };
}
