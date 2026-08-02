// 幫 library.json 的每件衣物補上推薦引擎需要的欄位:
//   warmth 1(最涼)~5(最保暖)、occasions [school/out/sport]、rainOk
// 規則從品名+標籤推導。之後匯入新衣物後要重跑一次(只補缺的,不覆蓋已有的)。
import { readFile, writeFile } from "node:fs/promises";

const lib = JSON.parse(await readFile("data/library.json", "utf8"));

const has = (item, ...keys) => keys.some((k) =>
  item.name.includes(k) || (item.tags || []).some((t) => String(t).toLowerCase().includes(k.toLowerCase())));

function derive(item) {
  const p = item.part;
  let warmth = 2, occasions = ["school", "out"], rainOk = true;

  if (p === "upperbody") {
    if (has(item, "短袖", "五分袖", "背心", "坦克", "Polo", "polo")) warmth = 1;
    else if (has(item, "襯衫") && !has(item, "法蘭絨")) warmth = 2;
    else if (has(item, "內搭", "長袖T", "長袖上衣", "長袖T恤", "longsleeve")) warmth = 2;
    else if (has(item, "大學T", "衛衣", "帽T", "hoodie", "sweatshirt")) warmth = 3;
    else if (has(item, "毛衣", "針織", "法蘭絨", "開襟", "knit", "cardigan", "sweater", "flannel")) warmth = 4;
    else warmth = 2;
    if (has(item, "運動", "排汗", "球衣")) occasions = ["school", "out", "sport"];
  }

  if (p === "lowerbody") {
    if (has(item, "短褲", "shorts")) warmth = 1;
    else if (has(item, "西裝", "斜紋", "打褶", "trousers", "dress-pants")) warmth = 3;
    else if (has(item, "棉褲", "運動", "sweatpants", "jogger")) warmth = 3;
    else warmth = 3;   // 牛仔褲、工裝褲
    if (has(item, "運動", "棉褲", "sweatpants", "尼龍", "機能")) occasions = ["school", "out", "sport"];
    if (has(item, "西裝")) occasions = ["school", "out"];
  }

  if (p === "wholebody_up") {
    if (has(item, "皮", "羊毛", "leather", "wool", "大衣")) warmth = 5;
    else if (has(item, "防風", "windbreaker", "風衣")) warmth = 2;
    else if (has(item, "丹寧", "獵裝", "襯衫式", "夾克", "jacket", "blouson")) warmth = 3;
    else if (has(item, "西裝外套", "blazer")) warmth = 3;
    else warmth = 3;
  }

  if (p === "socks") { warmth = 1; occasions = ["school", "out", "sport"]; }
  if (p === "shoes") { warmth = 2; occasions = ["school", "out"]; }

  // 怕雨:皮革、羊毛、毛衣針織、法蘭絨、麂皮、淺色褲
  if (has(item, "皮", "羊毛", "毛衣", "針織", "法蘭絨", "燈芯絨", "leather", "wool", "knit", "corduroy", "suede")) rainOk = false;
  if (has(item, "白色", "米白", "淺灰", "米色") && (p === "lowerbody" || p === "shoes")) rainOk = false;
  if (has(item, "防風", "防潑", "尼龍", "nylon", "windbreaker")) rainOk = true;

  return { warmth, occasions, rainOk };
}

let added = 0;
for (const item of lib) {
  const d = derive(item);
  if (item.warmth === undefined) { item.warmth = d.warmth; added++; }
  if (item.occasions === undefined) item.occasions = d.occasions;
  if (item.rainOk === undefined) item.rainOk = d.rainOk;
}
await writeFile("data/library.json", JSON.stringify(lib, null, 2));

// 印出總表供人工掃描
const byPart = {};
for (const it of lib) (byPart[it.part] ||= []).push(it);
for (const [part, group] of Object.entries(byPart)) {
  console.log(`\n=== ${part} (${group.length}) ===`);
  for (const it of group.sort((a, b) => a.warmth - b.warmth)) {
    console.log(` w${it.warmth} ${it.rainOk ? "  " : "雨x"} [${it.occasions.map(o=>o[0]).join("")}] ${it.name}`);
  }
}
console.log(`\n補齊 ${added} 件`);
