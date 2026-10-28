// [本 fork 新增] 產生 /licenses.html(授權與原始碼)。
//
// 為什麼要有(2026-10-26 授權盤點,work/授權盤點-2026-10-26.md):送到瀏覽器的程式裡有十幾個 MIT 套件、兩套 OFL 字型,
// MIT 和 OFL 都要求散布時附上版權聲明;打包後的 JS 只留下其中幾個的 @license 註解,網站上也沒有任何一頁列出來。
// 天氣資料 Open-Meteo 是 CC BY 4.0,要寫出處。
// 2026-10-27 去背從 @imgly(AGPL-3.0)換成 MediaPipe(Apache-2.0):清單裡不再有 AGPL,AGPL-3.0.txt 不產生了。
//
// 內容一律從 node_modules 裡實際裝的版本讀(版本、授權、LICENSE 全文),不手抄。
// 用法:node tools/build-licenses.mjs → 寫進 public/(跟著 vite build 進 dist);tools/export-static.mjs 匯出時也會再寫一次,
// 所以升級套件後上線的那份一定是當下裝的版本。清單只在這裡:改了前端用到的套件(看 dist/assets 打包進去的),要回來改 BUNDLED。

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = "https://github.com/Chen931222/wardrobe-gallery";

// 送到瀏覽器的套件(2026-10-26 用 vite 重建後列出來的 11 個,加上 ndarray 帶進來的兩個小套件)與字型。
//   at:同名套件有好幾份時,打包用的是哪一份(找不到就用最上層那份,npm 合併了也不會讓匯出停住)
//   licenseFrom:npm 版沒附 LICENSE,借同一個 repo 另一個套件的
//   licenseText:npm 版沒附、repo 根目錄有的,抄一份放 tools/licenses/(來源和日期寫在檔頭)
const BUNDLED = [
  { name: "react", use: "畫面" },
  { name: "react-dom", use: "畫面" },
  { name: "scheduler", use: "畫面(React 內部)" },
  { name: "@phosphor-icons/react", use: "圖示" },
  { name: "@unpic/react", use: "圖片縮放" },
  { name: "@unpic/core", use: "圖片縮放", licenseFrom: "@unpic/react" },   // 跟 @unpic/react 同一個 repo(unpic-img)
  { name: "unpic", use: "圖片縮放" },   // npm 版和 repo(ascorbic/unpic)都沒有授權全文,只有 package.json 寫 MIT(2026-10-26 查)
  { name: "@mediapipe/tasks-vision", use: "去背(MagicTouch 模型的執行程式)", licenseText: "tools/licenses/mediapipe-LICENSE.txt" },
  { name: "@fontsource/cormorant", use: "字型(英文、數字)", label: "Cormorant(字型)" },
  { name: "@fontsource/noto-serif-tc", use: "字型(中文)", label: "Noto Serif TC(字型)" },
];

const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const licenseFile = (dir) => ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "LICENSE-MIT"].find((candidate) => existsSync(join(dir, candidate)));

async function readPackage({ name, at, licenseFrom, licenseText }) {
  const dir = at && existsSync(join(ROOT, at, "package.json")) ? join(ROOT, at) : join(ROOT, "node_modules", name);
  const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  const textDir = licenseFrom ? join(ROOT, "node_modules", licenseFrom) : dir;
  const file = licenseFile(textDir);
  const repo = String(pkg.repository?.url || pkg.repository || "").replace(/^git\+/, "").replace(/^git:/, "https:").replace(/\.git$/, "");
  // npm 版沒附 LICENSE、也沒有可借的:照實寫,不自己編版權那行
  if (!file && !licenseText && !/^MIT$/i.test(pkg.license || "")) throw new Error(`${name} 找不到 LICENSE 檔,授權也不是 MIT:要人工確認`);
  const text = file
    ? (await readFile(join(textDir, file), "utf8")).replace(/\r\n/g, "\n").trim()
    : licenseText
      ? (await readFile(join(ROOT, licenseText), "utf8")).replace(/\r\n/g, "\n").replace(/^#.*\n/gm, "").trim()
      : `${pkg.license}(這個套件的 npm 版和 repo 都沒有附授權全文,只在 package.json 寫 ${pkg.license};見 ${repo || "它的 repo"})`;
  let license = typeof pkg.license === "string" ? pkg.license : pkg.license?.type || "";
  if (/SEE LICENSE/i.test(license)) license = /GNU AFFERO GENERAL PUBLIC LICENSE/i.test(text) ? "AGPL-3.0" : license;
  if (!license && /SIL OPEN FONT LICENSE/i.test(text)) license = "OFL-1.1";
  return { version: pkg.version, license, text };
}

export async function buildLicenses() {
  const rows = [];
  for (const entry of BUNDLED) rows.push({ ...entry, ...(await readPackage(entry)) });
  const upstream = (await readFile(join(ROOT, "LICENSE"), "utf8")).replace(/\r\n/g, "\n").trim();
  // 原始碼那段寫「不含 AGPL」;哪天又裝了 GPL 類的套件,這頁要跟著改,先停下來
  const copyleft = rows.find((row) => /GPL/i.test(row.license));
  if (copyleft) throw new Error(`${copyleft.name} 是 ${copyleft.license}:原始碼那段要跟著改`);

  // 授權全文:同一份文字(只差版權那行的 MIT)各列一次
  const texts = rows.map((row) => ({ title: `${row.label || row.name} ${row.version}`, text: row.text }));
  texts.unshift({ title: "Open Wardrobe(上游專案)", text: upstream });

  const table = rows.map((row) => `            <tr><td>${esc(row.label || row.name)} <span class="ver">${esc(row.version)}</span></td><td>${esc(row.use)}</td><td>${esc(row.license)}</td></tr>`).join("\n");

  const html = `<!doctype html>
<!-- 由 tools/build-licenses.mjs 產生,不要手改:改那支腳本,重跑一次 -->
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <title>授權與原始碼 · PairThis</title>
    <link rel="icon" href="/icon-64.png" type="image/png" sizes="64x64" />
    <link rel="stylesheet" href="/privacy.css" />
  </head>
  <body>
    <main>
      <header class="top">
        <a class="brand" href="/" aria-label="PairThis 搭這件,回首頁"><span class="logo" aria-hidden="true"></span></a>
        <a class="back" href="/">← 回衣櫃</a>
      </header>

      <h1>授權與原始碼</h1>
      <p class="updated">清單照網站目前裝的版本產生</p>

      <p class="lede">這個網站用了別人寫的程式、字型和資料。下面列出每一樣用在哪、是什麼授權，授權要求附上的聲明也都在這頁。</p>

      <section id="source" aria-labelledby="source-title">
        <h2 id="source-title">原始碼</h2>
        <p>原始碼在 <a href="${SOURCE}" rel="noopener">GitHub</a>。上游 Open Wardrobe 和本站自己寫的部分是 MIT；用到的別人的程式和字型列在下面，各照各的授權。</p>
        <p>2026 年 10 月 27 日以前的版本，去背用的是 <span class="nowrap">@imgly/background-removal</span>（<a class="nowrap" href="https://www.gnu.org/licenses/agpl-3.0.html" rel="noopener">AGPL-3.0</a>），那些版本整體依 AGPL-3.0 提供，原始碼在 GitHub 的歷史紀錄裡。之後換成 Google 的 MediaPipe，網站不再含 AGPL 的程式。</p>
      </section>

      <section id="parts" aria-labelledby="parts-title">
        <h2 id="parts-title">用到的程式和字型</h2>
        <table class="events">
          <thead>
            <tr><th scope="col">名稱</th><th scope="col">用在哪</th><th scope="col">授權</th></tr>
          </thead>
          <tbody>
${table}
          </tbody>
        </table>
        <p>字型檔放在這個網站上，沒有連到 Google Fonts。</p>
      </section>

      <section id="data" aria-labelledby="data-title">
        <h2 id="data-title">資料</h2>
        <ul>
          <li><b>天氣</b>：資料來源<a href="https://www.cwa.gov.tw/" rel="noopener">交通部中央氣象署</a>（開放資料「臺灣未來 3 天天氣預報」），依<a href="https://data.gov.tw/license" rel="noopener">政府資料開放授權條款－第 1 版</a>使用。今日推薦用到的氣溫、體感、降雨機率都是它的資料。伺服器連不上氣象署設定時改用 <a href="https://open-meteo.com/" rel="noopener">Open-Meteo</a>（<a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener">CC BY 4.0</a>），天氣那一行會寫實際用的是哪一家。</li>
          <li><b>入口第二章的截圖</b>：圖裡的天氣（基隆，2026 年 10 月 26 日）是 Open-Meteo 的資料（CC BY 4.0）。</li>
          <li><b>去背模型</b>：Google MediaPipe 的 MagicTouch（Interactive Segmenter v2），<a href="https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MagicTouch.pdf" rel="noopener">model card</a> 寫 Apache License 2.0。第一次去背時從這個網站下載，不連到別人的服務。</li>
          <li><b>示範衣櫃</b>：20 件都是站主自己的衣服、自己拍的照片。</li>
        </ul>
      </section>

      <section id="texts" aria-labelledby="texts-title">
        <h2 id="texts-title">授權全文</h2>
        <p>照原文列在下面，點開看。</p>
${texts.map(({ title, text }) => `        <details class="license-text">
          <summary>${esc(title)}</summary>
          <pre>${esc(text)}</pre>
        </details>`).join("\n")}
      </section>

      <footer class="foot">
        <p><a href="/privacy.html">隱私與使用說明</a> · <a href="/">回衣櫃</a></p>
      </footer>
    </main>
  </body>
</html>
`;
  return { html, rows };
}

/** 寫到 dir(public/ 或匯出的 wardrobe-gallery/) */
export async function writeLicenses(dir) {
  const { html, rows } = await buildLicenses();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "licenses.html"), html);
  return rows;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rows = await writeLicenses(join(ROOT, "public"));
  console.log(`public/licenses.html:${rows.length} 個套件(${[...new Set(rows.map((row) => row.license))].join("、")})`);
}
