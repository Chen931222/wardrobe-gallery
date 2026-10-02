// [本 fork 新增] 開發伺服器上的 /api/sync,和線上共用 functions/_sync-core.mjs;資料放本機 .sync-dev/,不碰雲端。
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { handleSync } from "../functions/_sync-core.mjs";

const ROOT = join(process.cwd(), ".sync-dev");

const fileStore = {
  async read(path) {
    try { return new Uint8Array(await readFile(join(ROOT, path))); } catch { return null; }
  },
  async write(path, bytes) {
    await mkdir(dirname(join(ROOT, path)), { recursive: true });
    await writeFile(join(ROOT, path), bytes);
  },
  async remove(paths) {
    await Promise.all(paths.map((path) => rm(join(ROOT, path), { force: true })));
  },
  async list(prefix) {
    try {
      const entries = await readdir(ROOT, { recursive: true, withFileTypes: true });
      return entries.filter((entry) => entry.isFile())
        .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)).split("\\").join("/"))
        .filter((path) => path.startsWith(prefix));
    } catch {
      return [];
    }
  },
};

export function syncApi() {
  return {
    name: "sync-api",
    configureServer(server) {
      server.middlewares.use("/api/sync", async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const request = new Request(new URL(req.originalUrl || req.url, "http://localhost"), {
          method: req.method,
          headers: req.headers,
          body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
        });
        const response = await handleSync(request, fileStore);
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      });
    },
  };
}
