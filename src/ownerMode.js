// [本 fork 新增] 擁有者模式旗標:決定「公開展覽」還是「後台編輯」。訪客能加自己的衣服,見檔尾 CAN_ADD。
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

/* 2026-10-02 起每個訪客都能加自己的衣服(存在自己的瀏覽器,別人看不到,也碰不到站主的 104 件)。
   站主那 104 件的刪除、編輯仍然只在擁有者模式出現,公開版第一眼才不會滿是垃圾桶。
   ?public 是「看訪客第一眼」的預覽,連新增也收起來。 */
export const CAN_ADD = typeof window === "undefined" ? false : !new URLSearchParams(window.location.search).has("public");

/** 這件能不能改、能不能刪:擁有者什麼都能動;訪客只能動自己加的。 */
export const canEditItem = (item) => CAN_EDIT || Boolean(item?.isLocal);
