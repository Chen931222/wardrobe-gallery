// [本 fork 新增] /api/closet 的 Vercel function 入口:規則在 _closet-core.mjs,這裡接上私有 Vercel Blob(只讀開通名單)
// 和站主的衣櫃清單。_owner-closet.mjs 由 tools/export-static.mjs 匯出時產生在 wardrobe-gallery/api/,
// 不在 functions/ 也不進 git(repo 是公開的);底線開頭的檔案 Vercel 不會變成路由,網址打不開。
// 開發時由 scripts/wardrobe-data-api.mjs 掛在同一個路徑(本機不檢查同步碼)。

import { get, list, put } from "@vercel/blob";
import { handleCloset } from "./_closet-core.mjs";
import { CLOSET } from "./_owner-closet.mjs";

// 跟 sync.mjs 的 blobStore 同一套讀法(這裡用到的只有讀開通名單;名單不存在時 _sync-core 會列出空間重建)
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
  async list(prefix) {
    const paths = [];
    let cursor;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      paths.push(...page.blobs.map((blob) => blob.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return paths;
  },
};

export async function GET(request) {
  try {
    return await handleCloset(request, blobStore, CLOSET);
  } catch (error) {
    return Response.json({ error: `衣櫃服務出錯:${error?.message || error}` }, { status: 502 });
  }
}
