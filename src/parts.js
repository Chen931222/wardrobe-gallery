// [本 fork 新增] 衣服的分類(部位)只有這一份:衣櫃的目錄、新增的選單、搭配頁的衣架、入口圓環都從這裡讀。
//
// 2026-10-06 本人要加皮帶、戒指、項鍊、鋼筆。舊版分類清單散在五六個檔案,各寫一份,加一類要改每一處,
// 漏一處那一類的衣服就在那裡看不到。分組照衣櫃目錄的樣子:衣服、鞋襪、配件、隨身小物。
// 「隨身小物」(鋼筆、皮夾、打火機)不是穿在身上的,推薦不會自動配;手動穿上時人台把它畫在胸前口袋。
export const PART_GROUPS = [
  { id: "clothes", label: "衣服", parts: ["upperbody", "wholebody_up", "lowerbody"] },
  { id: "feet", label: "鞋襪", parts: ["shoes", "socks"] },
  { id: "accessories", label: "配件", parts: ["bag", "eyewear", "wrist", "belt", "necklace", "ring", "accessories_up"] },
  { id: "carry", label: "隨身", parts: ["carry"] },
];

/** 完整名稱(選單、衣架);short 是衣櫃目錄裡放在「配件」那一行時的短名 */
export const PARTS = {
  upperbody: { label: "上衣", singular: "上衣" },
  wholebody_up: { label: "外套", singular: "外套" },
  lowerbody: { label: "下身", singular: "下身" },
  shoes: { label: "鞋子", singular: "鞋子" },
  socks: { label: "襪子", singular: "襪子" },
  bag: { label: "包款", singular: "包" },
  eyewear: { label: "眼鏡", singular: "眼鏡" },
  wrist: { label: "手錶手環", singular: "腕上配件", short: "手錶" },
  belt: { label: "皮帶", singular: "皮帶" },
  necklace: { label: "項鍊", singular: "項鍊" },
  ring: { label: "戒指", singular: "戒指" },
  accessories_up: { label: "其他配件", singular: "配件", short: "其他" },
  carry: { label: "隨身小物", singular: "小物", short: "小物", hint: "鋼筆、皮夾、打火機" },
};

export const PART_ORDER = PART_GROUPS.flatMap((group) => group.parts);
export const partLabel = (part) => PARTS[part]?.label || "單品";
export const partSingular = (part) => PARTS[part]?.singular || "衣物";
