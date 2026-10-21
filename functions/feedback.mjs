// [本 fork 新增] /api/feedback 的 Vercel function 入口:規則在 _feedback-core.mjs,這裡只接 Discord webhook。
// FEEDBACK_WEBHOOK 是 Vercel 的環境變數(vercel env add FEEDBACK_WEBHOOK production),程式碼裡沒有網址。
// 每個 IP 每分鐘 3 則:這是給人打字用的,不是 API。

import { overLimit, tooMany } from "./_rate-limit.mjs";
import { handleFeedback } from "./_feedback-core.mjs";

async function toDiscord(message) {
  const url = process.env.FEEDBACK_WEBHOOK;
  if (!url || !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(url)) return false;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Discord 回 ${response.status}`);
  return true;
}

export const POST = async (request) => {
  const wait = overLimit(request, "feedback", 3);
  if (wait) return tooMany(wait);
  return handleFeedback(request, toDiscord);
};
