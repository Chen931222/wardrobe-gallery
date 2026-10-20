import path from "node:path";
import { createIPX, createIPXNodeHandler, ipxFSStorage } from "ipx";

const DEFAULT_MAX_AGE = 24 * 60 * 60;

export function responsiveImageApi(options = {}) {
  let handler;

  const attach = (server) => {
    server.middlewares.use("/_ipx", (req, res, next) => {
      if (!handler) return next();
      return handler(req, res);
    });
  };

  return {
    name: "wardrobe-responsive-images",
    apply: "serve",
    configResolved(config) {
      const publicDir = path.resolve(config.publicDir || path.join(config.root, "public"));
      const buildDir = path.resolve(config.root, config.build.outDir || "dist");
      const storage = ipxFSStorage({
        dir: [publicDir, buildDir],
        maxAge: options.maxAge || DEFAULT_MAX_AGE,
      });
      const ipx = createIPX({
        storage,
      });
      // ipx 4(2026-10-20 依賴更新):createIPXNodeServer 改名成 createIPXNodeHandler,用法一樣
      handler = createIPXNodeHandler(ipx);
    },
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
