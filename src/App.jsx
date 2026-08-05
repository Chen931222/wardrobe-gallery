// [本 fork 修改] 上游 tandpfun/wardrobe 既有檔案。本 fork 的改動:介面全繁中化並擴充分類,新增入口環/衣櫃/搭配三頁切換、IndexedDB 本機衣物合併與格子刪除鈕。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Trash, X } from "@phosphor-icons/react";
import { OptimizedImage } from "./OptimizedImage.jsx";
import { OutfitStudio } from "./OutfitStudio.jsx";
import { LandingRing } from "./LandingRing.jsx";
import { AddGarment } from "./AddGarment.jsx";
import { deleteLocalItem, loadLocalItems } from "./localWardrobe.js";

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
const TYPE_ORDER = Object.fromEntries(TYPES.slice(1).map((type, index) => [type.id, index]));


function readEdits() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}


function persistEdit(item) {
  const edits = readEdits();
  edits[item.id] = {
    name: item.name || "",
    part: item.part,
    color: item.color || null,
    secondaryColor: item.secondaryColor || null,
    tags: item.tags || [],
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
}

function removePersistedEdit(id) {
  const edits = readEdits();
  delete edits[id];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
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
        aria-label={`查看${label}`}
        aria-pressed={selected}
        data-testid={`wardrobe-item-${item.id}`}
      >
        <OptimizedImage
          src={item.thumbnail || item.image}
          alt=""
          sizes="(max-width: 520px) calc(50vw - 16px), (max-width: 860px) calc(33vw - 18px), 180px"
          breakpoints={[120, 180, 240, 320, 480]}
        />
      </button>
      <button
        className="gallery-delete"
        type="button"
        onClick={() => { if (confirm(`確定刪除「${label}」?`)) onDelete(item.id); }}
        aria-label={`刪除${label}`}
      >
        <Trash size={14} weight="regular" aria-hidden="true" />
      </button>
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
        <span className="selected-color-copy">
          <small>目前</small>
          <strong>{value || "自訂"}</strong>
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
            aria-label={`把 ${color} 設為${label}`}
            title={color}
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

function ItemEditor({ draft, setDraft, palette, sampling, setSampling, sampleStatus }) {
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

function ItemViewer({ item, onClose, onSave, onDelete }) {
  const closeButtonRef = useRef(null);
  const imageRef = useRef(null);
  const samplingCanvasRef = useRef(null);
  const shakeTimerRef = useRef(null);
  const [sampling, setSampling] = useState(null);
  const [sampleStatus, setSampleStatus] = useState("");
  const [palette, setPalette] = useState(item.palette || []);
  const [draft, setDraft] = useState({ name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])] });
  const [shaking, setShaking] = useState(false);
  const [closeBlocked, setCloseBlocked] = useState(false);
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
    }) !== JSON.stringify({
      name: (item.name || "").trim(),
      part: item.part,
      color: item.color?.toLowerCase() || null,
      secondaryColor: item.secondaryColor?.toLowerCase() || null,
      tags: normalizedTags(item.tags || []),
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
    if (isDirty) nudgeUnsaved();
    else onClose();
  }, [isDirty, nudgeUnsaved, onClose]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        if (sampling) setSampling(null);
        else requestClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("viewer-open");
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("viewer-open");
      clearTimeout(shakeTimerRef.current);
    };
  }, [requestClose, sampling]);

  useEffect(() => {
    if (!isDirty) setCloseBlocked(false);
  }, [isDirty]);

  useEffect(() => {
    setSampling(null);
    setSampleStatus("");
    setPalette(item.palette || []);
    setDraft({ name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])] });
  }, [item]);

  const cancelEditing = () => {
    setDraft({ name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])] });
    setSampling(null);
    setSampleStatus("");
    onClose();
  };

  const saveEditing = () => {
    onSave({ ...item, ...draft, name: draft.name.trim(), tags: draft.tags.map((tag) => tag.trim()).filter(Boolean) });
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
    setSampleStatus(`已吸取 ${color}。`);
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
    <aside className={`viewer editing${hasModeledImage ? " has-modeled-image" : ""}${shaking ? " shake" : ""}`} role="dialog" aria-modal="true" aria-label="選中的衣物">
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
        <ItemEditor
          draft={draft}
          setDraft={setDraft}
          palette={palette}
          sampling={sampling}
          setSampling={setSampling}
          sampleStatus={sampleStatus}
        />

        {closeBlocked && <p className="unsaved-notice" role="status">關閉前請先儲存或取消變更。</p>}

        <div className="viewer-actions">
          <button className="delete-button" type="button" onClick={() => onDelete(item.id)}>
            <Trash size={15} weight="regular" aria-hidden="true" /> 刪除
          </button>
          <span className="action-spacer" />
          <button className="secondary-button" type="button" onClick={cancelEditing}>取消</button>
          <button className="primary-button" type="button" onClick={saveEditing}>
            <Check size={15} weight="bold" aria-hidden="true" /> 儲存
          </button>
        </div>
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

  // 衣櫃 = 離線流程匯入的(data/library.json)+ 使用者自己在網頁加的(IndexedDB)
  const refresh = useCallback(async () => {
    const edits = readEdits();
    const deleted = readDeletedItems();
    const [served, local] = await Promise.all([
      fetch("/api/import/wardrobe", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error("衣櫃載入失敗。"))))
        .catch((cause) => { setError(cause.message); return []; }),
      loadLocalItems(),
    ]);
    const merged = [...served, ...local].filter((item) => !deleted.has(item.id));
    setItems(merged.map((item) => ({ ...item, ...(edits[item.id] || {}) })));
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const selectedItem = items.find((item) => item.id === selectedId) || null;

  const visibleItems = useMemo(() => {
    const filtered = activeType === "all" ? items : items.filter((item) => item.part === activeType);
    return [...filtered].sort((a, b) => {
      if (activeType === "all") {
        const typeDifference = (TYPE_ORDER[a.part] ?? 99) - (TYPE_ORDER[b.part] ?? 99);
        if (typeDifference) return typeDifference;
      }
      return a.id.localeCompare(b.id);
    });
  }, [activeType, items]);

  const chooseType = (typeId) => {
    setActiveType(typeId);
    setSelectedId(null);
  };

  const saveItem = (updatedItem) => {
    setItems((current) => current.map((item) => item.id === updatedItem.id ? updatedItem : item));
    persistEdit(updatedItem);
  };

  const deleteItem = async (id) => {
    if (id.startsWith("local-")) {
      // 自己加的:直接從 IndexedDB 移除,不需要記到「已刪除」名單
      await deleteLocalItem(id);
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
        {view === "landing" && !loading && !!items.length && (
          <LandingRing
            items={items}
            onOpen={setSelectedId}
            onEnter={setView}
            onWearOutfit={(outfit) => { setPendingOutfit(outfit); setView("styling"); }}
          />
        )}
        {view === "landing" && loading && <p className="status">衣櫃載入中</p>}

        {view !== "landing" && (
        <header className="gallery-header">
          <div className="gallery-meta-row">
            <p className="piece-count">{items.length} 件單品</p>
            <div className="header-tools">
              <AddGarment onAdded={refresh} />
              <nav className="view-nav" aria-label="切換頁面">
                <button type="button" onClick={() => setView("landing")}>入口</button>
                <button type="button" className={view === "closet" ? "active" : ""} onClick={() => setView("closet")}>衣櫃</button>
                <button type="button" className={view === "styling" ? "active" : ""} onClick={() => setView("styling")}>搭配</button>
              </nav>
            </div>
          </div>
          {view === "closet" && (
            <nav className="category-nav" aria-label="依類型篩選衣櫃">
              {TYPES.map((type) => (
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

        {error && <p className="status error">{error}</p>}
        {view !== "landing" && !error && loading && <p className="status">衣櫃載入中</p>}
        {!error && !loading && !items.length && <p className="status empty">拖曳、貼上或新增照片,匯入你的第一件衣服。</p>}

        {view === "styling" && !loading && !!items.length && (
          <OutfitStudio items={items} initialOutfit={pendingOutfit} />
        )}

        {view === "closet" && !!items.length && (
          <section className="gallery-grid" aria-label={`${TYPE_MAP[activeType]?.label || "全部"}衣物`}>
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

      {selectedItem && <ItemViewer item={selectedItem} onClose={() => setSelectedId(null)} onSave={saveItem} onDelete={deleteItem} />}
    </div>
  );
}
