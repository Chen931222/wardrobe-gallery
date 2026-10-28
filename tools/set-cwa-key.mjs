// [本 fork 新增] 中央氣象署授權碼一次放好(2026-10-27):本人執行、貼上一次,同時寫進專案根目錄 .env(本機測試用)
// 和 Vercel 正式環境的 CWA_API_KEY。授權碼不寫進程式、不進 git(.env 已在 .gitignore)。
// 用法:node tools/set-cwa-key.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENV = `${ROOT}.env`;
const GALLERY = `${ROOT}wardrobe-gallery`;   // Vercel 專案連在這個資料夾(.vercel/project.json)

// 從網頁複製的授權碼常夾著看不見的字元(零寬空白、貼上時終端機加的控制碼),
// 所以不比對整行,只在輸入裡找出 CWA-8-4-4-4-12 那一段(2026-10-27 本人貼上被判格式不對)
const KEY = /CWA-[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i;
const findKey = (text) => (String(text).replace(/[^A-Za-z0-9-]/g, "").match(KEY) || [])[0]?.toUpperCase();

const rl = createInterface({ input: process.stdin, output: process.stdout });
const typed = await rl.question("貼上氣象署授權碼後按 Enter(什麼都不貼直接按 Enter = 改讀剪貼簿):");
rl.close();
let key = findKey(typed);
if (!key && !typed.trim()) {
  const clip = spawnSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard"], { encoding: "utf8" });
  key = findKey(clip.stdout || "");
  if (key) console.log(`剪貼簿裡找到授權碼(${key.slice(0, 8)}…${key.slice(-4)})`);
  // 剪貼簿沒有,就用上次已經寫進 .env 的那組(.env 成功、Vercel 失敗之後重跑用)
  const saved = !key && existsSync(ENV) ? findKey((readFileSync(ENV, "utf8").match(/^\s*CWA_API_KEY\s*=(.*)$/m) || [])[1] || "") : "";
  if (saved) { key = saved; console.log(`用 .env 裡已經有的授權碼(${key.slice(0, 8)}…${key.slice(-4)})`); }
}
if (!key) {
  const odd = [...typed].filter((c) => !/[A-Za-z0-9-\s]/.test(c)).map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
  console.error(`找不到 CWA- 開頭、8-4-4-4-12 碼的授權碼(收到 ${[...typed].length} 個字元${odd.length ? `,其中有 ${[...new Set(odd)].join(" ")}` : ""})。沒有寫進任何地方。`);
  process.exit(1);
}

// ① .env:已經有 CWA_API_KEY 就換掉那一行,沒有就加在最後
const text = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
const line = `CWA_API_KEY=${key}`;
const next = /^\s*CWA_API_KEY\s*=.*$/m.test(text)
  ? text.replace(/^\s*CWA_API_KEY\s*=.*$/m, line)
  : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
writeFileSync(ENV, next);
console.log("✓ 已寫進 .env");

// ② Vercel 正式環境:已經有同名的就先刪掉再加,值從 stdin 給,不出現在指令列上
// 終端機的 PATH 不一定有 npm 全域資料夾(2026-10-27 本人那邊 'vercel' 找不到),先找 %APPDATA%\npm\vercel.cmd
const npmVercel = process.env.APPDATA ? `${process.env.APPDATA}\\npm\\vercel.cmd` : "";
const VERCEL = npmVercel && existsSync(npmVercel) ? `"${npmVercel}"` : "vercel";
const vercel = (args, input) => spawnSync(VERCEL, args, { cwd: GALLERY, input, encoding: "utf8", shell: true });
const list = vercel(["env", "ls", "production"]);
if (/\bCWA_API_KEY\b/.test(`${list.stdout}${list.stderr}`)) vercel(["env", "rm", "CWA_API_KEY", "production", "--yes"]);
const added = vercel(["env", "add", "CWA_API_KEY", "production"], key);
if (added.status !== 0) {
  console.error("Vercel 沒有加成功:\n" + `${added.stdout}${added.stderr}`.trim());
  process.exit(1);
}
console.log("✓ 已加進 Vercel 正式環境(CWA_API_KEY)");
console.log("好了,回去跟 Claude 說一聲。");
