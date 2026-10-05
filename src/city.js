// [本 fork 新增] 天氣看哪個城市。
//
// 2026-10-05:原本寫死台中(站主住台中);給朋友用之後,住台北、高雄的人看到的是台中的天氣。
// 做成選單,不跟瀏覽器要定位權限(多一個彈窗、拒絕了還要另外處理,換來的只是縣市級的精度)。
// 存在這台裝置(open-wardrobe-city-v1),會跟著備份走,不同步。
export const CITIES = [
  { key: "keelung", label: "基隆", lat: 25.1276, lon: 121.7392 },
  { key: "taipei", label: "台北", lat: 25.033, lon: 121.5654 },
  { key: "newtaipei", label: "新北", lat: 25.012, lon: 121.4625 },
  { key: "taoyuan", label: "桃園", lat: 24.9936, lon: 121.301 },
  { key: "hsinchu", label: "新竹", lat: 24.8138, lon: 120.9675 },
  { key: "miaoli", label: "苗栗", lat: 24.5602, lon: 120.8214 },
  { key: "taichung", label: "台中", lat: 24.1477, lon: 120.6736 },
  { key: "changhua", label: "彰化", lat: 24.0809, lon: 120.5385 },
  { key: "nantou", label: "南投", lat: 23.9097, lon: 120.6838 },
  { key: "yunlin", label: "雲林", lat: 23.7092, lon: 120.5434 },
  { key: "chiayi", label: "嘉義", lat: 23.4801, lon: 120.4491 },
  { key: "tainan", label: "台南", lat: 22.9997, lon: 120.227 },
  { key: "kaohsiung", label: "高雄", lat: 22.6273, lon: 120.3014 },
  { key: "pingtung", label: "屏東", lat: 22.672, lon: 120.488 },
  { key: "yilan", label: "宜蘭", lat: 24.757, lon: 121.7533 },
  { key: "hualien", label: "花蓮", lat: 23.9871, lon: 121.6015 },
  { key: "taitung", label: "台東", lat: 22.7583, lon: 121.1444 },
  { key: "penghu", label: "澎湖", lat: 23.5655, lon: 119.5793 },
  { key: "kinmen", label: "金門", lat: 24.4365, lon: 118.3186 },
  { key: "matsu", label: "馬祖", lat: 26.1597, lon: 119.9497 },
];
const CITY_KEY = "open-wardrobe-city-v1";
const DEFAULT = CITIES.find((city) => city.key === "taichung");
let chosen = null;   // 這次瀏覽選的(localStorage 存不了時也算數)

export function readCity() {
  try {
    const key = chosen || localStorage.getItem(CITY_KEY);
    return CITIES.find((city) => city.key === key) || DEFAULT;
  } catch {
    return CITIES.find((city) => city.key === chosen) || DEFAULT;
  }
}

/** 換城市:存起來,通知畫面上每個顯示天氣的地方重抓。 */
export function saveCity(key) {
  if (!CITIES.some((city) => city.key === key)) return;
  chosen = key;
  try { localStorage.setItem(CITY_KEY, key); } catch { /* 存不了就只換這一次 */ }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("wardrobe-city-change", { detail: { key } }));
}
