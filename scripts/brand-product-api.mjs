// [本 fork 新增] 開發伺服器上的 /api/brand-product,和線上 Vercel function 共用 functions/brand-product.mjs。
import { lookupBrandProduct } from "../functions/brand-product.mjs";

export function brandProductApi() {
  return {
    name: "brand-product-api",
    configureServer(server) {
      server.middlewares.use("/api/brand-product", async (req, res) => {
        const params = new URL(req.url, "http://localhost").searchParams;
        let result;
        try {
          result = await lookupBrandProduct({ brand: params.get("brand"), region: params.get("region"), code: params.get("code") });
        } catch (error) {
          result = { status: 502, body: { error: String(error?.message || error) } };
        }
        res.statusCode = result.status;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(result.body));
      });
    },
  };
}
