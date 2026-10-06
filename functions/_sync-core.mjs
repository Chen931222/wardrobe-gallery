// [本 fork 新增] 衣櫃同步的伺服器端:同一組同步碼的裝置共用一份清單(manifest)和一堆圖。
//
// 存法不綁服務:store 由呼叫端給(線上是私有 Vercel Blob,開發時是本機資料夾),這裡只管規則。
//   sync/registry.json          開通名單 { spaces: [key…] }
//   sync/<key>/manifest.json    { v: 2, rev, imgs: [圖編號…], data: 密文 }
//   sync/<key>/img/<編號>.bin    密文的圖
// key 是同步碼的 SHA-256 前 32 字;伺服器上不存同步碼本身。
//
// 端對端加密(2026-10-02 起):清單內容和圖都在瀏覽器用同步碼推出的金鑰加密,這裡只看得到密文、
// 圖的數量和大小。圖編號是瀏覽器算的 HMAC,伺服器無從驗證內容,只限大小。
//
// 誰能寫:只有開通名單裡的空間。新空間只能由兩種人開——網站上還沒有任何空間時的第一個人,
// 或手上已經有一組有效同步碼的人(換新碼)。陌生人自己編一組碼,讀寫都是 403。
//
// 合併在瀏覽器做;伺服器寫清單時比對 rev,對不上回 409,讓同時按的兩台後到的那台重新合併。

import { createHash } from "node:crypto";

const CODE = /^[A-HJ-NP-Z2-9]{16}$/;          // 16 碼、沒有 0/O/1/I,80 bits
const IMG_ID = /^[a-f0-9]{64}$/;
const MAX_IMAGE = 3 * 1024 * 1024;              // 去背圖實際 100–800 KB,加密只多 28 bytes
const MAX_MANIFEST = 2 * 1024 * 1024;
const MAX_IMAGES = 1000;
const REGISTRY = "sync/registry.json";

const spaceOf = (code) => createHash("sha256").update(code).digest("hex").slice(0, 32);
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const GONE = { error: "這組同步碼沒有開通,或已經換成新碼", reason: "unknown-space" };

export function normalizeCode(text) {
  return String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* 開通名單。讀取預設走 CDN 快取(命中不算額度);查不到才讀最新的一次,剛開通的空間不會被誤擋。 */
async function readRegistry(store, fresh) {
  const bytes = await store.read(REGISTRY, { fresh });
  if (bytes) return new Set(JSON.parse(new TextDecoder().decode(bytes)).spaces);
  // 第一次:把名單上線前就開好的空間登記進來,舊的同步不會斷
  const spaces = new Set();
  for (const path of await store.list("sync/")) {
    const match = /^sync\/([a-f0-9]{32})\/manifest\.json$/.exec(path);
    if (match) spaces.add(match[1]);
  }
  await writeRegistry(store, spaces);
  return spaces;
}
const writeRegistry = (store, spaces) => store.write(REGISTRY, new TextEncoder().encode(JSON.stringify({ spaces: [...spaces] })), "application/json");

async function isOpen(store, space, { fresh = false } = {}) {
  if (!fresh && (await readRegistry(store, false)).has(space)) return true;
  return (await readRegistry(store, true)).has(space);
}

/** 這組同步碼是不是開通名單裡的。給 /api/closet 用:站主完整的衣櫃只給已經開通同步的裝置。 */
export async function isOpenCode(store, rawCode) {
  const code = normalizeCode(rawCode);
  return CODE.test(code) && isOpen(store, spaceOf(code));
}

function imgsOf(manifest) {
  if (Array.isArray(manifest.imgs)) return manifest.imgs;
  return Object.values(manifest.items || {}).map((entry) => entry.img).filter(Boolean);   // 加密前的舊格式
}

/**
 * @param {Request} request
 * @param {{ read(path: string, opts?: { fresh?: boolean }): Promise<Uint8Array|null>,
 *           write(path: string, bytes: Uint8Array, contentType: string): Promise<void>,
 *           remove(paths: string[]): Promise<void>,
 *           list(prefix: string): Promise<string[]> }} store
 */
export async function handleSync(request, store) {
  const code = normalizeCode(request.headers.get("x-sync-code"));
  if (!CODE.test(code)) return json({ error: "同步碼不對" }, 400);
  const space = spaceOf(code);
  const root = `sync/${space}`;
  const manifestPath = `${root}/manifest.json`;
  const { method } = request;
  const img = new URL(request.url).searchParams.get("img");

  // 開一個新空間
  if (method === "POST" && img === null) {
    const spaces = await readRegistry(store, true);
    if (spaces.has(space)) return json({ ok: true });
    const parent = normalizeCode(request.headers.get("x-sync-parent"));
    const allowed = spaces.size === 0 || (CODE.test(parent) && spaces.has(spaceOf(parent)));
    if (!allowed) return json({ error: "這個衣櫃已經開通過同步了。到已經在同步的那台按「看同步碼」,用那組碼加入", reason: "taken" }, 403);
    spaces.add(space);
    await writeRegistry(store, spaces);
    return json({ ok: true });
  }

  // 以下都要已開通的空間;寫清單、整個刪除時一定讀最新名單
  const fresh = (method === "PUT" && img === null) || method === "DELETE";
  if (!(await isOpen(store, space, { fresh }))) return json(GONE, 403);

  if (method === "DELETE" && img === null) {
    await store.remove(await store.list(`${root}/`));
    const spaces = await readRegistry(store, true);
    spaces.delete(space);
    await writeRegistry(store, spaces);
    return json({ ok: true });
  }

  if (img !== null) {
    if (!IMG_ID.test(img)) return json({ error: "圖片編號不對" }, 400);
    const path = `${root}/img/${img}.bin`;
    if (method === "GET") {
      const bytes = await store.read(path);
      if (!bytes) return json({ error: "沒有這張圖" }, 404);
      return new Response(bytes, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, max-age=31536000, immutable" } });
    }
    if (method === "PUT") {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length < 29 || bytes.length > MAX_IMAGE) return json({ error: "圖太大" }, 413);
      await store.write(path, bytes, "application/octet-stream");
      return json({ ok: true });
    }
    return json({ error: "不支援" }, 405);
  }

  const readManifest = async () => {
    const bytes = await store.read(manifestPath, { fresh: true });
    return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : { v: 2, rev: 0, imgs: [], data: null };
  };

  if (method === "GET") return json(await readManifest());

  if (method === "PUT") {
    const text = await request.text();
    if (text.length > MAX_MANIFEST) return json({ error: "清單太大" }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "格式不對" }, 400); }
    const { baseRev, imgs, data } = body || {};
    if (!Number.isInteger(baseRev) || !Array.isArray(imgs) || typeof data !== "string") return json({ error: "格式不對" }, 400);
    if (imgs.length > MAX_IMAGES || !imgs.every((id) => IMG_ID.test(id))) return json({ error: "格式不對" }, 400);

    const current = await readManifest();
    if (current.rev !== baseRev) return json({ error: "另一台剛同步過", rev: current.rev }, 409);

    const next = { v: 2, rev: current.rev + 1, imgs, data, updatedAt: new Date().toISOString() };
    await store.write(manifestPath, new TextEncoder().encode(JSON.stringify(next)), "application/json");

    // 不再被用到的圖刪掉(刪除不算額度);加密前留下的明文圖 .png 也在這裡清掉
    const used = new Set(imgs);
    const stale = imgsOf(current).filter((id) => !used.has(id));
    const legacy = Array.isArray(current.imgs) ? [] : stale.map((id) => `${root}/img/${id}.png`);
    const paths = [...stale.map((id) => `${root}/img/${id}.bin`), ...legacy];
    if (paths.length) await store.remove(paths).catch(() => {});
    return json({ rev: next.rev });
  }

  return json({ error: "不支援" }, 405);
}
