# wardrobe-gallery — 我的衣櫃

把每一件衣服當成展品拍照陳列：逐件去背、建檔、分類，
再加上一個會自己配衣服的紙娃娃工作檯。

線上版：https://wardrobe-gallery.vercel.app （唯讀靜態版）

## 這個版本做了什麼

在上游的衣物畫廊之上，加了三層自己的東西：

- **紙娃娃工作檯**（`src/OutfitStudio.jsx`）——衣物依槽位疊在人形上，
  可以直接看見一套穿搭長什麼樣，而不是只看縮圖列表。
- **配衣規則引擎**（`src/recommend.js`）——純函式評分：體感溫度對應保暖度、
  場合過濾、配色評分、最近穿過的降權。鞋子的重複穿扣分另外調過，
  否則雨天會反推怕雨的鞋。
- **去背工具鏈**（`tools/`）——裁切、去背、修邊、alpha 實心化、
  接觸表目視檢查、靜態匯出。實務上成敗取決於照片本身：
  深色衣物配深色背景要二次去背；衣服超出畫面邊緣會產生半透明鬼影，
  解法是不裁切、用全幅原圖讓模型看得到背景。

## 跑起來

```bash
npm install
npm run dev
```

本地優先架構，編輯與匯入都在本機跑。線上那份是 `tools/export-static.mjs`
匯出的唯讀靜態版（前端只 GET 衣櫃 JSON 與圖片，照路徑擺成靜態檔）。

原始照片（`photos/`）、處理後的衣櫃資料（`data/`）與匯出結果
（`wardrobe-gallery/`）都不進版本庫。

## 出處：哪些是本 fork 寫的

Fork 自 [tandpfun/wardrobe](https://github.com/tandpfun/wardrobe)，MIT 授權。
分界點是上游最後一個 commit `f44006c`，之後的都是本 fork 的東西。

**每個檔案第一行都有出處標記**，不必翻 git log，直接 grep：

```bash
git grep -l "\[本 fork 新增\]"    # 46 個：整份自己寫的
git grep -l "\[本 fork 修改\]"    # 8 個：上游檔案，改動寫在該行
```

（用 `git grep` 而不是 `grep -r`：只掃版本控管的檔案，不會把 `dist/` 的 build 產物也算進去。）

### 本 fork 新增（46 個）

| 位置 | 內容 |
|---|---|
| `src/OutfitStudio.jsx` | 紙娃娃工作檯：衣物依槽位疊在人形上，可自由拖移縮放旋轉 |
| `src/recommend.js` | 配衣規則引擎：體感溫度、場合、配色、最近穿過降權 |
| `src/LandingRing.jsx` | 入口圓環與今日推薦面板 |
| `src/AddGarment.jsx`、`src/localWardrobe.js` | 網頁端新增衣物、IndexedDB 本機儲存 |
| `tools/`（41 支） | 去背流水線、破洞修補、方向校正、目視檢查表、靜態匯出 |

### 本 fork 修改的上游檔案（11 個）

`index.html`、`src/App.jsx`、`src/styles.css`、`src/import-flow.jsx`、
`src/import-flow.css`、`scripts/import-job-api.mjs`、`.gitignore`、
`.agents/skills/import-clothes/scripts/import-to-wardrobe.mjs`
——以上 8 個的改動內容寫在各自第一行。

`package.json`、`package-lock.json`（JSON 放不了註解）與本檔另計。

改動集中在三件事：介面繁中化、深色襯線主題、擴充部位分類（襪子／包／眼鏡／腕飾）。

### 上游原封不動（17 個，請勿當成本 fork 的作品）

`LICENSE`、`CONTRIBUTING.md`、`.env.example`、`.npmrc`、`vite.config.mjs`、
`.github/workflows/ci.yml`、`src/main.jsx`、`src/OptimizedImage.jsx`、
`scripts/responsive-image-api.mjs`、`public/`（含 PWA 的 `manifest.webmanifest`
與 `sw.js`）、`.agents/skills/` 底下上游那套 OpenAI 匯入與生圖 skill。

上游的匯入流程需要 `OPENAI_API_KEY` 與 `data/model-reference.png`
（見 [`.env.example`](.env.example)）。本 fork 實際走的是 Claude 流程，沒用到那把金鑰。

另外刪除了上游的 `docs/screenshots/`（兩張截圖，畫面已完全不同）。

授權同為 MIT，見 [LICENSE](LICENSE)。
