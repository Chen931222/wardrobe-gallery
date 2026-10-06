# wardrobe-gallery — 我的衣櫃

把每一件衣服拍照、去背、建檔，再加上一個照天氣配衣服的紙娃娃工作檯。
朋友也能放自己的衣服進來配，衣服只存在他自己的瀏覽器。

線上版：https://wardrobe-gallery.vercel.app

- 第一次打開是歡迎畫面和一套示範穿搭。按「新增第一件」放自己的衣服；按「先看看示範」看示範衣櫃。
- 示範衣櫃是站主衣櫃裡挑出來的 20 件。站主完整的衣櫃不公開，要用站主的同步碼才拿得到。

## 這個版本做了什麼

在上游的衣物畫廊之上，自己加的東西：

**配衣服**
- **紙娃娃工作檯**（`src/OutfitStudio.jsx`）：衣服依部位疊在人形上，可以拖移、縮放、旋轉。
  底下的輸入框聽得懂一句話：「約會」「全黑」「褲子不好看」「換成黑色襯衫」「上衣留著其他重挑」。
- **配衣規則引擎**（`src/recommend.js`）：純函式評分，不呼叫任何 AI 服務。看的是：
  - 體感溫度對應保暖度，冷天不配短褲。
  - 降雨機率：怕雨的鞋、包、外套先收起來；收了哪些鞋和包會寫在理由裡。
  - 場合（約會、面試、看球賽）、色系（全黑、大地色、藍色系）、配色、風格衝突（拖鞋不配襯衫）。
  - 最近穿過的往後排。
  - 手錶、眼鏡、其他配件。
- **從自己的選擇學**（`src/taste.js`）：說過「不好看」的組合之後少推；三成的推薦會挑穿過或收藏過的組合。
  不是每次都加分，因為量過：組合有幾百種、分數都很接近，每次都加 1.5 分，那一組就會被推 94%，等於天天推同一套。
- **天氣**：Open-Meteo，20 個縣市可選，不跟瀏覽器要定位權限。

**放衣服進來**
- **新增**（`src/AddGarment.jsx`）：
  - 拍照或截圖，框出衣服，在瀏覽器裡去背。照片不上傳；第一次要下載約 80MB 的去背模型。
  - 去背的同時就能先填名稱和分類。
  - 單品頁可以換一張圖。
- **貼商品連結**（`src/brandLink.js`、`functions/`）：
  - GU、UNIQLO 抓得到品名、分類、價錢和商品圖。
  - 其他品牌讀公開的商品頁。蝦皮、Zara 這類擋機器人的，改用截圖。
- **想買的**（`src/wishCheck.js`）：還沒買的另外放，看櫃裡有沒有很像的，以及能跟現有的配出幾套。
- **衣櫃目錄**：分類照衣服、鞋襪、配件、隨身四組排成目錄，每類標件數，沒有衣服的分類不列。
  分類有上衣、外套、下身、鞋子、襪子、包、眼鏡、手錶、皮帶、項鍊、戒指、其他配件、隨身小物（`src/parts.js`）。
  鋼筆這類隨身小物不會被自動配進推薦。
- **最愛**（`src/favorites.js`）：單品頁點星星加入，目錄裡可以只看最愛。不影響推薦。

**資料放在哪**
- 朋友加的衣服：只在他自己的瀏覽器（IndexedDB），網站伺服器收不到。
  - 備份是一個 ZIP（`src/backup.js`），裡面有每件的去背圖和紀錄，換手機時匯出再匯入。
  - 加了新衣服還沒備份，會提醒（`src/keepSafe.js`）。
  - 從 LINE、Instagram 開的會先警告：在 app 內建瀏覽器加的衣服，用 Safari 打開會看不到。
- 站主自己的裝置之間：同步碼（`src/sync.js`）。
  - 衣服和紀錄在瀏覽器裡先用同步碼推出的金鑰加密（AES-GCM），才上傳到私有的 Vercel Blob。伺服器只看得到密文。
  - 網站上第一個同步空間開了之後，新的空間只能由手上有有效同步碼的人開。
- 刪除先進垃圾桶，可以復原：
  - 自己加的放 30 天後自動刪掉。
  - 站主衣櫃的只是隱藏。

**去背工具鏈**（`tools/`）：站主那批衣服是離線處理的，流程是裁切、去背、修邊、alpha 實心化、接觸表目視檢查、靜態匯出。
成敗主要看照片本身：
- 深色衣服配深色背景要二次去背。
- 衣服超出畫面邊緣會留下半透明的鬼影；解法是不裁切，用全幅原圖讓模型看得到背景。

## 量過什麼、還沒量什麼

- **指令理解：**
  - 自己出的 73 句題庫 73/73。
  - 沒拿來調過的新句子 45/45，改完句型後再出的 20/20。
- **示範衣櫃：** 模擬 14 種天氣（12–33°、晴或雨）各推薦 40 次，「怪搭配」0/560 次。
  - 怪搭配指：拖鞋配長褲或襯衫、為了保暖穿外套卻配短褲、涼天穿短褲。
  - 舊的示範衣櫃是亂數抽的 20 件，配舊的規則是 553/560 次。
- **「約會穿全黑」：** 300 件單品全是黑色。原本是 213 件黑、87 件深藍：有幾件深藍外套的顏色又暗又灰，被當成黑色。
- **還沒量的：推薦到底準不準。**
  - 搭配頁底會記「今天穿這套」是照推薦穿的，還是自己換過，以及看到第幾套才決定。
  - 從 2026-10-06 開始記，還沒有足夠的天數可以下結論。
- **測在哪裡：**
  - 自動測試跑在 Chromium，有模擬 iPhone。
  - 真 iPhone 由作者手動試過：新增、去背、同步、從 LINE 跳到 Safari、匯出備份。

## 限制

- 去背模型約 80MB。手機訊號弱時第一次下載可能失敗，會提示改連 Wi-Fi。
- 朋友的衣服沒有雲端備份。iPhone 的 Safari 約一週沒開這個網站，可能清掉資料（加到主畫面的不會）。
  靠的是備份提醒和 ZIP；同步目前只開放給站主。
- 去背套件 `@imgly/background-removal` 是 **AGPL-3.0**。這個 repo 公開，所以目前沒有問題；
  要做成不公開原始碼的收費服務，得換掉去背方案或另外取得授權。

## 跑起來

```bash
npm install
npm run dev
```

本地優先：開發伺服器（`scripts/`）在本機把衣櫃資料和各個 API 端點掛在跟線上同一組網址。

上線：

```bash
npm run build && node tools/export-static.mjs
cd wardrobe-gallery && vercel deploy --prod --yes
```

- `tools/export-static.mjs` 匯出靜態檔和 Vercel functions。
  - 公開的 `/data/wardrobe.json` 只有示範的 20 件。
  - 站主完整的衣櫃寫進 function（`api/_owner-closet.mjs`），不在 repo、不在公開網址。
  - 不在示範裡的衣服，圖換成猜不到的檔名。
- 同步要先在 Vercel 專案接一個私有的 Blob 空間。金鑰由 Vercel 注入，程式碼裡沒有。
- `vercel.json` 關掉了 Git 自動部署。repo 裡沒有 `data/`，push 觸發的建置會產出一個沒有衣櫃資料的站，並蓋掉線上版（2026-09-22、09-29 各發生一次）。
- 原始照片（`photos/`）、處理後的衣櫃資料（`data/`）、匯出結果（`wardrobe-gallery/`）都不進版本庫。

## 出處：哪些是自己寫的

Fork 自 [tandpfun/wardrobe](https://github.com/tandpfun/wardrobe)，MIT 授權。
分界點是上游最後一個 commit `f44006c`，之後的都是這個版本自己的東西。

上游在分界點共 30 個檔案：原封不動 8 個、就地改過 10 個、搬家後改過 1 個、移除 11 個。

**能寫註解的檔案，第一行都標明出處**，不必翻 git log，直接查：

```bash
git grep -l "\[本 fork 新增\]"    # 78 個：整份自己寫的
git grep -l "\[本 fork 修改\]"    # 7 個：上游檔案，改動寫在該行
```

（用 `git grep` 而不是 `grep -r`：只掃版本控管的檔案，不會把 `dist/` 的 build 產物也算進去。）

### 自己寫的（78 個）

| 位置 | 內容 |
|---|---|
| `src/OutfitStudio.jsx` | 紙娃娃工作檯、用一句話改穿搭 |
| `src/recommend.js` | 配衣規則引擎、句子理解 |
| `src/taste.js` | 從自己的選擇學、記推薦準不準 |
| `src/LandingRing.jsx` | 入口圓環與今日推薦 |
| `src/Welcome.jsx`、`src/demoCloset.js` | 第一次打開的歡迎畫面、示範衣櫃的 20 件 |
| `src/city.js`、`src/CitySelect.jsx` | 天氣看哪個城市 |
| `src/AddGarment.jsx`、`src/localWardrobe.js` | 新增、換圖、瀏覽器內去背、IndexedDB |
| `src/brandLink.js`、`src/price.js` | 貼商品連結：品名、分類、價錢、商品圖 |
| `src/wishCheck.js` | 想買的：櫃裡很像的、能配出幾套 |
| `src/sync.js`、`src/SyncPanel.jsx` | 同步碼、端對端加密、三方合併 |
| `src/backup.js`、`src/zip.js`、`src/keepSafe.js` | 備份 ZIP、備份提醒、app 內建瀏覽器警告 |
| `src/lookCard.js`、`src/LookCard.jsx` | Look 卡：在瀏覽器裡把一套穿搭合成一張圖，不上傳 |
| `src/ownerMode.js` | 站主與訪客看到的不一樣 |
| `src/parts.js`、`src/favorites.js` | 唯一一份分類清單、最愛 |
| `src/useDialog.js`、`src/ScrollRail.jsx` | 對話框的焦點、iPhone 上看得到的捲軸 |
| `functions/`（8 支） | Vercel functions：GU／UNIQLO 品名、其他品牌商品頁與簽名過的商品圖、同步、站主衣櫃 |
| `scripts/`（4 支） | 開發伺服器上的同一組端點（同步存在本機 `.sync-dev/`，不碰雲端） |
| `tools/`（41 支） | 去背流水線、破洞修補、方向校正、目視檢查表、靜態匯出 |

另有 `vercel.json`（JSON 放不了註解）：關掉 Git 自動部署。

### 改過的上游檔案（11 個）

有標頭的 7 個：`index.html`、`src/App.jsx`、`src/styles.css`、`src/OptimizedImage.jsx`、
`.gitignore`、`vite.config.mjs`，以及 `tools/import-to-wardrobe.mjs`
（原本在 `.agents/skills/import-clothes/scripts/`，搬進 `tools/`）。改動內容寫在各自的第一行。

放不了註解的 4 個：`package.json`、`package-lock.json`、`public/manifest.webmanifest`
（JSON）與本檔。

改動集中在：介面繁體中文化、深色襯線主題、擴充部位分類（襪子／包／眼鏡／腕飾），
以及 `src/App.jsx` 裡的衣櫃畫面、單品頁、垃圾桶。

### 上游原封不動（8 個，請勿當成這個版本的作品）

`LICENSE`、`CONTRIBUTING.md`、`.npmrc`、`.github/workflows/ci.yml`、
`src/main.jsx`、`scripts/responsive-image-api.mjs`、
`public/icon.svg`、`public/sw.js`

### 移除的上游功能

上游附了一套線上匯入流程（雲端影像 API，加上對應的網頁托盤與開發用 API），這個版本沒有用到：
- 衣服一律走 `tools/` 的離線流程建檔。
- 留著只會讓網頁多送兩個必定 404 的請求，所以整套移除，主程式少了約 25 kB。

一起移除的還有：
- 配合這套流程的兩個 agent skill（`.agents/skills/` 的 generate-outfits、import-clothes，走 OpenAI 生圖）。import-clothes 的匯入腳本搬進 `tools/` 保留。
- `.env.example`（OpenAI 金鑰範本）。
- 上游的 `docs/screenshots/`（兩張截圖，畫面已經完全不同）。

移除的 11 個：`src/import-flow.jsx`、`src/import-flow.css`、`scripts/import-job-api.mjs`、
`.env.example`、`.agents/skills/` 底下 5 個、`docs/screenshots/` 底下 2 個。

自己寫的部分授權同為 MIT，見 [LICENSE](LICENSE)；依賴套件各自的授權見上面「限制」。
