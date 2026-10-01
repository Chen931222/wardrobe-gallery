// [本 fork 新增] 擁有者模式旗標:決定「公開展覽」還是「後台編輯」。
// 只是預設呈現的分野,不是安全機制 —— 資料本來就 local-first,訪客即使加 ?edit 改的也只是自己那台瀏覽器的畫面,
// 碰不到伺服器上的 library.json 或站主的資料。目的是讓公開版第一眼是乾淨的展覽,不是滿是垃圾桶的後台。
//   預設:localhost = 編輯、線上 = 唯讀
//   ?edit   線上也能編輯(站主自己補資料時用)
//   ?public 本機也切成公開唯讀(站主想預覽訪客看到什麼)—— 優先權最高
//   ?edit 會記在這台瀏覽器,手機加到主畫面後不必每次帶參數;?edit=off 取消
const OWNER_KEY = "open-wardrobe-owner-v1";

function remember(on) {
  try { on ? localStorage.setItem(OWNER_KEY, "1") : localStorage.removeItem(OWNER_KEY); } catch { /* 私密瀏覽 */ }
}

function computeCanEdit() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.has("public")) return false;
  if (params.has("edit")) {
    const on = params.get("edit") !== "off";
    remember(on);
    return on;
  }
  try { if (localStorage.getItem(OWNER_KEY) === "1") return true; } catch { /* 私密瀏覽 */ }
  return ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
}

export const CAN_EDIT = computeCanEdit();
