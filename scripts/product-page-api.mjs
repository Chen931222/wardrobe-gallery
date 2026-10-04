// [本 fork 新增] 開發伺服器上的 /api/product-page 和 /api/product-image,跟線上共用 functions/_product-page-core.mjs。
// 簽圖片網址的 secret:開發時每次開伺服器亂數產生一份。
import { randomBytes } from "node:crypto";
import { fetchProductImage, readProductPage } from "../functions/_product-page-core.mjs";

const SECRET = randomBytes(32).toString("hex");

export function productPageApi() {
  return {
    name: "product-page-api",
    configureServer(server) {
      server.middlewares.use("/api/product-page", async (req, res) => {
        const url = new URL(req.url, "http://localhost").searchParams.get("url");
        let result;
        try {
          result = await readProductPage(url, SECRET);
        } catch (error) {
          result = { status: 200, body: { error: String(error?.message || error), images: [] } };
        }
        res.statusCode = result.status;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(result.body));
      });
      server.middlewares.use("/api/product-image", async (req, res) => {
        const params = new URL(req.url, "http://localhost").searchParams;
        let result;
        try {
          result = await fetchProductImage(params.get("u"), params.get("s"), SECRET);
        } catch {
          result = { status: 502, body: null };
        }
        res.statusCode = result.status;
        if (result.status === 200) res.setHeader("Content-Type", result.type);
        res.end(result.body ? Buffer.from(result.body) : undefined);
      });
    },
  };
}
