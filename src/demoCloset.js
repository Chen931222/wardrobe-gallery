// [本 fork 新增] 示範衣櫃:給朋友、作品集訪客看的 20 件。網站(App)和匯出上線(tools/export-static.mjs)共用。
//
// 2026-10-05 起是人工挑的,不是亂數抽樣。舊的抽法(依 id 雜湊各類取幾件)抽到的鞋只有拖鞋不怕雨,
// 一下雨就是「羊毛大衣配拖鞋」,模擬 14 種天氣 × 40 次推薦有 553/560 次是怪搭配;這份是 0/560。
// 挑法:色系收在黑白灰藍和一點大地色;冷熱、下雨都配得出來(不怕雨的鞋、外套至少各一件);不放球衣和拖鞋。
//
// 線上只有這 20 件是公開的(/data/wardrobe.json);站主完整的衣櫃要帶同步碼從 /api/closet 拿。
export const DEMO_IDS = [
  "import-2babbda3-ffc5-451e-9dbd-bcb0d72d3df4",   // 米白重磅純棉寬鬆短袖T恤
  "import-a50e6d4d-0180-4a34-90cb-7c6eb55e4657",   // 黑色寬版五分袖T恤
  "import-700776e2-2a0a-4595-8989-e6ba0e46adc7",   // 淺藍牛津紡扣領長袖襯衫
  "import-cc67aa00-f5b8-4135-959c-562b30ad671a",   // 淺麻灰圓領長袖T恤
  "import-edf302da-c12b-493e-a9ca-c2c6b6b37ff3",   // 灰藍棉質落肩圓領大學T
  "import-96009ee3-ddab-4eb9-9c7c-38517eef7725",   // 深藍羅紋針織圓領毛衣
  "import-6677979f-0212-433d-9c9d-a1b5a3d8b9f1",   // 深藍連帽防風外套(下雨用)
  "import-27d0fd02-3ba6-4db0-91bc-1e94549142d0",   // 深藍原色丹寧四口袋工裝外套
  "import-7d5deaad-dac0-4391-9c09-e62d4d60446a",   // 駝色斜紋厚棉襯衫式外套
  "import-2c84275b-6dde-48a4-9f91-b5c2817762ed",   // 深褐黑水洗直筒牛仔褲
  "import-c696e8ca-2d60-487b-a56e-d7a8ece4e31c",   // 灰色抽繩打褶寬版西裝長褲
  "import-bd085536-c7ef-4b36-9c3c-9e5b4ffa3188",   // 淺灰垂墜抽繩寬管長褲
  "import-8cd1cfa3-7f8e-4f43-9ee2-11c0dad23c7c",   // 卡其棉質抽繩寬版短褲
  "import-7bc2fc11-8b9b-44dd-aac2-ff708aa3e2e3",   // 深藍斜紋棉休閒短褲
  "import-9a5fc2a3-c5c0-4220-b018-cb4a974c09a5",   // 灰紫機能復古慢跑鞋(下雨用)
  "import-719b4862-b21c-4137-85e4-b9d61ac0fa22",   // 米白帆布側拉鍊高筒鞋
  "import-47d9abaf-d6c9-4531-96f1-dbb801789d03",   // 黑色真皮厚底休閒鞋
  "import-99c790ca-341c-4c23-bbc1-76429db53aa8",   // 米白尼龍半月斜背包
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
  };
}

/** 從一份衣櫃裡挑出示範的那幾件(照 DEMO_IDS 的順序)。已經是示範版的再跑一次結果不變。 */
export function demoCloset(list) {
  const byId = new Map((list || []).map((item) => [item.id, item]));
  return DEMO_IDS.map((id) => byId.get(id)).filter(Boolean).map(toDemoItem);
}
