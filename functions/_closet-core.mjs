// [本 fork 新增] /api/closet 的規則:站主完整的衣櫃,只給已經開通同步的裝置。
//
// 2026-10-05 前,站主全部衣服都在公開的 /data/wardrobe.json,畫面上只藏起來,直接開網址看得到全部。
// 現在公開的只剩示範的 20 件;完整的這份放在 function 裡(api/_owner-closet.mjs,匯出時產生、不進 git),
// 要帶一組開通名單裡的同步碼(x-sync-code)才給。站主的手機、平板本來就輸入過同步碼,不用多做什麼。
// 不在示範裡的衣服,圖也換成猜不到的檔名(/data/p/…),只寫在這份清單裡。
//
// 開通名單和同步共用(_sync-core 的 isOpenCode),讀名單先走 CDN 快取。

import { isOpenCode } from "./_sync-core.mjs";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * @param {Request} request
 * @param store 跟 _sync-core 一樣的 store(這裡只會讀開通名單)
 * @param closet 站主完整的衣櫃(陣列)
 */
export async function handleCloset(request, store, closet) {
  if (request.method !== "GET") return json({ error: "不支援" }, 405);
  const code = request.headers.get("x-sync-code");
  if (!code) return json({ error: "要先輸入同步碼", reason: "no-code" }, 401);
  if (!(await isOpenCode(store, code))) return json({ error: "這組同步碼沒有開通,或已經換成新碼", reason: "unknown-space" }, 403);
  return json(closet);
}
