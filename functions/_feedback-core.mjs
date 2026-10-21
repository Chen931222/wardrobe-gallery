// [本 fork 新增] 回報問題(2026-10-21,行銷企劃第 0 週):站上唯一能聽到陌生人聲音的管道。
// 規則在這裡,線上入口 feedback.mjs 接 Discord webhook;開發時 scripts/feedback-api.mjs 印在終端機。
//
// 收什麼:一段字(1–1000 字)、選填的聯絡方式(≤200 字)、在哪一頁、裝置一句話(瀏覽器給的 UA 前 160 字)。
// 不收 IP、不收衣服、不收同步碼。送到哪:Discord 私人頻道的 webhook(環境變數 FEEDBACK_WEBHOOK),
// 沒設就回 503「還沒接上」,前端會請使用者改用 Email。

const MAX_TEXT = 1000;
const MAX_CONTACT = 200;

/** 檢查輸入;不合格回錯誤字串,合格回整理過的物件 */
export function cleanFeedback(body) {
  const text = String(body?.text || "").trim();
  if (!text) return { error: "寫一句話再送" };
  if (text.length > MAX_TEXT) return { error: `太長了,最多 ${MAX_TEXT} 字` };
  const contact = String(body?.contact || "").trim().slice(0, MAX_CONTACT);
  const page = String(body?.page || "").trim().slice(0, 80);
  const device = String(body?.device || "").trim().slice(0, 160);
  return { text, contact, page, device };
}

/** 組成要送到 Discord 的訊息(純文字,2000 字以內) */
export function formatFeedback({ text, contact, page, device }, when = new Date()) {
  const stamp = when.toISOString().replace("T", " ").slice(0, 16);
  const lines = [`**衣櫃回報** ${stamp} UTC${page ? ` · ${page}` : ""}`, text];
  if (contact) lines.push(`聯絡:${contact}`);
  if (device) lines.push(`裝置:${device}`);
  return lines.join("\n").slice(0, 1990);
}

/** 共用的處理流程:deliver(message) 負責送出去(Discord、終端機…),丟錯就回 502 */
export async function handleFeedback(request, deliver) {
  if (request.method !== "POST") return Response.json({ error: "只收 POST" }, { status: 405 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "格式不對" }, { status: 400 }); }
  const cleaned = cleanFeedback(body);
  if (cleaned.error) return Response.json({ error: cleaned.error }, { status: 400 });
  try {
    const sent = await deliver(formatFeedback(cleaned));
    if (sent === false) return Response.json({ error: "回報功能還沒接上" }, { status: 503 });
  } catch (error) {
    return Response.json({ error: `送不出去:${error?.message || error}` }, { status: 502 });
  }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
