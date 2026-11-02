// [本 fork 新增] 一次加好幾件(2026-11-02 本人:「買了幾件衣服也懶得放進去」,懶的是拍完之後一件件加)。
// 新增視窗「拍照或選照片」一次選 2 張以上就走這裡:每張整張去背、照形狀猜分類、照顏色取名,好了就放進衣櫃,
// 不框、不填、不確認。猜的標「分類是猜的」,錯了到衣櫃點開那件改。一次只算一張(cutout.js 本來就排隊),一張失敗跳下一張。
// 限制:不框就整張去背,背景亂、兩件入鏡的照片會比單張流程差;分類只猜得出上衣、下身、鞋、皮帶(guessPart),外套會被當上衣。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import { useDialog } from "./useDialog.js";
import { guessPart, looksTilted, saveLocalItem, TILT_PARTS } from "./localWardrobe.js";
import { abandonCutout } from "./cutout.js";
import { colorName } from "./recommend.js";
import { PARTS } from "./parts.js";
import { track } from "./analytics.js";

export const BATCH_MAX = 20;   // 一次最多幾張:再多手機記憶體、等待都撐不住,多的請他分兩次

// 品名用的叫法:guessPart 只會給這四種。下身照長寬比分短褲、長褲:推薦看品名的「短褲」判斷冷熱(wishCheck guessWarmth),
// 叫「褲子」的短褲冷天也會被推(2026-11-02 實測灰短褲)。裙子也會進下身,名字點開可改
const NOUN = { upperbody: "上衣", shoes: "鞋", belt: "皮帶" };
const SHORTS_RATIO = 1.35;   // 去背修邊後 高/寬:平放的長褲 1.6 以上,短褲 1.2 以下
// 驗收(2026-11-02,20 張實測):成雙的鞋整張去背只切到一隻、包也窄長,guessPart 全猜成長褲(h/w 1.7–2.8,長褲 1.6–2.1,有重疊)。
// 比長褲還窄的當鞋;重疊那段分不出來,照實標「分類是猜的」
const SHOE_RATIO = 2.2;

const STALL_MS = 60000;   // 跟單張流程同一條:下載模型 60 秒沒進度就停

/**
 * @param files 選的照片(最多 BATCH_MAX 張,多的呼叫端已經切掉)
 * @param existing 這個衣櫃已經有的(取名避開重複、算第 1、第 5 件)
 * @param cut (file, onProgress) → { blob, color, secondaryColor }:整張去背(AddGarment 的 cutoutWhole)
 * @param errorText (錯誤) → 給人看的原因(AddGarment 的 cutoutErrorText)
 * @param note 選超過 BATCH_MAX 張時講一句(呼叫端寫好)
 * @param onDone(saved) 關掉;saved 是放進去的件數
 */
export function BatchAdd({ files, existing, cut, errorText, note = "", onDone }) {
  const dialogRef = useRef(null);
  const [rows, setRows] = useState(() => files.map((_, index) => ({ index, state: "wait", text: "", preview: null, name: "", part: "" })));
  const [running, setRunning] = useState(true);
  const [stopped, setStopped] = useState("");   // 整批停下來的原因(模型下載停住)
  const stopRef = useRef(false);
  const previewsRef = useRef([]);

  const saved = rows.filter((row) => row.state === "saved").length;
  const left = rows.filter((row) => row.state === "wait" || row.state === "work").length;
  const update = (index, patch) => setRows((current) => current.map((row) => (row.index === index ? { ...row, ...patch } : row)));

  useEffect(() => {
    let alive = true;
    (async () => {
      const taken = new Set(existing.map((item) => item.name));
      const stamp = Date.now();
      let owned = existing.filter((item) => item.isLocal && !item.wishlist && !item.trashedAt && !item.standIn).length;
      let count = 0;
      for (const [index, file] of files.entries()) {
        if (!alive || stopRef.current) break;
        update(index, { state: "work", text: "準備去背…" });
        try {
          const result = await new Promise((resolve, reject) => {
            let timer = null;
            const arm = () => {
              clearTimeout(timer);
              timer = setTimeout(() => { abandonCutout(); reject(Object.assign(new Error("模型下載停住了"), { stalled: true })); }, STALL_MS);
            };
            arm();
            cut(file, (text, downloading) => {
              if (alive) update(index, { text });
              if (downloading) arm(); else clearTimeout(timer);
            }).then((value) => { clearTimeout(timer); resolve(value); }, (cause) => { clearTimeout(timer); reject(cause); });
          });
          if (!alive || stopRef.current) break;   // 算到一半按了停:這張不存
          let bitmap = null, part = "upperbody", noun = "", tilted = false;
          try {
            bitmap = await createImageBitmap(result.blob);
            part = guessPart(bitmap) || "upperbody";
            if (part === "lowerbody" && bitmap.height / bitmap.width >= SHOE_RATIO) part = "shoes";
            // 放歪了先看(橫放的褲子形狀像上衣,分類會猜錯),再定品名
            tilted = TILT_PARTS.includes(part) && looksTilted(bitmap).tilted;
            // 放歪的褲子長寬比是反的,分不出長短褲(實測橫放長褲被叫成短褲),叫「褲子」
            if (part === "lowerbody") noun = tilted ? "褲子" : bitmap.height / bitmap.width < SHORTS_RATIO ? "短褲" : "長褲";
          } catch { /* 讀不到就當上衣 */ } finally { bitmap?.close?.(); }
          const base = `${colorName(result.color).replace("混色", "")}${noun || NOUN[part] || PARTS[part]?.singular || "單品"}`;
          let name = base;
          for (let n = 2; taken.has(name); n += 1) name = `${base} ${n}`;
          taken.add(name);
          if (!alive || stopRef.current) break;   // 猜分類那幾十毫秒按了停,也不存(驗收抓到)
          await saveLocalItem({
            id: `local-${stamp}-${index}`, name, part, color: result.color, secondaryColor: result.secondaryColor,
            tags: [], blob: result.blob, wishlist: false, dream: false, sourceUrl: null, price: null, priceCurrency: "TWD",
            brand: undefined, partGuessed: true,
          });
          count += 1;
          owned += 1;
          track("加衣服", { 種類: "已經有" });
          if (owned === 1) track("第 1 件");
          if (owned === 5) track("第 5 件");
          const preview = URL.createObjectURL(result.blob);
          previewsRef.current.push(preview);
          if (alive) update(index, { state: "saved", text: "", preview, name, part, tilted });
        } catch (cause) {
          console.error(cause);
          if (!alive) break;
          if (cause?.stalled) {
            update(index, { state: "fail", text: "沒放進去" });
            setStopped("去背模型下載停住了，後面的先停下來。連上 Wi-Fi 再選一次沒放進去的那幾張。");
            break;
          }
          // 存不進去(無痕、空間滿)後面也一樣存不進去,整批停
          if (/quota|indexeddb|transaction|database/i.test(`${cause?.name} ${cause?.message}`)) {
            update(index, { state: "fail", text: "存不進去" });
            setStopped(/quota/i.test(`${cause?.name} ${cause?.message}`)
              ? "這台裝置的空間不夠，存不下了。清一點空間再選一次沒放進去的那幾張。"
              : "這個瀏覽器不讓網站存衣服，無痕／私密分頁最常見。換一般分頁打開再加。");
            break;
          }
          // 單張流程的句子有「再按一次」「框小一點」,這裡沒有重試鈕也沒有框:只講原因,叫他用單張再加
          update(index, { state: "fail", text: `沒放進去:${errorText(cause).replace(/[,，。].*$/, "")}。這張之後用「新增」一張一張加。` });
        }
      }
      if (alive) {
        setRows((current) => current.map((row) => (row.state === "wait" || row.state === "work" ? { ...row, state: "skip", text: "" } : row)));
        setRunning(false);
        track("一次加好幾張", { 張數: files.length, 放進去: count });
      }
    })();
    return () => {
      alive = false;
      for (const url of previewsRef.current) URL.revokeObjectURL(url);
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // 算到一半關掉:先問,放進去的留著,後面的不算了
  const close = () => {
    if (running && left && !window.confirm(`還有 ${left} 張還沒好，要停下來嗎？已經放進衣櫃的會留著。`)) return;
    stopRef.current = true;
    onDone(saved);
  };
  useDialog(dialogRef, close);

  const failed = rows.filter((row) => row.state === "fail").length;
  const status = running
    ? `${saved} / ${files.length} 放進衣櫃了，一張一張去背中…`
    : `放進衣櫃 ${saved} 件${rows.some((row) => row.tilted) ? `，${rows.filter((row) => row.tilted).length} 張照片放歪了` : ""}${failed ? `，${failed} 張沒成功` : ""}${rows.some((row) => row.state === "skip") ? `，${rows.filter((row) => row.state === "skip").length} 張沒處理` : ""}。`;

  return createPortal(
    <div className="add-overlay" role="presentation">
      <div className="add-panel add-panel-review batch-panel" role="dialog" aria-modal="true" aria-labelledby="batch-title" ref={dialogRef}>
        <button type="button" className="add-close" onClick={close} aria-label={running ? "停下來" : "關閉"}>
          <X size={20} weight="light" aria-hidden="true" />
        </button>
        <h2 id="batch-title" className="add-step">一次加 {files.length} 件</h2>
        {note && <small className="add-hint">{note}</small>}
        <small className="add-hint">每張整張去背、照形狀猜分類，好了就直接放進衣櫃，不用一件件填。分類只猜得準上衣、褲子；鞋、包、外套常猜錯，都標「分類是猜的」，到衣櫃點開那件改。照片在這台裝置上處理，不會上傳。</small>
        <ol className="batch-list">
          {rows.map((row) => (
            <li key={row.index} className={`batch-row is-${row.state}`}>
              {row.preview ? <img src={row.preview} alt="" /> : <span className="batch-blank" aria-hidden="true">{row.index + 1}</span>}
              <span className="batch-text">
                <b>{row.state === "saved" ? row.name : `第 ${row.index + 1} 張`}</b>
                <small>
                  {row.state === "saved" ? `放進衣櫃了・猜是${PARTS[row.part]?.singular || "上衣"}${row.tilted ? "・照片放歪了,分類可能不對,點開按「換圖」重拍" : ""}`
                    : row.state === "work" ? row.text || "去背中…"
                      : row.state === "fail" ? row.text
                        : row.state === "skip" ? "沒處理"
                          : "排隊中"}
                </small>
              </span>
            </li>
          ))}
        </ol>
        {stopped && <p className="add-field-error" role="alert">{stopped}</p>}
        <div className="add-actions batch-actions">
          <span className="quick-status" aria-live="polite">{status}</span>
          <button type="button" className="primary-button" onClick={close}>{running ? "停下來" : saved ? "看衣櫃" : "關閉"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
