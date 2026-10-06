// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
//
// scripts/wardrobe-data-api.mjs — 開發伺服器用的本機衣櫃資料端點。
//
// 為什麼需要:衣櫃資料放在版本庫外的 data/(library.json + imported/ 圖片),
// 瀏覽器不能直接讀檔,所以開發時要有人把它們用 HTTP 端出來。
// 線上是靜態部署,同樣的路徑由 tools/export-static.mjs 事先寫成實體檔案,
// 因此前端不必分辨自己在開發還是正式環境 —— 兩邊的網址完全一樣。
//
// 讀取走 /data/(wardrobe.json 與 library/*):Vercel 把 api/ 保留給 functions,
// 靜態檔放 /api/ 可能不出(未實測),所以線上要讀的東西都放 /data/。
// 刪除只有本機有,留在 /api/import/wardrobe/:id。
//
// 2026-10-05 起跟線上一樣分兩份:/data/wardrobe.json 只有示範的 20 件,站主完整的衣櫃走 /api/closet
// (線上要帶開通過的同步碼;本機不檢查,開發機就是站主自己)。
//
// 這支只做「讀本機資料 + 刪一件」,沒有任何上傳或外部服務。
import { readFile, writeFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { demoCloset } from "../src/demoCloset.js";

const LIBRARY = path.resolve("data/library.json");
const ASSET_DIR = path.resolve("data/imported");

const MIME = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

const readLibrary = async () => {
  try {
    return JSON.parse(await readFile(LIBRARY, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];   // 還沒匯入任何衣物是正常狀態,不是錯誤
    throw error;
  }
};

export function wardrobeDataApi() {
  return {
    name: "wardrobe-data-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, "http://localhost");
        const isRead = url.pathname === "/data/wardrobe.json" || url.pathname === "/api/closet" || url.pathname.startsWith("/data/library/");
        if (!isRead && !url.pathname.startsWith("/api/import/")) return next();

        try {
          if (url.pathname === "/data/wardrobe.json" && req.method === "GET") {
            return sendJson(res, 200, demoCloset(await readLibrary()));
          }
          if (url.pathname === "/api/closet" && req.method === "GET") {
            return sendJson(res, 200, await readLibrary());
          }

          const remove = url.pathname.match(/^\/api\/import\/wardrobe\/([\w-]+)$/);
          if (remove && req.method === "DELETE") {
            const id = remove[1];
            const items = await readLibrary();
            const kept = items.filter((item) => item.id !== id);
            if (kept.length === items.length) return sendJson(res, 404, { error: "找不到這件衣物" });
            await writeFile(LIBRARY, JSON.stringify(kept, null, 2));
            // 連同縮圖與大圖一起刪,免得 data/imported/ 越積越多孤兒檔
            await Promise.all(
              ["-garment.png", "-thumb.webp", "-view.webp"].map((suffix) =>
                rm(path.join(ASSET_DIR, `${id}${suffix}`), { force: true })
              )
            );
            return sendJson(res, 200, { deleted: true, id });
          }

          const asset = url.pathname.match(/^\/data\/library\/([\w.-]+)$/);
          if (asset && req.method === "GET") {
            // basename 是必要的:阻擋 ../ 之類的路徑穿越
            const file = path.join(ASSET_DIR, path.basename(asset[1]));
            await stat(file);
            res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            return res.end(await readFile(file));
          }

          return sendJson(res, 404, { error: "沒有這個端點" });
        } catch (error) {
          if (error.code === "ENOENT") return sendJson(res, 404, { error: "找不到檔案" });
          return sendJson(res, 500, { error: String(error?.message || error) });
        }
      });
    },
  };
}
