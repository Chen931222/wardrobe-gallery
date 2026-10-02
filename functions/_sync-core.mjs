// [本 fork 新增] 衣櫃同步的伺服器端:同一組同步碼的裝置共用一份清單(manifest)和一堆去背圖。
//
// 存法不綁服務:store 由呼叫端給(線上是私有 Vercel Blob,開發時是本機資料夾),這裡只管規則。
//   sync/<key>/manifest.json   { rev, items: { id: { meta, img } }, keys: { 名稱: 字串 } }
//   sync/<key>/img/<sha256>.png 去背圖,用內容的雜湊命名,同一張圖只存一次
// key 是同步碼的 SHA-256,伺服器上不存同步碼本身。
//
// 合併在瀏覽器做(它才知道上次同步長怎樣);伺服器只做一件事:寫清單時帶上次讀到的 rev,
// 對不上就回 409,讓兩台同時按的時候後到的那台重新合併,不會默默蓋掉另一台。

import { createHash } from "node:crypto";

const CODE = /^[A-HJ-NP-Z2-9]{16}$/;          // 16 碼、沒有 0/O/1/I,80 bits
const HASH = /^[a-f0-9]{64}$/;
const MAX_IMAGE = 3 * 1024 * 1024;              // 去背圖實際 100–800 KB
const MAX_MANIFEST = 1024 * 1024;
const MAX_ITEMS = 500;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export function normalizeCode(text) {
  return String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * @param {Request} request
 * @param {{ read(path: string, opts?: { fresh?: boolean }): Promise<Uint8Array|null>,
 *           write(path: string, bytes: Uint8Array, contentType: string): Promise<void>,
 *           remove(paths: string[]): Promise<void> }} store
 */
export async function handleSync(request, store) {
  const code = normalizeCode(request.headers.get("x-sync-code"));
  if (!CODE.test(code)) return json({ error: "同步碼不對" }, 400);
  const root = `sync/${sha256(code).slice(0, 32)}`;
  const img = new URL(request.url).searchParams.get("img");

  if (img !== null) {
    if (!HASH.test(img)) return json({ error: "圖片編號不對" }, 400);
    const path = `${root}/img/${img}.png`;
    if (request.method === "GET") {
      const bytes = await store.read(path);
      if (!bytes) return json({ error: "沒有這張圖" }, 404);
      return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=31536000, immutable" } });
    }
    if (request.method === "PUT") {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_IMAGE) return json({ error: "圖太大" }, 413);
      if (sha256(bytes) !== img) return json({ error: "圖和編號對不上" }, 400);
      await store.write(path, bytes, "image/png");
      return json({ ok: true });
    }
    return json({ error: "不支援" }, 405);
  }

  const manifestPath = `${root}/manifest.json`;
  const readManifest = async () => {
    const bytes = await store.read(manifestPath, { fresh: true });
    return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : { rev: 0, items: {}, keys: {} };
  };

  if (request.method === "GET") return json(await readManifest());

  if (request.method === "PUT") {
    const text = await request.text();
    if (text.length > MAX_MANIFEST) return json({ error: "清單太大" }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "格式不對" }, 400); }
    const { baseRev, items, keys } = body || {};
    if (!Number.isInteger(baseRev) || typeof items !== "object" || typeof keys !== "object" || !items || !keys) {
      return json({ error: "格式不對" }, 400);
    }
    if (Object.keys(items).length > MAX_ITEMS) return json({ error: "衣服太多" }, 413);
    for (const entry of Object.values(items)) {
      if (!entry || typeof entry.meta !== "object" || (entry.img !== null && !HASH.test(entry.img))) return json({ error: "格式不對" }, 400);
    }
    for (const value of Object.values(keys)) if (typeof value !== "string") return json({ error: "格式不對" }, 400);

    const current = await readManifest();
    if (current.rev !== baseRev) return json({ error: "另一台剛同步過", current }, 409);

    const next = { rev: current.rev + 1, items, keys, updatedAt: new Date().toISOString() };
    await store.write(manifestPath, new TextEncoder().encode(JSON.stringify(next)), "application/json");

    // 不再被任何一件用到的圖刪掉(刪除不算額度)
    const used = new Set(Object.values(items).map((entry) => entry.img));
    const stale = [...new Set(Object.values(current.items).map((entry) => entry.img))].filter((hash) => hash && !used.has(hash));
    if (stale.length) await store.remove(stale.map((hash) => `${root}/img/${hash}.png`)).catch(() => {});
    return json({ rev: next.rev });
  }

  return json({ error: "不支援" }, 405);
}
