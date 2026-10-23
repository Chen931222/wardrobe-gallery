// [本 fork 新增] 示範衣櫃:給朋友、作品集訪客看的 20 件。網站(App)和匯出上線(tools/export-static.mjs)共用。
//
// 2026-10-05 起是人工挑的,不是亂數抽樣。舊的抽法(依 id 雜湊各類取幾件)抽到的鞋只有拖鞋不怕雨,
// 一下雨就是「羊毛大衣配拖鞋」,模擬 14 種天氣 × 40 次推薦有 553/560 次是怪搭配;這份是 0/560。
// 挑法:色系收在黑白灰藍和一點大地色;冷熱、下雨都配得出來(不怕雨的鞋、外套至少各一件);不放球衣和拖鞋。
//
// 線上只有這 20 件是公開的(/data/wardrobe.json);站主完整的衣櫃要帶同步碼從 /api/closet 拿。
// 2026-10-23 本人「換幾張更好的、我們自己拍的圖」:皺成一團、有污漬感、去背沒乾淨的 7 件換成同類、同保暖度、
// 同場合、下雨可不可以一樣(或更好)的另一件;模擬 14 種體感 × 下雨/晴 × 40 次,換前換後怪搭配都是 0
// (work/demo-pick-2026-10-23/simulate.mjs)。換掉的:米白重磅短袖T、黑色寬版五分袖T、淺藍牛津襯衫、
// 淺麻灰長袖T、淺灰垂墜寬管長褲(換成炭灰丹寧寬版長褲;深灰工裝褲試過,上人台皺成一團)、灰色打褶西裝長褲、米白尼龍半月斜背包。
export const DEMO_IDS = [
  "import-694650a4-f2fb-40f4-b68a-c8fccc2cddd2",   // 白色寬版落肩五分袖素T
  "import-a3212656-bed2-4d19-9c42-6459a74df39d",   // 黑色水洗丹寧亨利領短袖上衣
  "import-a397925c-5639-4377-9b93-62cd34a0d567",   // 白色棉質長袖襯衫
  "import-b7b7008a-6b86-4e7b-8079-1c716894171a",   // 米白胸前口袋落肩長袖T恤
  "import-edf302da-c12b-493e-a9ca-c2c6b6b37ff3",   // 灰藍棉質落肩圓領大學T
  "import-96009ee3-ddab-4eb9-9c7c-38517eef7725",   // 深藍羅紋針織圓領毛衣
  "import-6677979f-0212-433d-9c9d-a1b5a3d8b9f1",   // 深藍連帽防風外套(下雨用)
  "import-27d0fd02-3ba6-4db0-91bc-1e94549142d0",   // 深藍原色丹寧四口袋工裝外套
  "import-7d5deaad-dac0-4391-9c09-e62d4d60446a",   // 駝色斜紋厚棉襯衫式外套
  "import-2c84275b-6dde-48a4-9f91-b5c2817762ed",   // 深褐黑水洗直筒牛仔褲
  "import-b433fbef-efd5-45a7-af92-5bedc8ad01d2",   // 黑色西裝長褲
  "import-541a8bc2-1554-4ee3-9694-39653974f146",   // 炭灰水洗丹寧寬版長褲
  "import-8cd1cfa3-7f8e-4f43-9ee2-11c0dad23c7c",   // 卡其棉質抽繩寬版短褲
  "import-7bc2fc11-8b9b-44dd-aac2-ff708aa3e2e3",   // 深藍斜紋棉休閒短褲
  "import-9a5fc2a3-c5c0-4220-b018-cb4a974c09a5",   // 灰紫機能復古慢跑鞋(下雨用)
  "import-719b4862-b21c-4137-85e4-b9d61ac0fa22",   // 米白帆布側拉鍊高筒鞋
  "import-47d9abaf-d6c9-4531-96f1-dbb801789d03",   // 黑色真皮厚底休閒鞋
  "import-240d1da5-04de-4f2d-aa5f-b742454a3b6d",   // 黑色尼龍皮革拼接單肩腰包
  "import-0f200539-74a5-4378-bd43-37c213e3efd3",   // 黑色尼龍電腦後背包
  "import-e5760458-670c-4382-a20c-00ae090c6cbb",   // 白色羅紋中筒襪
];
const DEMO_SET = new Set(DEMO_IDS);

const BRAND_TAGS = new Set(["adidas", "nike", "mlb", "dickies", "gu", "lacoste", "new balance", "samsonite", "timberland", "under armour", "tods", "polo-rl", "padres", "nationals"]);

export const isDemoItem = (item) => DEMO_SET.has(item?.id);

/** 示範用的樣子:品名去掉括號裡的品牌(「灰紫機能復古慢跑鞋(New Balance 1000)」→「灰紫機能復古慢跑鞋」),標籤拿掉品牌。 */
export function toDemoItem(item) {
  return {
    ...item,
    name: String(item.name || "").replace(/\s*[（(][^()（）]*[)）]\s*$/, "").trim() || item.name,
    tags: (item.tags || []).filter((tag) => !BRAND_TAGS.has(String(tag).toLowerCase())),
    brand: "",   // 示範衣櫃刻意不放品牌(品名、標籤都拿掉了);空白 = 不寫,brands.js 不會再猜
  };
}

/** 從一份衣櫃裡挑出示範的那幾件(照 DEMO_IDS 的順序)。已經是示範版的再跑一次結果不變。 */
export function demoCloset(list) {
  const byId = new Map((list || []).map((item) => [item.id, item]));
  return DEMO_IDS.map((id) => byId.get(id)).filter(Boolean).map(toDemoItem);
}
