// [本 fork 新增] 上游 tandpfun/wardrobe 沒有此檔,整份由本 fork 撰寫。
import { useEffect, useState } from "react";
import { localFullImage } from "./localWardrobe.js";

/* 自己加的衣服,清單裡的 image 先放縮圖、標 fullImageId(原圖等要用才讀進記憶體,見 localWardrobe.js 的
   「縮圖與原圖分開」,2026-10-06)。要看清楚的地方 —— 單品頁、人台、穿搭卡 —— 用這裡換成原圖:
   讀到之前先給縮圖,讀不到(iPhone 的 WebKit 地雷弄壞的)就一直用縮圖。站主衣櫃的衣服沒有 fullImageId,照原本的 image。 */

// 圖換過的話縮圖網址也會換,一起當成 key,才不會拿到換掉之前那張的原圖
const keyOf = (item) => (item?.fullImageId ? `${item.fullImageId}|${item.thumbnail}` : null);

/** 穿搭卡這類一次性的:等原圖讀好再畫 */
export async function fullImageOf(item) {
  return (item?.fullImageId && (await localFullImage(item.fullImageId))) || item?.image;
}

/** 一組衣服(人台上那幾件);回傳一個函式:給一件,回它現在能用的最大那張圖 */
export function useFullImages(items) {
  const [urls, setUrls] = useState({});
  const signature = items.map(keyOf).filter(Boolean).join("\n");
  useEffect(() => {
    let live = true;
    for (const item of items) {
      const key = keyOf(item);
      if (!key) continue;
      localFullImage(item.fullImageId).then((url) => {
        if (live && url) setUrls((current) => (current[key] === url ? current : { ...current, [key]: url }));
      });
    }
    return () => { live = false; };
  }, [signature]);   // eslint-disable-line react-hooks/exhaustive-deps -- 只看哪幾張要原圖,items 每次 render 都是新陣列
  return (item) => urls[keyOf(item)] || item?.image;
}

/** 單品頁這類只有一件的 */
export function useFullImage(item) {
  return useFullImages(item ? [item] : [])(item);
}
