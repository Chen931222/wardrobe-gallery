// [本 fork 新增] 準備去背要用的檔案(2026-10-27):MagicTouch v2 模型、MediaPipe 的運算程式,放到 public/cutout/。
// 這兩樣都很大(30.5MB、13MB)又不是自己寫的,不進 git(.gitignore 擋 public/cutout/):
//   模型從 Google 的固定版本網址下載一次,大小對不上就停;運算程式從 node_modules 裡裝的那份複製。
// npm run dev / build 之前自動跑(package.json 的 predev、prebuild);已經準備好就什麼都不做。
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_BYTES, MODEL_FILE, MODEL_SHA256, MODEL_SOURCE, TASKS_VISION_VERSION, WASM_DIR } from "../src/cutoutAssets.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC = join(ROOT, "public");
// 一般版(頁面上)、nosimd(舊瀏覽器)、module 版(Worker 裡,importScripts 不能用)
const WASM_FILES = ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm", "vision_wasm_module_internal.js", "vision_wasm_module_internal.wasm"];

const installed = JSON.parse(await readFile(join(ROOT, "node_modules", "@mediapipe", "tasks-vision", "package.json"), "utf8")).version;
if (installed !== TASKS_VISION_VERSION) throw new Error(`裝的 @mediapipe/tasks-vision 是 ${installed},src/cutoutAssets.js 寫 ${TASKS_VISION_VERSION}:兩邊要一樣`);

const sizeOf = async (path) => (existsSync(path) ? (await stat(path)).size : -1);

// 運算程式
const wasmOut = join(PUBLIC, ...WASM_DIR.split("/").filter(Boolean));
await mkdir(wasmOut, { recursive: true });
for (const file of WASM_FILES) {
  const from = join(ROOT, "node_modules", "@mediapipe", "tasks-vision", "wasm", file);
  const to = join(wasmOut, file);
  if ((await sizeOf(to)) !== (await sizeOf(from))) await copyFile(from, to);
}

// 模型
const modelOut = join(PUBLIC, "cutout", MODEL_FILE);
if ((await sizeOf(modelOut)) !== MODEL_BYTES) {
  console.log(`下載去背模型 ${MODEL_SOURCE}`);
  const response = await fetch(MODEL_SOURCE);
  if (!response.ok) throw new Error(`去背模型下載失敗:HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // 大小或雜湊對不上:Google 那邊換了檔案,先別用,人工確認後再改 src/cutoutAssets.js
  if (bytes.length !== MODEL_BYTES || sha256 !== MODEL_SHA256) throw new Error(`去背模型對不上:${bytes.length} bytes、sha256 ${sha256};應該是 ${MODEL_BYTES}、${MODEL_SHA256}`);
  const partial = `${modelOut}.part`;
  await writeFile(partial, bytes);
  await rename(partial, modelOut);
  console.log(`去背模型 ${bytes.length} bytes,sha256 對得上`);
}
console.log(`public${WASM_DIR}/ 與 public/cutout/${MODEL_FILE} 準備好了`);
