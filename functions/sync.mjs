// [本 fork 新增] /api/sync 的 Vercel function 入口:規則在 _sync-core.mjs,這裡只接上私有 Vercel Blob。
// 線上由 tools/export-static.mjs 複製到 wardrobe-gallery/api/(底線開頭的 _sync-core 不會變成路由)。
// 認證走 Vercel 自動給的 OIDC,程式碼和設定檔裡都沒有金鑰。

import { del, get, put } from "@vercel/blob";
import { handleSync } from "./_sync-core.mjs";

const blobStore = {
  async read(path, { fresh = false } = {}) {
    try {
      const result = await get(path, { access: "private", useCache: !fresh });
      if (!result || result.statusCode !== 200) return null;
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    } catch (error) {
      if (error?.name === "BlobNotFoundError") return null;
      throw error;
    }
  },
  async write(path, bytes, contentType) {
    await put(path, Buffer.from(bytes), {
      access: "private", contentType, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60,
    });
  },
  async remove(paths) {
    await del(paths);
  },
};

const run = async (request) => {
  try {
    return await handleSync(request, blobStore);
  } catch (error) {
    return Response.json({ error: `同步服務出錯:${error?.message || error}` }, { status: 502 });
  }
};

export const GET = run;
export const PUT = run;
