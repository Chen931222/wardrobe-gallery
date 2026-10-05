// [本 fork 修改] 上游 tandpfun/wardrobe 既有檔案。本 fork 的改動:介面全繁中化並擴充分類,新增入口環/衣櫃/搭配三頁切換、IndexedDB 本機衣物合併與格子刪除鈕。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Sparkle, Trash, X } from "@phosphor-icons/react";
import { OptimizedImage } from "./OptimizedImage.jsx";
import { OutfitStudio, rememberWearing } from "./OutfitStudio.jsx";
import { LandingRing } from "./LandingRing.jsx";
import { AddGarment } from "./AddGarment.jsx";
import { SyncPanel } from "./SyncPanel.jsx";
import { deleteLocalItem, findUrl, loadLocalItems, productUrlProblem, updateLocalItem } from "./localWardrobe.js";
import { CAN_ADD, CAN_EDIT, canEditItem } from "./ownerMode.js";
import { hasLocalChanges, lastSyncError, noteDeliberateDelete, scheduleSync, syncCode, syncNotice, syncNow } from "./sync.js";
import { findSimilar, fitOf, guessWarmth, kindLabel, wishOutfits } from "./wishCheck.js";
import { colorName, isNeutral } from "./recommend.js";
import { useDialog } from "./useDialog.js";
import { ScrollRail } from "./ScrollRail.jsx";
import { fetchPriceForUrl } from "./brandLink.js";
import { CURRENCIES, formatPrice, parsePrice } from "./price.js";
import { importBackupFile } from "./backup.js";
import { Welcome } from "./Welcome.jsx";

const STORAGE_KEY = "open-wardrobe-edits-v1";
const DELETED_STORAGE_KEY = "open-wardrobe-deleted-v1";

// 由上到下、由主到次排列,和穿搭頁的槽位順序一致
const TYPES = [
  { id: "all", label: "全部" },
  { id: "upperbody", label: "上衣", singular: "上衣" },
  { id: "wholebody_up", label: "外套", singular: "外套" },
  { id: "lowerbody", label: "下身", singular: "下身" },
  { id: "socks", label: "襪子", singular: "襪子" },
  { id: "shoes", label: "鞋子", singular: "鞋子" },
  { id: "bag", label: "包款", singular: "包" },
  { id: "eyewear", label: "眼鏡", singular: "眼鏡" },
  { id: "wrist", label: "手錶手環", singular: "腕上配件" },
  { id: "accessories_up", label: "其他配件", singular: "配件" },
];

const TYPE_MAP = Object.fromEntries(TYPES.map((type) => [type.id, type]));

/* 衣櫃標籤是離線流程用英文關鍵字寫的,給人看的唯讀頁換成中文(審查 F50)。品牌照原文。
   對不到的照原樣顯示:可能是站主自己打的。 */
const TAG_ZH = {
  "acid-wash": "酸洗", backpack: "後背包", baggy: "寬版", baseball: "棒球", baselayer: "內搭", belted: "附腰帶", biker: "騎士",
  black: "黑色", blazer: "西裝外套", blouson: "短夾克", burgundy: "酒紅", "button-up": "排扣", camo: "迷彩", canvas: "帆布",
  cardigan: "開襟", cargo: "工裝", "cargo-pants": "工裝褲", casual: "休閒", cat: "貓", charcoal: "炭灰", chino: "卡其褲",
  chore: "工作外套", chunky: "厚底", "city-connect": "城市版", coach: "教練外套", "contrast-stitch": "對比車線", corduroy: "燈芯絨",
  cotton: "棉", "cotton-fleece": "刷毛棉", court: "球場鞋", cream: "奶油色", creased: "壓線", crescent: "半月", crew: "圓領",
  crewneck: "圓領", crossbody: "斜背", "dark-gray": "深灰", denim: "丹寧", distressed: "破損", drapey: "垂墜", drawstring: "抽繩",
  "dress-pants": "西裝褲", "elastic-waist": "鬆緊腰", embroidered: "刺繡", "embroidered-logo": "刺繡標誌", field: "野戰",
  "five-pocket": "五口袋", flannel: "法蘭絨", fleece: "刷毛", graphic: "印花", "graphic print": "印花", grey: "灰色",
  halfzip: "半拉鍊", "harry-potter": "哈利波特", heather: "麻花", "heather-gray": "麻灰", heavyweight: "厚磅", henley: "亨利領",
  hightop: "高筒", hoodie: "帽T", jacket: "夾克", jeans: "牛仔褲", jersey: "球衣", jogger: "束口褲", knit: "針織", laptop: "筆電包",
  layered: "疊穿", leather: "皮革", "light-wash": "淺色水洗", lightweight: "輕薄", longsleeve: "長袖", loungewear: "居家服",
  mesh: "網布", mockneck: "半高領", nationals: "國民隊", navy: "深藍", nylon: "尼龍", olive: "橄欖綠", "open-collar": "開領",
  oversized: "寬版", oxford: "牛津布", padres: "教士隊", pants: "長褲", parachute: "降落傘褲", patch: "布章", pinstripe: "細條紋",
  pleated: "打褶", "pocket-tee": "口袋 T", polo: "Polo 衫", "polo-rl": "Polo Ralph Lauren", preppy: "學院風", red: "紅色",
  "relaxed-fit": "寬鬆", retro: "復古", ribbed: "羅紋", running: "慢跑", sandals: "涼鞋", shirt: "襯衫", "shirt-jacket": "襯衫外套",
  "short sleeve": "短袖", shorts: "短褲", shortsleeve: "短袖", "shoulder bag": "肩背包", signature: "經典款", skater: "滑板",
  sleeveless: "無袖", slides: "拖鞋", sling: "斜背", "smart-casual": "休閒正式", sneakers: "球鞋", socks: "襪子", sport: "運動",
  "straight-leg": "直筒", streetwear: "街頭", striped: "條紋", suede: "麂皮", "sweat-shorts": "棉短褲", sweater: "毛衣",
  sweatpants: "棉褲", sweatshirt: "大學T", tank: "背心", tee: "T 恤", techwear: "機能風", textured: "紋理", tods: "TOD'S", trousers: "長褲",
  twill: "斜紋布", vest: "背心", vintage: "古著", vneck: "V 領", waffle: "鬆餅格", "waist bag": "腰包", washed: "水洗",
  "washed-black": "水洗黑", "wide-leg": "寬褲", windbreaker: "防風外套", wool: "羊毛", workwear: "工裝", zip: "拉鍊",
  "zip-off": "可拆褲管", "zip-pocket": "拉鍊口袋",
  adidas: "adidas", nike: "Nike", mlb: "MLB", dickies: "Dickies", gu: "GU", lacoste: "Lacoste", "new balance": "New Balance",
  samsonite: "Samsonite", timberland: "Timberland", "under armour": "Under Armour",
};
const tagLabel = (tag) => TAG_ZH[String(tag).toLowerCase()] || tag;

/* 示範衣櫃:給朋友、作品集訪客看的。不攤開站主全部 104 件,只放一小份樣本(各類幾件,今日推薦還配得出來),
   品名去掉括號裡的品牌(「紅色網布輕量慢跑鞋(Nike)」→「紅色網布輕量慢跑鞋」),標籤拿掉品牌。
   2026-10-05 本人:網站給朋友試用了,不想把自己的衣服都放在入口。站主自己(?edit)照舊看全部。
   注意這只是畫面上不顯示:data/wardrobe.json 還是公開的,直接開那個網址看得到全部。 */
const DEMO_QUOTA = { upperbody: 6, wholebody_up: 3, lowerbody: 5, shoes: 3, bag: 2, socks: 1 };
const BRAND_TAGS = new Set(["adidas", "nike", "mlb", "dickies", "gu", "lacoste", "new balance", "samsonite", "timberland", "under armour", "tods", "polo-rl", "padres", "nationals"]);
const stableHash = (text) => [...String(text)].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 7);
function demoSample(served) {
  const picked = [];
  const sorted = [...served].sort((a, b) => stableHash(a.id) - stableHash(b.id));   // 每次都挑同一份,不是每次重新整理換一批
  for (const [part, count] of Object.entries(DEMO_QUOTA)) picked.push(...sorted.filter((item) => item.part === part).slice(0, count));
  return picked.map((item) => ({
    ...item,
    name: String(item.name || "").replace(/\s*[（(][^()（）]*[)）]\s*$/, "").trim() || item.name,
    tags: (item.tags || []).filter((tag) => !BRAND_TAGS.has(String(tag).toLowerCase())),
  }));
}
const TYPE_ORDER = Object.fromEntries(TYPES.slice(1).map((type, index) => [type.id, index]));


function readEdits() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}


const EDIT_FIELDS = ["name", "part", "color", "secondaryColor", "tags", "price", "priceCurrency"];
const editValue = (item, field) => {
  const value = item?.[field];
  if (field === "tags") return value || [];
  if (field === "name") return value || "";
  return value ?? null;
};

/** 只記跟原本(建檔時、還沒任何編輯)不一樣的欄位。整筆寫入的話,兩台各改一欄時同步分不出誰改了哪一欄,
 *  後存的那台會把另一台的修改整件蓋掉(2026-10-03)。改回原值的欄位就拿掉,沒有改過的整件就刪掉。 */
function persistEdit(item, original) {
  const edits = readEdits();
  const entry = {};
  for (const field of EDIT_FIELDS) {
    const value = editValue(item, field);
    if (!original || JSON.stringify(value) !== JSON.stringify(editValue(original, field))) entry[field] = value;
  }
  if (Object.keys(entry).length) edits[item.id] = entry;
  else delete edits[item.id];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("wardrobe-local-change"));   // 開了同步的話,5 秒後推上去
}

function removePersistedEdit(id) {
  const edits = readEdits();
  delete edits[id];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("wardrobe-local-change"));
}

function readDeletedItems() {
  try {
    const value = JSON.parse(localStorage.getItem(DELETED_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}

function persistDeletedItem(id) {
  const deleted = readDeletedItems();
  deleted.add(id);
  localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify([...deleted]));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("wardrobe-local-change"));
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;
}

function colorDistance(first, second) {
  return Math.sqrt(
    ((first.red - second.red) ** 2)
    + ((first.green - second.green) ** 2)
    + ((first.blue - second.blue) ** 2),
  );
}

function extractPalette(image) {
  const canvas = document.createElement("canvas");
  canvas.width = 72;
  canvas.height = 72;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const buckets = new Map();

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 72) continue;

    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const key = `${Math.round(red / 28)}-${Math.round(green / 28)}-${Math.round(blue / 28)}`;
    const current = buckets.get(key) || { red: 0, green: 0, blue: 0, count: 0 };
    current.red += red;
    current.green += green;
    current.blue += blue;
    current.count += 1;
    buckets.set(key, current);
  }

  const ranked = [...buckets.values()]
    .map((bucket) => ({
      red: Math.round(bucket.red / bucket.count),
      green: Math.round(bucket.green / bucket.count),
      blue: Math.round(bucket.blue / bucket.count),
      count: bucket.count,
    }))
    .sort((a, b) => b.count - a.count);

  const selected = [];
  for (const color of ranked) {
    if (selected.every((existing) => colorDistance(existing, color) > 38)) selected.push(color);
    if (selected.length === 5) break;
  }

  return selected.map((color) => rgbToHex(color.red, color.green, color.blue));
}

function buildSamplingCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0);
  return canvas;
}

function sampleImageColor(image, canvas, event) {
  const bounds = image.getBoundingClientRect();
  const scale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
  const renderedWidth = image.naturalWidth * scale;
  const renderedHeight = image.naturalHeight * scale;
  const offsetX = (bounds.width - renderedWidth) / 2;
  const offsetY = (bounds.height - renderedHeight) / 2;
  const imageX = Math.floor((event.clientX - bounds.left - offsetX) / scale);
  const imageY = Math.floor((event.clientY - bounds.top - offsetY) / scale);

  if (imageX < 0 || imageY < 0 || imageX >= canvas.width || imageY >= canvas.height) return null;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  for (let radius = 0; radius <= 18; radius += 2) {
    const startX = Math.max(0, imageX - radius);
    const startY = Math.max(0, imageY - radius);
    const width = Math.min(canvas.width - startX, (radius * 2) + 1);
    const height = Math.min(canvas.height - startY, (radius * 2) + 1);
    const data = context.getImageData(startX, startY, width, height).data;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] > 96) return rgbToHex(data[index], data[index + 1], data[index + 2]);
    }
  }

  return null;
}

function GalleryItem({ item, selected, onOpen, onDelete }) {
  const type = TYPE_MAP[item.part]?.singular || "衣物";
  const label = item.name || type;

  return (
    <div className={`gallery-cell${selected ? " selected" : ""}`}>
      <button
        className="gallery-item"
        type="button"
        onClick={() => onOpen(item.id)}
        aria-label={`查看${label}${item.wishlist ? "(還沒買)" : ""}`}
        aria-pressed={selected}
        data-testid={`wardrobe-item-${item.id}`}
      >
        <OptimizedImage
          src={item.thumbnail || item.image}
          alt=""
          sizes="(max-width: 520px) calc(50vw - 16px), (max-width: 860px) calc(33vw - 18px), 180px"
          breakpoints={[120, 180, 240, 320, 480]}
        />
        {item.wishlist && <span className="wish-badge">想買</span>}
      </button>
      {Boolean(item.price) && <span className="gallery-price">{formatPrice(item.price, item.priceCurrency)}</span>}
      {canEditItem(item) && (
        <button
          className="gallery-delete"
          type="button"
          onClick={() => onDelete(item.id)}
          aria-label={`刪除${label}`}
        >
          <Trash size={14} weight="regular" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function TagEditor({ tags, onChange }) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const nextTag = input.trim().replace(/^#/, "");
    if (!nextTag || tags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) return;
    onChange([...tags, nextTag]);
    setInput("");
  };

  return (
    <div className="tag-editor">
      <div className="editable-tags">
        {tags.map((tag) => (
          <span className="editable-tag" key={tag}>
            {tag}
            <button type="button" onClick={() => onChange(tags.filter((existing) => existing !== tag))} aria-label={`移除 ${tag}`}>
              <X size={12} weight="regular" aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <div className="tag-input-row">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addTag();
            }
          }}
          placeholder="加一個細節標籤"
          aria-label="新增細節標籤"
        />
        <button type="button" onClick={addTag} disabled={!input.trim()} aria-label="新增細節">
          <Plus size={15} weight="regular" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function ColorControl({ label, field, value, palette, onChange, sampling, setSampling, optional = false, onClear, onAdd }) {
  if (optional && !value) {
    return (
      <div className="color-slot empty-color-slot">
        <div className="color-slot-heading">
          <span>{label}</span>
          <small>選填</small>
        </div>
        <p>沒有偵測到明顯的副色。</p>
        <button className="add-secondary-button" type="button" onClick={onAdd}>新增副色</button>
      </div>
    );
  }

  return (
    <div className="color-slot">
      <div className="color-slot-heading">
        <span>{label}</span>
        {optional && <button type="button" onClick={onClear}>移除</button>}
      </div>
      <label className="selected-color-control">
        <input
          type="color"
          value={value || "#9a9286"}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`選擇${label}`}
        />
        <span className="selected-color-copy" title={value || undefined}>
          <small>目前</small>
          <strong>{value ? colorName(value) : "自訂"}</strong>
        </span>
      </label>
      <div className="suggestion-heading">
        <span>圖片建議色</span>
        <small>點一下套用</small>
      </div>
      <div className="palette" aria-label={`從圖片取出的${label}建議`}>
        {palette.map((color) => (
          <button
            type="button"
            key={color}
            className={value?.toLowerCase() === color.toLowerCase() ? "active" : ""}
            style={{ backgroundColor: color }}
            onClick={() => onChange(color)}
            aria-label={`把這個${colorName(color)}設為${label}`}
            title={colorName(color)}
          />
        ))}
      </div>
      <button
        className={`sample-button${sampling === field ? " active" : ""}`}
        type="button"
        onClick={() => setSampling((current) => current === field ? null : field)}
      >
        {sampling === field ? "取消吸色" : `從圖片吸${label}`}
      </button>
    </div>
  );
}

function ItemEditor({ draft, setDraft, palette, sampling, setSampling, sampleStatus, priceStatus = "", onFetchPrice = null }) {
  const suggestedSecondary = palette.find((color) => color.toLowerCase() !== draft.color?.toLowerCase()) || "#9a9286";

  return (
    <div className="item-editor">
      <label className="field">
        <span>名稱</span>
        <input
          value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          placeholder={TYPE_MAP[draft.part]?.singular || "衣物"}
        />
      </label>

      <label className="field">
        <span>分類</span>
        <select value={draft.part} onChange={(event) => setDraft((current) => ({ ...current, part: event.target.value }))}>
          {TYPES.slice(1).map((type) => <option value={type.id} key={type.id}>{type.label}</option>)}
        </select>
      </label>

      {/* 價錢:想買的有商品網址就自己去抓(打開單品頁時、或按「從網址抓價錢」);沒有網址的自己填 */}
      <div className="field price-field">
        <span>價錢</span>
        <div className="price-row">
          <select aria-label="幣別" value={draft.priceCurrency || "TWD"} onChange={(event) => setDraft((current) => ({ ...current, priceCurrency: event.target.value }))}>
            {CURRENCIES.map(([code, symbol]) => <option key={code} value={code}>{symbol}</option>)}
          </select>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-label="價錢"
            value={draft.price}
            onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))}
            placeholder="還沒標價"
          />
        </div>
        {(priceStatus || onFetchPrice) && (
          <p className="price-status" aria-live="polite">
            {priceStatus}
            {onFetchPrice && <button type="button" className="price-fetch" onClick={onFetchPrice}>從網址抓價錢</button>}
          </p>
        )}
      </div>

      <fieldset className="color-field">
        <legend>顏色</legend>
        <div className="colors-editor">
          <ColorControl
            label="主色"
            field="primary"
            value={draft.color}
            palette={palette}
            onChange={(color) => setDraft((current) => ({ ...current, color }))}
            sampling={sampling}
            setSampling={setSampling}
          />
          <ColorControl
            label="副色"
            field="secondary"
            value={draft.secondaryColor}
            palette={palette}
            onChange={(secondaryColor) => setDraft((current) => ({ ...current, secondaryColor }))}
            sampling={sampling}
            setSampling={setSampling}
            optional
            onClear={() => setDraft((current) => ({ ...current, secondaryColor: null }))}
            onAdd={() => setDraft((current) => ({ ...current, secondaryColor: suggestedSecondary }))}
          />
        </div>
        <p className="color-help" aria-live="polite">{sampling ? "點衣服上的任一處吸取顏色。" : sampleStatus || "主色是從圖片自動抓的;只有在偵測到明顯的第二種顏色時才會建議副色。"}</p>
      </fieldset>

      <div className="field details-field">
        <span>細節標籤</span>
        <TagEditor tags={draft.tags} onChange={(tags) => setDraft((current) => ({ ...current, tags }))} />
      </div>
    </div>
  );
}

// 公開展覽版:唯讀呈現單品(分類、色票+hex、標籤),再給一個「拿去搭配頁穿上」的出口。
function ReadOnlyDetails({ item, onWear }) {
  const type = TYPE_MAP[item.part]?.singular || "衣物";
  const colors = [
    item.color && { hex: item.color, label: "主色" },
    item.secondaryColor && { hex: item.secondaryColor, label: "副色" },
  ].filter(Boolean);
  const tags = [...new Set((item.tags || []).map(tagLabel))];
  return (
    <div className="viewer-readonly">
      <p className="viewer-ro-category">{type}</p>
      {Boolean(item.price) && <p className="viewer-ro-price">{formatPrice(item.price, item.priceCurrency)}</p>}
      {!!colors.length && (
        <div className="viewer-ro-colors">
          {colors.map((color) => (
            <span className="viewer-ro-color" key={color.label}>
              <span className="viewer-ro-swatch" style={{ backgroundColor: color.hex }} aria-hidden="true" />
              <span className="viewer-ro-color-copy">
                <small>{color.label}</small>
                <span>{colorName(color.hex)}</span>
              </span>
            </span>
          ))}
        </div>
      )}
      {!!tags.length && (
        <ul className="viewer-ro-tags" aria-label="細節標籤">
          {tags.map((tag) => <li key={tag}>{tag}</li>)}
        </ul>
      )}
      <div className="viewer-actions viewer-ro-actions">
        <button className="primary-button" type="button" onClick={() => onWear(item)}>
          <Sparkle size={15} weight="regular" aria-hidden="true" /> 在搭配頁穿上
        </button>
      </div>
    </div>
  );
}

/* 想買的單品存好之後還能改網址;不然貼錯只能刪掉重新去背。 */
function WishLinkEditor({ item, onSetUrl, disabled = false }) {
  const [text, setText] = useState(item.sourceUrl || "");
  const [saved, setSaved] = useState(false);
  // 換了一件就重設;同一件的網址被別台改了,只有這台沒動過輸入框時才跟上,打到一半的字不蓋掉
  const shownUrl = useRef(item.sourceUrl || "");
  useEffect(() => {
    shownUrl.current = item.sourceUrl || "";
    setText(item.sourceUrl || "");
  }, [item.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const before = shownUrl.current;
    const next = item.sourceUrl || "";
    if (before === next) return;
    shownUrl.current = next;
    setText((current) => (current === before ? next : current));
    setSaved(false);   // 換成別台存的網址了,「已存。」講的不是這個
  }, [item.sourceUrl]);
  useEffect(() => { setSaved(false); }, [item.id]);
  const problem = productUrlProblem(text);
  const changed = (findUrl(text) || "") !== (item.sourceUrl || "");

  const submit = async (event) => {
    event.preventDefault();
    if (problem || !changed) return;
    const url = findUrl(text);
    await onSetUrl(item.id, url);
    shownUrl.current = url || "";
    setText(url || "");
    setSaved(true);
  };

  return (
    <form className="add-field viewer-wish-link" onSubmit={submit}>
      <label htmlFor={`wish-url-${item.id}`}>商品網址</label>
      <div className="viewer-wish-link-row">
        <input
          id={`wish-url-${item.id}`}
          type="text"
          inputMode="url"
          autoComplete="off"
          value={text}
          onChange={(event) => { setText(event.target.value); setSaved(false); }}
          placeholder="https://"
          aria-invalid={Boolean(problem)}
        />
        <button className="secondary-button" type="submit" disabled={disabled || Boolean(problem) || !changed}>存網址</button>
      </div>
      {problem && <small className="add-field-error">{problem}</small>}
      {saved && !problem && <small role="status">已存。</small>}
    </form>
  );
}

const PIECE_ORDER = ["wholebody_up", "upperbody", "lowerbody", "shoes", "bag", "socks", "eyewear", "wrist"];
const PART_NAME = { upperbody: "上衣", lowerbody: "下身", wholebody_up: "外套", shoes: "鞋", bag: "包", socks: "襪子" };

/** 想買的那件:櫃裡有沒有很像的、跟已經有的能配出什麼。買之前看一眼用。 */
function WishCheck({ item, owned, onOpen, onWearOutfit }) {
  // 只在這件或衣櫃清單真的變了才重算:三套是亂數配的,同步重讀衣櫃就換一組,使用者正要按「穿這套」
  const keyOf = (piece) => [piece.id, piece.part, piece.name, piece.color, piece.secondaryColor, (piece.tags || []).join(",")].join(":");
  const ownedKey = owned.map(keyOf).join("|");   // 名稱、標籤、副色都會影響「很像」和配色,要算進來
  const itemKey = keyOf(item);
  const similar = useMemo(() => findSimilar(item, owned), [itemKey, ownedKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const plan = useMemo(() => wishOutfits(item, owned), [itemKey, ownedKey]);     // eslint-disable-line react-hooks/exhaustive-deps
  const kind = kindLabel(item);
  const fit = fitOf(item);
  const sameFit = fit ? similar.filter((piece) => fitOf(piece) === fit).length : 0;

  return (
    <div className="wish-check">
      <section aria-labelledby={`wish-similar-${item.id}`}>
        <h3 id={`wish-similar-${item.id}`}>櫃裡很像的</h3>
        {similar.length ? (
          <>
            <p>
              已經有 {similar.length} 件同色的{kind}
              {fit && (sameFit === similar.length ? `,都是${fit}` : sameFit ? `,其中 ${sameFit} 件也是${fit}` : `,版型看不出是不是${fit}`)}。
            </p>
            <div className="wish-thumbs">
              {similar.slice(0, 4).map((piece) => (
                <button key={piece.id} type="button" onClick={() => onOpen(piece.id)} aria-label={`查看${piece.name}`} title={piece.name}>
                  <OptimizedImage src={piece.thumbnail || piece.image} alt="" sizes="72px" breakpoints={[120, 180]} />
                </button>
              ))}
              {similar.length > 4 && <span className="wish-more">還有 {similar.length - 4} 件</span>}
            </div>
          </>
        ) : (
          <p>櫃裡沒有同色{fit ? `、同樣${fit}` : ""}的{kind},這件不重複。</p>
        )}
      </section>

      <section aria-labelledby={`wish-outfits-${item.id}`}>
        <h3 id={`wish-outfits-${item.id}`}>跟已經有的怎麼配</h3>
        {plan.error ? <p>{plan.error}</p> : (
          <>
            <p>
              {/* 中性色跟什麼都配,「26 件裡 26 件不打架」沒有資訊(審查 F58),換個說法 */}
              {plan.partner && plan.total > 0 && (isNeutral(item.color)
                ? `${colorName(item.color)}是中性色,跟櫃裡的${PART_NAME[plan.partner]}都配得起來。`
                : `${PART_NAME[plan.partner]} ${plan.total} 件裡,${plan.fit} 件跟它配色不打架。`)}
              照它適合的天氣(體感約 {plan.feelsLike}°)配了 {plan.outfits.length} 套:
            </p>
            <ul className="wish-outfits">
              {plan.outfits.map((outfit) => {
                const pieces = PIECE_ORDER.map((slot) => outfit[slot]).filter(Boolean);
                return (
                  <li key={pieces.map((piece) => piece.id).join("|")}>
                    <div className="wish-outfit-pieces" aria-label={pieces.map((piece) => piece.name).join("、")} role="img">
                      {pieces.map((piece) => (
                        <span key={piece.id} className={piece.id === item.id ? "is-wish" : undefined}>
                          <OptimizedImage src={piece.thumbnail || piece.image} alt="" sizes="56px" breakpoints={[120]} />
                        </span>
                      ))}
                    </div>
                    <button className="secondary-button" type="button" onClick={() => onWearOutfit(outfit)}>穿上看看</button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

const DRAFT_FIELDS = ["name", "part", "color", "secondaryColor", "tags", "price", "priceCurrency"];

function draftOf(item) {
  return {
    name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])],
    price: item.price ? String(item.price) : "", priceCurrency: item.priceCurrency || "TWD",
  };
}

/* 同一件換成新物件時(同步拉到別台的衣服、存檔):沒動過的欄位跟上新值,正在改的欄位保留。 */
function rebaseDraft(draft, before, after) {
  return Object.fromEntries(DRAFT_FIELDS.map((field) => [
    field,
    JSON.stringify(draft[field]) === JSON.stringify(before[field]) ? after[field] : draft[field],
  ]));
}

/** @param gone 這件在別台被刪掉或隱藏了:頁面留著(草稿還在、可以複製),但存檔、刪除、穿上這些動作都關掉 */
function ItemViewer({ item, gone = false, owned, onClose, onSave, onDelete, onWear, onBought, onSetUrl, onSetPrice, onOpen, onWearOutfit }) {
  const closeButtonRef = useRef(null);
  const dialogRef = useRef(null);
  // 焦點圈在單品頁裡、關掉後回到原本點的那格(審查 F46)。Esc 照下面自己的處理(先取消吸色、有沒存的先擋)
  useDialog(dialogRef, null, { initialFocus: closeButtonRef });
  const imageRef = useRef(null);
  const samplingCanvasRef = useRef(null);
  const shakeTimerRef = useRef(null);
  const [sampling, setSampling] = useState(null);
  const [sampleStatus, setSampleStatus] = useState("");
  const [palette, setPalette] = useState(item.palette || []);
  const [draft, setDraft] = useState(() => draftOf(item));
  const [shaking, setShaking] = useState(false);
  const [closeBlocked, setCloseBlocked] = useState(false);

  // item 換了:換成另一件就整個重設;同一件只是被 refresh 重建成新物件(同步拉到東西時每件都會),
  // 打到一半的欄位不能被清掉。在 render 裡直接調整,不用 effect,免得先拿舊草稿畫一次、isDirty 閃一下。
  const [draftBase, setDraftBase] = useState(item);
  if (draftBase !== item) {
    setDraftBase(item);
    if (draftBase.id !== item.id) {
      setSampling(null);
      setSampleStatus("");
      setPalette(item.palette || []);
      setDraft(draftOf(item));
    } else {
      setDraft((current) => rebaseDraft(current, draftOf(draftBase), draftOf(item)));
    }
  }

  const type = TYPE_MAP[item.part]?.singular || "衣物";
  const hasModeledImage = Boolean(item.modeledImage);
  const pieceRotation = useMemo(() => {
    const hash = [...item.id].reduce((total, character) => total + character.charCodeAt(0), 0);
    return `${(hash % 9) - 4}deg`;
  }, [item.id]);

  const isDirty = useMemo(() => {
    const normalizedTags = (tags) => tags.map((tag) => tag.trim()).filter(Boolean);
    return JSON.stringify({
      name: draft.name.trim(),
      part: draft.part,
      color: draft.color?.toLowerCase() || null,
      secondaryColor: draft.secondaryColor?.toLowerCase() || null,
      tags: normalizedTags(draft.tags),
      price: parsePrice(draft.price),
      priceCurrency: parsePrice(draft.price) ? draft.priceCurrency || "TWD" : null,
    }) !== JSON.stringify({
      name: (item.name || "").trim(),
      part: item.part,
      color: item.color?.toLowerCase() || null,
      secondaryColor: item.secondaryColor?.toLowerCase() || null,
      tags: normalizedTags(item.tags || []),
      price: item.price || null,
      priceCurrency: item.price ? item.priceCurrency || "TWD" : null,
    });
  }, [draft, item]);

  const nudgeUnsaved = useCallback(() => {
    setCloseBlocked(true);
    setShaking(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setShaking(true));
    });
    clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => setShaking(false), 420);
  }, []);

  const requestClose = useCallback(() => {
    if (isDirty && !gone) nudgeUnsaved();   // 已經不在的那件,存不了也不用擋
    else onClose();
  }, [isDirty, gone, nudgeUnsaved, onClose]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.isComposing || event.keyCode === 229) return;   // 選字中按 Esc 是取消選字
      if (event.key === "Escape") {
        if (sampling) setSampling(null);
        else requestClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("viewer-open");
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("viewer-open");
      clearTimeout(shakeTimerRef.current);
    };
  }, [requestClose, sampling]);

  // 焦點只在打開或換一件時放到關閉鈕;放在上面那個 effect 裡會跟著每次重新 render 搶焦點(同步重讀衣櫃時正在打字的欄位被搶走)
  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true });
  }, [item.id]);

  useEffect(() => {
    if (!isDirty) setCloseBlocked(false);
  }, [isDirty]);

  // 「已儲存。」只講剛剛那一次;存完又改了就拿掉,免得有沒存的修改時還寫著已儲存
  useEffect(() => {
    if (isDirty) setSampleStatus((status) => (status === "已儲存。" ? "" : status));
  }, [isDirty]);

  // 「在搭配頁穿上」「穿上看看」會離開這頁:有沒存的修改先擋下來,跟關閉一樣(審查抓到:改了分類沒存,直接穿上就丟了)
  const wearHere = () => {
    if (isDirty && !gone) { nudgeUnsaved(); return; }
    onWear(item);
  };

  const cancelEditing = () => {
    setDraft(draftOf(item));
    setSampling(null);
    setSampleStatus("");
    onClose();
  };

  // 有商品網址就能從網址找價錢:想買的、打開時還沒標價就自動找一次;按鈕可以重新找(特價、改價)。找到直接存
  const [priceStatus, setPriceStatus] = useState("");
  const canFetchPrice = Boolean(item.sourceUrl && !productUrlProblem(item.sourceUrl)) && !gone;
  const fetchPrice = useCallback(async (auto = false) => {
    setPriceStatus("從網址找價錢…");
    const price = await fetchPriceForUrl(item.sourceUrl).catch(() => null);
    if (!price) { setPriceStatus(auto ? "" : "這個網址讀不到價錢(可能擋住了),自己填"); return; }
    onSetPrice(item.id, price);
    setPriceStatus(`從網址讀到 ${formatPrice(price.amount, price.currency)}`);
  }, [item.id, item.sourceUrl, onSetPrice]);
  useEffect(() => {
    setPriceStatus("");
    if (item.wishlist && canFetchPrice && !item.price) fetchPrice(true);
  }, [item.id]);   // eslint-disable-line react-hooks/exhaustive-deps -- 只在打開或換一件時自動找

  const saveEditing = () => {
    const price = parsePrice(draft.price);
    onSave({
      ...item, ...draft, name: draft.name.trim(), tags: draft.tags.map((tag) => tag.trim()).filter(Boolean),
      price, priceCurrency: price ? draft.priceCurrency || "TWD" : null,
    });
    setSampling(null);
    setSampleStatus("已儲存。");
  };

  const handleImageLoad = (event) => {
    samplingCanvasRef.current = buildSamplingCanvas(event.currentTarget);
    const extracted = extractPalette(event.currentTarget);
    setPalette([...new Set([...(item.palette || []), ...extracted])].slice(0, 5));
  };

  const handleImageClick = (event) => {
    if (!sampling || !samplingCanvasRef.current) return;
    const color = sampleImageColor(event.currentTarget, samplingCanvasRef.current, event);
    if (!color) {
      setSampleStatus("那個位置是透明的——請直接點在衣服上。");
      return;
    }
    const targetField = sampling === "secondary" ? "secondaryColor" : "color";
    setDraft((current) => ({ ...current, [targetField]: color }));
    setPalette((current) => [color, ...current.filter((existing) => existing.toLowerCase() !== color.toLowerCase())].slice(0, 5));
    setSampleStatus(`已吸取這個${colorName(color)}。`);
    setSampling(null);
  };

  const garmentArtwork = (
    <div
      className={`viewer-art${hasModeledImage ? " viewer-art-floating" : ""}${sampling ? " sampling" : ""}`}
      style={hasModeledImage ? { "--piece-rotation": pieceRotation } : undefined}
    >
      <OptimizedImage
        ref={imageRef}
        src={item.image}
        alt={`選中的${type}`}
        sizes="(max-width: 520px) 40vw, 300px"
        breakpoints={[160, 240, 320, 480, 640]}
        priority
        onLoad={handleImageLoad}
        onClick={handleImageClick}
      />
      {sampling && <span className="sample-hint">點衣服吸色</span>}
    </div>
  );

  return (
    <div className="viewer-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
    <div className="viewer-entry">
    <aside ref={dialogRef} className={`viewer editing${hasModeledImage ? " has-modeled-image" : ""}${shaking ? " shake" : ""}`} role="dialog" aria-modal="true" aria-label="選中的衣物">
      <button className="viewer-icon-close" type="button" onClick={requestClose} aria-label="關閉" ref={closeButtonRef}>
        <X size={24} weight="light" aria-hidden="true" />
      </button>

      {hasModeledImage ? (
        <div className="modeled-hero">
          <OptimizedImage
            className="modeled-hero-photo"
            src={item.modeledImage}
            alt={`模特兒穿著${draft.name || type}`}
            sizes="(max-width: 860px) 100vw, 520px"
            breakpoints={[320, 480, 640, 800, 1040, 1280]}
            quality={82}
            priority
          />
          <div className="viewer-heading modeled-heading">
            <div>
              <h2>{draft.name || TYPE_MAP[draft.part]?.singular}</h2>
            </div>
          </div>
          {garmentArtwork}
        </div>
      ) : (
        <>
          <div className="viewer-heading">
            <div>
              <h2>{draft.name || TYPE_MAP[draft.part]?.singular}</h2>
            </div>
          </div>
          {garmentArtwork}
        </>
      )}

      <div className="viewer-details editing">
        {gone && (
          <p className="viewer-gone" role="status">
            這件已經在另一台被刪除或隱藏了。打到一半的字還在,要留的話先複製下來;關掉這頁就會消失。
          </p>
        )}
        {item.wishlist && (
          <div className="viewer-wish">
            <p>還沒買,不會出現在公開的衣櫃;開了同步的話,你的其他裝置也看得到。</p>
            <div className="viewer-wish-actions">
              {item.sourceUrl && !productUrlProblem(item.sourceUrl) && (
                <a className="secondary-button" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">回商品頁</a>
              )}
              <button className="secondary-button" type="button" onClick={wearHere} disabled={gone}>
                <Sparkle size={15} weight="regular" aria-hidden="true" /> 穿上看看
              </button>
              <button className="secondary-button" type="button" onClick={() => onBought(item.id)} disabled={gone}>已經買了</button>
            </div>
            <WishLinkEditor item={item} onSetUrl={onSetUrl} disabled={gone} />
            <WishCheck item={item} owned={owned} onOpen={onOpen} onWearOutfit={onWearOutfit} />
          </div>
        )}
        {canEditItem(item) ? (
          <>
            {/* 站主和自己加的衣服,單品頁原本只有編輯表單,要穿上得回搭配頁找(審查 F30) */}
            {!item.wishlist && (
              <div className="viewer-wear-row">
                <button className="secondary-button" type="button" onClick={wearHere} disabled={gone}>
                  <Sparkle size={15} weight="regular" aria-hidden="true" /> 在搭配頁穿上
                </button>
              </div>
            )}
            <ItemEditor
              draft={draft}
              setDraft={setDraft}
              palette={palette}
              sampling={sampling}
              setSampling={setSampling}
              sampleStatus={sampleStatus}
              priceStatus={priceStatus}
              onFetchPrice={canFetchPrice ? () => fetchPrice(false) : null}
            />

            {closeBlocked && <p className="unsaved-notice" role="status">離開這頁前請先儲存或取消變更。</p>}

            <div className="viewer-actions">
              <button className="delete-button" type="button" onClick={() => onDelete(item.id)} disabled={gone}>
                <Trash size={15} weight="regular" aria-hidden="true" /> 刪除
              </button>
              <span className="action-spacer" />
              <button className="secondary-button" type="button" onClick={cancelEditing}>取消</button>
              <button className="primary-button" type="button" onClick={saveEditing} disabled={gone}>
                <Check size={15} weight="bold" aria-hidden="true" /> 儲存
              </button>
            </div>
          </>
        ) : (
          <ReadOnlyDetails item={item} onWear={onWear} />
        )}
      </div>
    </aside>
    </div>
    </div>
  );
}

export function App() {
  const [items, setItems] = useState([]);
  const [activeType, setActiveType] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("landing");
  const [pendingOutfit, setPendingOutfit] = useState(null);   // 由入口頁的今日推薦帶進搭配頁
  const [closetChoice, setClosetChoice] = useState(null);     // 訪客手動選的衣櫃;null = 照有沒有自己的衣服決定
  const [syncOpen, setSyncOpen] = useState(false);
  const [pendingDaily, setPendingDaily] = useState(null);   // 入口今日推薦的天氣和理由,跟著那套帶進搭配頁(審查 F25)
  const [addRequest, setAddRequest] = useState(0);
  // 做完一件事的一行回饋:剛加入的、按了「已經買了」、剛加入同步(審查 F18、F55、F63)
  const [notice, setNotice] = useState(() => {
    try {
      const joined = sessionStorage.getItem("open-wardrobe-joined");
      if (joined === null) return "";
      sessionStorage.removeItem("open-wardrobe-joined");
      return Number(joined) ? `加入同步了,從另一台拿到 ${joined} 件。` : "加入同步了。";
    } catch { return ""; }
  });
  const noticeTimer = useRef(null);
  const say = useCallback((text) => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 6000);
  }, []);
  useEffect(() => {
    if (notice) noticeTimer.current = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(noticeTimer.current);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- 只為了一打開就有的那句(加入同步)排一次
  // 同步出狀況(停掉、上次失敗)時入口「同步」旁亮一個點;不打開面板也看得到(審查 F11、F40)
  const [syncAlert, setSyncAlert] = useState(() => CAN_EDIT && Boolean(syncNotice() || lastSyncError()));
  const sheetRef = useRef(null);
  const closeSync = useCallback(() => { setSyncOpen(false); setSyncAlert(CAN_EDIT && Boolean(syncNotice() || lastSyncError())); }, []);
  useDialog(sheetRef, closeSync, { active: syncOpen });

  // 衣櫃 = 離線流程匯入的(data/library.json)+ 使用者自己在網頁加的(IndexedDB)
  // 同時有兩次 refresh 在跑時(同步拉到東西、剛存好),只採用最後發出的那次;edits 和隱藏名單在 await 之後才讀,
  // 不然中間剛存的修改會被一份過期的值蓋回去,單品頁的草稿再跟著那份舊值走,下次存檔就把舊名字寫回去
  const refreshSeq = useRef(0);      // 發出過幾次
  const appliedSeq = useRef(0);      // 畫面上是第幾次的結果;比它舊的回來就丟掉
  // 上一次成功讀到的站主衣櫃、本機衣服:這次抓不到(網路斷、IndexedDB 暫時打不開)就沿用,不讓畫面上的衣服消失,
  // 人台和收藏也不會因此把它們當成被刪掉而拿掉
  const servedRef = useRef(null);
  const localRef = useRef(null);
  const servedSeq = useRef(0);
  const localSeq = useRef(0);
  const appliedComplete = useRef(false);   // 畫面上那份兩邊都有讀到
  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    let failed = null;
    const [served, local] = await Promise.all([
      fetch("/data/wardrobe.json", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error("衣櫃載入失敗。"))))
        .catch((cause) => { failed = cause; return null; }),
      loadLocalItems(),
    ]);
    // 備用的上一份只收比較新的結果:較舊的 refresh 晚回來,不能把它換回刪除前的清單(之後讀不到時刪掉的會冒回來)
    if (served && seq > servedSeq.current) { servedRef.current = served; servedSeq.current = seq; }
    if (local && seq > localSeq.current) { localRef.current = local; localSeq.current = seq; }
    if (seq <= appliedSeq.current) {
      // 比較舊的結果被丟掉;但畫面上那份是靠沿用撐的、這份卻有讀到,就再讀一次補上
      if (served && local && !appliedComplete.current) refresh();
      return;
    }
    appliedSeq.current = seq;
    appliedComplete.current = Boolean(served && local);
    setError(!served && !servedRef.current ? (failed?.message || "衣櫃載入失敗。") : "");
    const edits = readEdits();
    const deleted = readDeletedItems();
    const servedList = served || servedRef.current || [];
    const merged = [...(CAN_EDIT ? servedList : demoSample(servedList)), ...(local || localRef.current || [])].filter((item) => !deleted.has(item.id));
    setItems(merged.map((item) => ({ ...item, ...(edits[item.id] || {}) })));
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // 同步:打開時、切回來時拉一次;離開(切到別的 app)前有改過就推;衣服一改,5 秒後推。
  // 拿到別台的東西不整頁重新整理:衣服、編輯、隱藏由 refresh 重讀;收藏、微調、穿著紀錄由搭配頁自己聽同一個事件重讀。
  // 這樣新增視窗、單品頁、打到一半的指令都不會被清掉。
  useEffect(() => {
    if (!CAN_EDIT) return undefined;
    const onSynced = (event) => {
      const { pendingDeletes } = event.detail;
      // 背景時跳 confirm,瀏覽器可能不等人就回 false(會把剛刪的那件拿回來):先不問,回到前景的同步會再偵測一次
      if (pendingDeletes && document.visibilityState === "hidden") return;
      if (pendingDeletes) {
        // 這台一次少了好幾件:問清楚是真的刪了,還是資料被瀏覽器清掉了。這次打開網站後自己按刪除的不算在裡面(sync.js 的 deliberate)
        const push = window.confirm(`這台少了 ${pendingDeletes} 件自己加的衣服,不是剛剛在這裡按刪除的。可能是瀏覽器把資料清掉了,也可能是之前刪的還沒同步。\n\n按「確定」:其他裝置和雲端也一起刪掉。\n按「取消」:從雲端把這 ${pendingDeletes} 件拿回來。`);
        setTimeout(() => syncNow({ deletes: push ? "push" : "restore" }), 0);   // 等這一輪同步收尾
        return;
      }
      // 只有衣服本身(拉到別台的衣服)、名稱顏色(edits)、隱藏(deleted)變了才重讀衣櫃。收藏、微調、穿著紀錄
      // 由搭配頁自己重讀;要是也重讀衣櫃,入口的圓環和今日推薦會在使用者看的時候整個重洗。
      // 單品頁開著時也要重讀:別台改的名稱、顏色不跟上的話(rebaseDraft),這台一存就用舊值蓋掉別台的修改。
      // 同步半途失敗時也重讀一次:可能已經寫進一部分衣服。
      const keys = event.detail.keys || [];
      if (event.detail.pulled || keys.includes(STORAGE_KEY) || keys.includes(DELETED_STORAGE_KEY) || (event.detail.error && !event.detail.stopped)) refresh();
      setSyncAlert(Boolean(syncNotice() || lastSyncError()));
    };
    // 網路恢復就補推:斷線時改的東西不用等下次切 app(審查 F40)
    const onOnline = () => { if (syncCode()) syncNow(); };
    const onVisibility = () => {
      if (!syncCode()) return;
      if (document.visibilityState === "visible") syncNow();
      else hasLocalChanges().then((dirty) => { if (dirty) syncNow(); }).catch(() => {});
    };
    window.addEventListener("wardrobe-synced", onSynced);
    window.addEventListener("wardrobe-local-change", scheduleSync);
    document.addEventListener("visibilitychange", onVisibility);
    // iOS 從主畫面的 app 切回來,舊版有時不發 visibilitychange;從快取還原頁面時再補一次
    const onPageShow = (event) => { if (event.persisted && syncCode()) syncNow(); };
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    if (syncCode()) syncNow();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("wardrobe-synced", onSynced);
      window.removeEventListener("wardrobe-local-change", scheduleSync);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [refresh]);

  // 單品頁開著時那件被別台刪掉或隱藏:不直接關掉(打到一半的字會跟著消失),留著最後看到的那份、標示已經不在
  const lastSelectedRef = useRef(null);
  const liveSelected = items.find((item) => item.id === selectedId) || null;
  if (liveSelected) lastSelectedRef.current = liveSelected;
  const selectedItem = liveSelected || (selectedId && lastSelectedRef.current?.id === selectedId ? lastSelectedRef.current : null);
  const selectedGone = Boolean(selectedItem && !liveSelected);

  // 訪客的衣櫃跟站主的分開:自己加的是「我的衣櫃」,站主那批的一小份樣本是「示範衣櫃」,推薦只在同一個衣櫃裡配。
  // 站主(?edit)照舊看全部;?public 只看示範。訪客一進來就是自己的衣櫃(還沒有衣服就是歡迎畫面),示範要自己點
  // (2026-10-05 本人:給朋友試用,入口不要都是站主的衣服;舊版沒有衣服的訪客直接落在示範衣櫃)。
  const mineCount = useMemo(() => items.filter((item) => item.isLocal && !item.wishlist).length, [items]);
  const hasMine = useMemo(() => items.some((item) => item.isLocal), [items]);
  const closet = CAN_EDIT ? "all" : !CAN_ADD ? "demo" : closetChoice || "mine";
  const closetItems = useMemo(
    () => (closet === "all" ? items : items.filter((item) => Boolean(item.isLocal) === (closet === "mine"))),
    [items, closet],
  );
  const demoItems = useMemo(() => items.filter((item) => !item.isLocal), [items]);   // 歡迎畫面的示範穿搭用
  const demoCount = demoItems.length;

  // 自己加、按了「已經買了」的衣服沒有保暖度,推薦引擎會整件跳過;從品名補一個。想買的不補,免得被當成已經有的拿去配
  const wearItems = useMemo(() => closetItems.map((item) => !item.wishlist && item.warmth === undefined ? { ...item, warmth: guessWarmth(item) } : item), [closetItems]);
  const ownedItems = useMemo(() => wearItems.filter((item) => !item.wishlist), [wearItems]);
  const wishCount = closetItems.length - ownedItems.length;

  const visibleItems = useMemo(() => {
    const filtered = activeType === "all" ? ownedItems
      : activeType === "wishlist" ? closetItems.filter((item) => item.wishlist)
      : closetItems.filter((item) => item.part === activeType);
    return [...filtered].sort((a, b) => {
      // 自己加的排最前面,越新越前面;站主那批沒有建立時間,接在後面照原本的類型順序
      if (a.createdAt || b.createdAt) {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return b.createdAt.localeCompare(a.createdAt);
      }
      if (activeType === "all" || activeType === "wishlist") {
        const typeDifference = (TYPE_ORDER[a.part] ?? 99) - (TYPE_ORDER[b.part] ?? 99);
        if (typeDifference) return typeDifference;
      }
      return a.id.localeCompare(b.id);
    });
  }, [activeType, closetItems, ownedItems]);

  // 帶進搭配頁的那套只用一次:離開搭配頁就清掉,不然回來時又被套回入口那套,蓋掉後來自己換的
  useEffect(() => {
    if (view !== "styling") { setPendingOutfit(null); setPendingDaily(null); }
  }, [view]);

  // 帶一套進搭配頁:先記成「身上這套」,進去後手動重新整理也穿得回來。daily = 入口今日推薦的天氣和理由
  const wearOutfit = (outfit, daily = null) => {
    rememberWearing(outfit, closet);
    setPendingOutfit(outfit);
    setPendingDaily(daily);
  };

  // 訪客的衣服沒有同步(同步只給站主),全靠這個瀏覽器存著:加了衣服之後提醒一次留備份
  const [keepHintOff, setKeepHintOff] = useState(() => { try { return localStorage.getItem("open-wardrobe-keep-hint-v1") === "1"; } catch { return true; } });
  const keepHint = !CAN_EDIT && CAN_ADD && hasMine && !keepHintOff;
  const dismissKeepHint = () => { setKeepHintOff(true); try { localStorage.setItem("open-wardrobe-keep-hint-v1", "1"); } catch { /* 存不了就這次關掉 */ } };

  // 訪客自己的衣櫃還空著、人在入口:歡迎畫面。這時把件數和衣櫃切換收起來(都是 0,示範從歡迎畫面的按鈕進去)
  const showWelcome = !error && !loading && !ownedItems.length && !wishCount && view === "landing" && closet === "mine";

  // 「新增第一件」「去新增」:換到衣櫃(新增鈕在那裡的標題列),叫新增自己打開
  const requestAdd = () => {
    setView("closet");
    setAddRequest((count) => count + 1);
  };

  const chooseType = (typeId) => {
    setActiveType(typeId);
    setSelectedId(null);
  };

  // 存進想買的、或從空狀態點過來:切到衣櫃的「想買的」。「全部」只列已經有的,不切過去會以為沒存成功。
  const showWishlist = () => {
    setView("closet");
    setActiveType("wishlist");
    setSelectedId(null);
  };

  // 亮著的分類一律露出來:手機上「想買的」在分類列最右邊要橫滑才看得到,
  // 停在它上面卻看不到哪顆亮著,會以為衣服不見了(切去搭配再回來時分類列也會捲回最左邊)。
  // 只動分類列自己的橫向捲動;不用 scrollIntoView,它會連整頁一起捲,在格子中間刪一件就被拉回頂端
  const categoryNavRef = useRef(null);
  useEffect(() => {
    const nav = categoryNavRef.current;
    const button = nav?.querySelector("button.active");
    if (view !== "closet" || !button) return;
    const left = button.offsetLeft - nav.offsetLeft;
    if (left < nav.scrollLeft) nav.scrollLeft = left - 16;
    else if (left + button.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = left + button.offsetWidth - nav.clientWidth + 16;
  }, [view, activeType, wishCount]);

  // 想買的全買了或刪光,那顆分類就消失了;停在上面會一片空白、沒有任何一顆亮著,退回「全部」
  useEffect(() => {
    if (!loading && activeType === "wishlist" && !wishCount) setActiveType("all");
  }, [loading, activeType, wishCount]);

  const chooseCloset = (next) => {
    setClosetChoice(next);
    setActiveType("all");
    setSelectedId(null);
    setPendingOutfit(null);
  };

  // 訪客才有的切換;站主看全部、?public 只看示範,都不需要
  const closetSwitch = closet !== "all" && CAN_ADD && (
    <nav className="view-nav closet-switch" aria-label="切換衣櫃">
      <button type="button" className={closet === "mine" ? "active" : ""} aria-pressed={closet === "mine"} onClick={() => chooseCloset("mine")}>
        我的衣櫃 <small>{mineCount}</small>
      </button>
      <button type="button" className={closet === "demo" ? "active" : ""} aria-pressed={closet === "demo"} onClick={() => chooseCloset("demo")}>
        示範衣櫃 <small>{demoCount}</small>
      </button>
    </nav>
  );

  const saveItem = (updatedItem) => {
    setItems((current) => current.map((item) => item.id === updatedItem.id ? updatedItem : item));
    // 原本的樣子 = 還沒套任何編輯的那份(站主的從 wardrobe.json、自己加的從 IndexedDB)
    const original = [...(servedRef.current || []), ...(localRef.current || [])].find((item) => item.id === updatedItem.id);
    persistEdit(updatedItem, original);
  };

  // 商品網址留著:之後再貼同一件的連結,才認得出已經有了(審查 F31)。按完講一聲,不然畫面只是安靜地變成編輯表單(F55)
  // 價錢從網址找到時直接存(跟手動編輯走同一條:edits,開了同步會傳到每一台)。用最新的那份衣服,不用畫面當下那份
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const setItemPrice = useCallback((id, price) => {
    const target = itemsRef.current.find((item) => item.id === id);
    if (!target || !price?.amount) return;
    const updated = { ...target, price: price.amount, priceCurrency: price.currency || "TWD" };
    setItems((current) => current.map((item) => (item.id === id ? updated : item)));
    const original = [...(servedRef.current || []), ...(localRef.current || [])].find((item) => item.id === id);
    persistEdit(updated, original);
  }, []);

  // 想買的、有網址、還沒標價的:背景一件一件去找(這次打開網站每件只試一次,讀不到就留給人自己填)
  const priceTried = useRef(new Set());
  useEffect(() => {
    if (!CAN_ADD || loading) return undefined;
    const todo = items.filter((item) => item.wishlist && item.sourceUrl && !item.price && !priceTried.current.has(item.id));
    if (!todo.length) return undefined;
    let cancelled = false;
    (async () => {
      for (const item of todo.slice(0, 8)) {
        if (cancelled) return;
        priceTried.current.add(item.id);
        const price = await fetchPriceForUrl(item.sourceUrl).catch(() => null);
        if (price) setItemPrice(item.id, price);   // 中途衣櫃重讀過也照存(用最新的那份);只是不再開始找下一件
      }
    })();
    return () => { cancelled = true; };
  }, [items, loading, setItemPrice]);

  const markBought = async (id) => {
    const target = items.find((item) => item.id === id);
    await updateLocalItem(id, { wishlist: false });
    await refresh();
    say(`「${target?.name || "這件"}」放進衣櫃了。`);
  };

  const setWishUrl = async (id, sourceUrl) => {
    await updateLocalItem(id, { sourceUrl });
    await refresh();
  };

  const deleteItem = async (id) => {
    // 刪除一律先問(格子上的垃圾桶和單品頁的「刪除」都走這裡);開了同步,刪了會傳到每一台
    const target = items.find((item) => item.id === id);
    const note = syncCode() ? "\n開了同步,其他裝置也會一起刪掉。" : "";
    if (!window.confirm(`確定刪除「${target?.name || "這件"}」?${note}`)) return;
    if (id.startsWith("local-")) {
      noteDeliberateDelete(id);   // 同步不用再問一次「這台少了幾件」
      // 自己加的:直接從 IndexedDB 移除,不需要記到「已刪除」名單
      await deleteLocalItem(id);
      appliedSeq.current = ++refreshSeq.current;   // 還在跑的 refresh 讀的是刪除前的本機清單,作廢,免得那件又冒出來
      localSeq.current = appliedSeq.current;        // 它也不能拿來當備用清單
      refresh();                                     // 再補一次讀刪除後的:作廢的那次如果帶著剛同步到的新衣服,不補就看不到
      // 訪客刪掉自己唯一一件時留在「我的衣櫃」(空的那個),不要自動跳去示範衣櫃,像站主的衣服跑進來
      if (!CAN_EDIT) setClosetChoice("mine");
      setItems((current) => current.filter((item) => item.id !== id));
      setSelectedId(null);
      return;
    }
    if (id.startsWith("import-")) {
      // 本機有 dev server 時真的刪檔;線上唯讀版刪不動,就只記在瀏覽器端隱藏
      try {
        await fetch(`/api/import/wardrobe/${id}`, { method: "DELETE" });
      } catch {
        /* 線上唯讀版沒有這個端點,靠下面的 persistDeletedItem 隱藏即可 */
      }
    }
    setItems((current) => current.filter((item) => item.id !== id));
    removePersistedEdit(id);
    persistDeletedItem(id);
    setSelectedId(null);
  };

  return (
    <div className={`app-shell${selectedItem ? " has-selection" : ""}`}>
      <main className="gallery-pane">
        {view === "landing" && !loading && !!ownedItems.length && (
          <LandingRing
            title={closet === "demo" && CAN_ADD ? "示範衣櫃" : "我的衣櫃"}
            note={closet === "demo" && CAN_ADD ? (
              <>
                <span className="landing-pitch">把自己的衣服<span className="landing-pitch-more">拍照、或貼 GU、UNIQLO 的連結</span>放進來,每天照台中的天氣配一套。<span className="landing-pitch-more">下面是從站主衣櫃挑出來的幾件,先拿來示範。</span></span>
                <button type="button" className="landing-make" onClick={() => { chooseCloset("mine"); if (mineCount) setView("closet"); else requestAdd(); }}>
                  {mineCount ? "回我的衣櫃" : "建立我的衣櫃"}
                </button>
              </>
            ) : null}
            items={ownedItems}
            onSync={CAN_ADD ? () => setSyncOpen(true) : null}
            syncAlert={syncAlert}
            onOpen={setSelectedId}
            onEnter={setView}
            onAdd={CAN_ADD ? requestAdd : null}
            onWearOutfit={(outfit, daily) => { wearOutfit(outfit, daily); setView("styling"); }}
          />
        )}
        {view === "landing" && loading && <p className="status">衣櫃載入中</p>}

        {/* 同步放在入口:手機第一眼就找得到。?public 不出現 */}
        {syncOpen && (
          <div className="add-overlay" role="dialog" aria-modal="true" aria-label="同步" ref={sheetRef} onClick={(event) => { if (event.target === event.currentTarget) closeSync(); }}>
            <div className="sync-sheet">
              <button type="button" className="add-close" onClick={closeSync} aria-label="關閉">
                <X size={20} weight="light" aria-hidden="true" />
              </button>
              <h2>同步</h2>
              <SyncPanel canStart={CAN_EDIT} />
            </div>
          </div>
        )}
        {syncOpen && (
          <ScrollRail target={sheetRef} watch={syncOpen} />
        )}

        {(view !== "landing" || (!loading && !ownedItems.length)) && (
        // 歡迎畫面時頂端只留同步那些:件數、新增、三個分頁都收起來(衣櫃、搭配點進去是空的;新增就是歡迎畫面那顆大按鈕)
        <header className={showWelcome ? "gallery-header is-quiet" : "gallery-header"}>
          <h1 className="visually-hidden">{view === "styling" ? "搭配" : "衣櫃"}</h1>
          <div className="gallery-meta-row">
            <p className="piece-count" hidden={showWelcome}>{ownedItems.length} 件單品{wishCount > 0 && <span className="piece-count-wish"> · 想買 {wishCount}</span>}</p>
            <div className="header-tools">
              {CAN_ADD && (
                <AddGarment
                  existing={closet === "all" ? items : items.filter((item) => item.isLocal)}
                  openRequest={addRequest}
                  onOpenHandled={() => setAddRequest(0)}
                  onAdded={async (wishlist, name) => {
                    if (!CAN_EDIT) { setClosetChoice("mine"); setPendingOutfit(null); }   // 換到我的衣櫃:示範衣櫃帶進來的那套不要跟過去
                    await refresh();
                    if (wishlist) showWishlist();
                    say(wishlist ? `「${name}」放進想買的了。` : `「${name}」加進衣櫃了。`);
                  }}
                />
              )}
              <nav className="view-nav" aria-label="切換頁面" hidden={showWelcome}>
                <button type="button" onClick={() => setView("landing")}>入口</button>
                <button type="button" className={view === "closet" ? "active" : ""} aria-current={view === "closet" ? "page" : undefined} onClick={() => setView("closet")}>衣櫃</button>
                <button type="button" className={view === "styling" ? "active" : ""} aria-current={view === "styling" ? "page" : undefined} onClick={() => setView("styling")}>搭配</button>
              </nav>
            </div>
          </div>
          {!showWelcome && closetSwitch}
          {view === "closet" && (
            <nav className="category-nav" aria-label="依類型篩選衣櫃" ref={categoryNavRef}>
              {(wishCount ? [...TYPES, { id: "wishlist", label: `想買的 ${wishCount}` }] : TYPES).map((type) => (
                <button
                  key={type.id}
                  type="button"
                  className={activeType === type.id ? "active" : ""}
                  onClick={() => chooseType(type.id)}
                  aria-pressed={activeType === type.id}
                >
                  {type.label}
                </button>
              ))}
            </nav>
          )}
        </header>
        )}

        {keepHint && view === "closet" && (
          <p className="keep-hint" role="note">
            你的衣服只存在這個瀏覽器裡,清除瀏覽資料(或 iPhone 久沒打開這個網站)就會不見。到「搭配」頁最下面按「匯出備份」留一份。
            <button type="button" onClick={dismissKeepHint}>知道了</button>
          </p>
        )}
        {/* 浮在畫面上方:入口頁是滿版的、單品頁在手機上蓋滿整個畫面,放在頁面裡會看不到(審查抓到) */}
        {notice && <p className="app-notice" role="status">{notice}</p>}
        {error && <p className="status error">{error}</p>}
        {view !== "landing" && !error && loading && <p className="status">衣櫃載入中</p>}
        {/* 只看「想買的」分頁時它自己會列出來;入口、搭配、其他分頁仍要講,不然空白一片 */}
        {/* 訪客自己的衣櫃還空著:入口給一個歡迎畫面,不是直接攤開站主的衣服 */}
        {showWelcome && (
          <Welcome
            demoItems={demoItems}
            onAdd={requestAdd}
            onDemo={() => chooseCloset("demo")}
            onSync={() => setSyncOpen(true)}
            onImportFile={async (file) => {
              const message = await importBackupFile(file, Boolean(syncCode()));
              if (message) say(message);
            }}
          />
        )}
        {!error && !loading && !ownedItems.length && !(view === "closet" && activeType === "wishlist" && wishCount) && !showWelcome && (
          wishCount ? (
            <p className="status empty">
              你加的 {wishCount} 件在「想買的」裡。還沒買的不算進衣櫃,買了以後點開那件按「已經買了」。
              <br />
              <button type="button" className="secondary-button" onClick={showWishlist}>看想買的</button>
            </p>
          ) : (
            <p className="status empty">
              {/* 不講方位:iPhone 上新增在左上,桌機在右上(審查 F53)。直接給一顆按鈕 */}
              {CAN_ADD ? "你的衣櫃還是空的。貼 GU、UNIQLO 的商品連結,或拍一張平放的衣服。" : "這個衣櫃還沒有單品。"}
              {CAN_ADD && (
                <>
                  <br />
                  <button type="button" className="secondary-button" onClick={requestAdd}>新增第一件</button>
                  {closet === "mine" && <button type="button" className="secondary-button welcome-demo" onClick={() => chooseCloset("demo")}>先看看示範</button>}
                </>
              )}
            </p>
          )
        )}

        {view === "styling" && !loading && !!ownedItems.length && (
          <OutfitStudio key={closet} closet={closet} items={wearItems} initialOutfit={pendingOutfit} initialDaily={pendingDaily} onOpenItem={setSelectedId} />
        )}

        {/* 示範衣櫃的眼鏡、手錶這幾類是 0 件,點下去整頁空白(審查 F52) */}
        {view === "closet" && !!ownedItems.length && !visibleItems.length && activeType !== "wishlist" && (
          <p className="status empty">這一類還沒有單品。</p>
        )}
        {view === "closet" && !!closetItems.length && (
          <section className="gallery-grid" aria-label={`${activeType === "wishlist" ? "想買的" : TYPE_MAP[activeType]?.label || "全部"}衣物`}>
            {visibleItems.map((item) => (
              <GalleryItem
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                onOpen={setSelectedId}
                onDelete={deleteItem}
              />
            ))}
          </section>
        )}
      </main>

      {selectedItem && (
        <ItemViewer
          item={selectedItem}
          gone={selectedGone}
          owned={ownedItems}
          onOpen={setSelectedId}
          onWearOutfit={(outfit) => { wearOutfit(outfit); setSelectedId(null); setView("styling"); }}
          onClose={() => setSelectedId(null)}
          onSave={saveItem}
          onDelete={deleteItem}
          onWear={(item) => { wearOutfit({ [item.part]: item }); setSelectedId(null); setView("styling"); }}
          onBought={markBought}
          onSetUrl={setWishUrl}
          onSetPrice={setItemPrice}
        />
      )}
    </div>
  );
}
