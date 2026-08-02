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

## 來源

Fork 自 [tandpfun/wardrobe](https://github.com/tandpfun/wardrobe)，MIT 授權。
上游提供了衣物畫廊與匯入流程的基礎；本 repo 的 `src/OutfitStudio.jsx`、
`src/recommend.js`、`src/LandingRing.jsx`、`src/AddGarment.jsx`、
`src/localWardrobe.js` 與整個 `tools/` 為新增。

上游的匯入流程（`.agents/skills/`）需要 `OPENAI_API_KEY` 與
`data/model-reference.png`，設定項見 [`.env.example`](.env.example)。

授權同為 MIT，見 [LICENSE](LICENSE)。
