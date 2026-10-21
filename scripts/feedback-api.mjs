// [本 fork 新增] 開發伺服器上的 /api/feedback,和線上共用 functions/_feedback-core.mjs;不送 Discord,印在終端機。
import { handleFeedback } from "../functions/_feedback-core.mjs";

export function feedbackApi() {
  return {
    name: "feedback-api",
    configureServer(server) {
      server.middlewares.use("/api/feedback", async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const request = new Request("http://localhost/api/feedback", {
          method: req.method,
          headers: { "content-type": req.headers["content-type"] || "application/json" },
          body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
        });
        const response = await handleFeedback(request, async (message) => { console.log(`\n[回報]\n${message}\n`); return true; });
        res.statusCode = response.status;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(await response.text());
      });
    },
  };
}
