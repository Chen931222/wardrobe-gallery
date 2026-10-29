// [本 fork 新增] 開發伺服器上的 /api/keep,直接跑線上那支 functions/keep.mjs(它只回 Set-Cookie,沒有別的依賴)。
import { POST } from "../functions/keep.mjs";

export function keepApi() {
  return {
    name: "keep-api",
    configureServer(server) {
      server.middlewares.use("/api/keep", async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const headers = Object.fromEntries(["origin", "host", "sec-fetch-site"].filter((key) => req.headers[key]).map((key) => [key, req.headers[key]]));
        const response = await POST(new Request(`http://localhost${req.originalUrl || req.url}`, { method: "POST", headers, body: Buffer.concat(chunks) }));
        res.statusCode = response.status;
        for (const [key, value] of response.headers) res.setHeader(key, value);
        res.end();
      });
    },
  };
}
