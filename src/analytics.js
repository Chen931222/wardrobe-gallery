// [本 fork 新增] 使用統計(2026-10-09 本人要):驗證「有沒有人要付錢」那兩週,看測試的人有沒有回來用、有沒有真的加衣服,
// 不只聽他們說。用 Umami Cloud:不放 cookie、不存 IP(只拿來推國家,算訪客用每月換一次的雜湊)。
//
// 只在這幾種情況才載入:正式站、有設 VITE_UMAMI_ID(寫在 .env,不進 git;fork 的人不會把資料送到這裡)、
// 不是擁有者模式(站主自己的裝置不算進去)、瀏覽器沒開「不要追蹤」。
// 其他裝置要排除:網址加 ?notrack(記在這台瀏覽器);?notrack=off 取消。
// 送出的只有:看了哪一頁(網址的 ?、# 後面不送)、裝置瀏覽器國家、下面 track() 的事件名稱。衣服的名稱、照片、同步碼都不送。
// 改了送出的東西,要回來改 public/privacy.html 的「使用統計」。
import { CAN_EDIT } from "./ownerMode.js";

const SITE = "wardrobe-gallery.vercel.app";
const OFF_KEY = "umami.disabled";   // Umami 腳本自己也會看這個鍵

function optOut() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("notrack")) return;
  try {
    params.get("notrack") === "off" ? localStorage.removeItem(OFF_KEY) : localStorage.setItem(OFF_KEY, "1");
  } catch { /* 私密瀏覽 */ }
  params.delete("notrack");
  const rest = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
}

export function loadAnalytics() {
  const id = import.meta.env.VITE_UMAMI_ID;
  if (!import.meta.env.PROD || !id || window.location.hostname !== SITE) return;
  optOut();
  try { if (localStorage.getItem(OFF_KEY)) return; } catch { /* 私密瀏覽:照常 */ }
  if (CAN_EDIT) return;
  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://cloud.umami.is/script.js";
  script.dataset.websiteId = id;
  script.dataset.domains = SITE;
  script.dataset.doNotTrack = "true";
  script.dataset.excludeSearch = "true";
  script.dataset.excludeHash = "true";
  document.head.appendChild(script);
}

/** 記一個事件(沒載入就什麼都不做)。data 只放類別,不放衣服名稱這類內容 */
export function track(name, data) {
  try { window.umami?.track(name, data); } catch { /* 統計壞了不影響使用 */ }
}
