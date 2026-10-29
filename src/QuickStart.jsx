// [本 fork 新增] 不拍照的起步(2026-10-29,本人:「用過的人說連拍照上傳都懶」)。
// 點一類 → 選顏色 → 加進「你點的」;上衣、下身各一件以上就能放進衣櫃,馬上配一套。
// 代表款怎麼做、跟 10-26「只用自己的衣服」的界線,見 src/standIns.js。
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "@phosphor-icons/react";
import { useDialog } from "./useDialog.js";
import { STAND_INS, STAND_IN_COLORS, makeStandInBlob, standInName } from "./standIns.js";
import { deleteLocalItem, saveLocalItem } from "./localWardrobe.js";
import { track } from "./analytics.js";

const GROUPS = [
  { part: "upperbody", label: "上衣" },
  { part: "wholebody_up", label: "外套" },
  { part: "lowerbody", label: "下身" },
  { part: "shoes", label: "鞋子" },
  { part: "bag", label: "包" },
];

/**
 * @param demoItems 示範衣櫃(代表款的底圖從這裡拿;沒對到的照檔名規則拼)
 * @param onClose 關掉,什麼都沒存
 * @param onSaved(count) 存好了;App 接著配一套、帶進搭配頁
 */
export function QuickStart({ demoItems, onClose, onSaved }) {
  const dialogRef = useRef(null);
  const [openKind, setOpenKind] = useState(null);
  const [picks, setPicks] = useState([]);   // [{ key, kind, color, thumb }]
  const [saving, setSaving] = useState(null);   // null | { done, total }
  const [error, setError] = useState("");
  const close = () => { if (!saving) onClose(); };
  useDialog(dialogRef, close);

  const sources = useMemo(() => {
    const byId = new Map(demoItems.map((item) => [item.id, item]));
    return (base) => {
      const item = byId.get(base);
      return { thumb: item?.thumbnail || `/data/library/${base}-thumb.webp`, image: item?.image || `/data/library/${base}-view.webp` };
    };
  }, [demoItems]);

  // 選色時先做一張小的換色圖給「你點的」那排看;拿掉、關掉時放掉
  const picksRef = useRef(picks);
  picksRef.current = picks;
  const mountedRef = useRef(true);
  useEffect(() => {
    // 開發版 StrictMode 會先模擬卸載再掛上:不設回 true,小圖做好就被丟掉,本機永遠看不到(2026-10-29 驗收)
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const pick of picksRef.current) if (pick.thumb) URL.revokeObjectURL(pick.thumb);
    };
  }, []);

  const toggle = async (kind, colorKey) => {
    const key = `${kind.key}:${colorKey}`;
    const had = picks.find((pick) => pick.key === key);
    if (had) {
      if (had.thumb) URL.revokeObjectURL(had.thumb);
      setPicks((current) => current.filter((pick) => pick.key !== key));
      return;
    }
    setPicks((current) => [...current, { key, kind, color: colorKey, thumb: null }]);
    try {
      const url = URL.createObjectURL(await makeStandInBlob(sources(kind.base).thumb, STAND_IN_COLORS[colorKey].hex, 200));
      // 小圖還在做就關掉了:setPicks 不會再跑,這張要自己放掉(驗收抓到)
      if (!mountedRef.current) { URL.revokeObjectURL(url); return; }
      setPicks((current) => {
        if (!current.some((pick) => pick.key === key)) { URL.revokeObjectURL(url); return current; }
        return current.map((pick) => (pick.key === key ? { ...pick, thumb: url } : pick));
      });
    } catch { /* 小圖做不出來就只列名字,存的時候再做一次大的 */ }
  };

  // 打開一類:顏色列捲到看得見(手機上點下面幾類時,顏色列會長在底下那條後面)
  useEffect(() => {
    if (!openKind) return;
    const kind = STAND_INS.find((k) => k.key === openKind);
    document.getElementById(`quick-colors-${kind?.part}`)?.scrollIntoView({ block: "nearest", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [openKind]);

  const count = (part) => picks.filter((pick) => pick.kind.part === part).length;
  const tops = count("upperbody"), bottoms = count("lowerbody");
  const missing = [!tops && "上衣", !bottoms && "下身"].filter(Boolean);
  const ready = !missing.length && !saving;

  const save = async () => {
    if (!ready) return;
    setError("");
    setSaving({ done: 0, total: picks.length });
    const stamp = Date.now();
    // 先把每件的圖都做好,再一起存;存到一半失敗就把已經存的刪掉。不然衣櫃留下半套,再按一次又整套重存一份(驗收抓到)
    const records = [];
    try {
      for (const [index, pick] of picks.entries()) {
        const color = STAND_IN_COLORS[pick.color];
        const blob = await makeStandInBlob(sources(pick.kind.base).image, color.hex);
        records.push({ id: `local-${stamp}-${index}`, name: standInName(pick.kind, pick.color), part: pick.kind.part, color: color.hex, tags: [], blob, standIn: true });
        setSaving({ done: index + 1, total: picks.length });
      }
    } catch (cause) {
      console.error(cause);
      setSaving(null);
      setError("代表款的圖讀不到，可能是網路斷了。連上之後再按一次。");
      return;
    }
    const saved = [];
    try {
      for (const record of records) { await saveLocalItem(record); saved.push(record.id); }
    } catch (cause) {
      console.error(cause);
      await Promise.all(saved.map((id) => deleteLocalItem(id).catch(() => {})));
      setSaving(null);
      setError(/quota/i.test(`${cause?.name} ${cause?.message}`)
        ? "這台裝置的空間不夠，存不下，一件都沒放進去。清一點空間再按一次。"
        : "這個瀏覽器不讓網站存衣服，一件都沒放進去。無痕／私密分頁最常見，換一般分頁打開再試一次。");
      return;
    }
    try { navigator.storage?.persist?.(); } catch { /* 不支援就算了 */ }
    track("代表款起步", { 件數: picks.length });
    onSaved(picks.length);
  };

  const status = saving
    ? `做代表款… ${saving.done}/${saving.total}`
    : missing.length
      ? `還差${missing.map((part) => `${part} 1 件`).join("、")}就能配`
      : `${picks.length} 件，可以配了`;

  return createPortal(
    <div className="add-overlay quick-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div className="add-panel quick-panel" role="dialog" aria-modal="true" aria-labelledby="quick-title" ref={dialogRef}>
        <button type="button" className="add-close" onClick={close} aria-label="關閉" disabled={Boolean(saving)}>
          <X size={20} weight="light" aria-hidden="true" />
        </button>
        <h2 id="quick-title" className="quick-title">不拍照，先點你有的</h2>
        <p className="quick-lede">點一類、選顏色，放一件長得像的代表款。上衣、下身各一件就配得出來；之後點開那件按「換圖」，換成你自己的。</p>

        {GROUPS.map((group) => {
          const kinds = STAND_INS.filter((kind) => kind.part === group.part);
          const open = kinds.find((kind) => kind.key === openKind);
          return (
            <section key={group.part} className="quick-group" aria-labelledby={`quick-${group.part}`}>
              <h3 id={`quick-${group.part}`}>{group.label}</h3>
              <div className="quick-kinds">
                {kinds.map((kind) => {
                  const n = picks.filter((pick) => pick.kind.key === kind.key).length;
                  return (
                    <button
                      key={kind.key}
                      type="button"
                      className={openKind === kind.key ? "quick-kind is-open" : "quick-kind"}
                      aria-expanded={openKind === kind.key}
                      aria-controls={`quick-colors-${group.part}`}
                      onClick={() => setOpenKind((current) => (current === kind.key ? null : kind.key))}
                    >
                      <img src={sources(kind.base).thumb} alt="" loading="lazy" draggable={false} />
                      <span>{kind.label}</span>
                      {n > 0 && <span className="quick-kind-count" aria-label={`點了 ${n} 件`}>{n}</span>}
                    </button>
                  );
                })}
              </div>
              {open && (
                <div id={`quick-colors-${group.part}`} className="quick-colors" role="group" aria-label={`${open.label}的顏色`}>
                  {open.colors.map((colorKey) => {
                    const color = STAND_IN_COLORS[colorKey];
                    const on = picks.some((pick) => pick.key === `${open.key}:${colorKey}`);
                    return (
                      <button key={colorKey} type="button" className="quick-color" aria-pressed={on} onClick={() => toggle(open, colorKey)} disabled={Boolean(saving)}>
                        <span className="quick-dot" style={{ background: color.hex }} aria-hidden="true" />
                        {color.label}
                        {on && <Check size={14} weight="bold" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

        <div className="quick-dock">
          {picks.length > 0 && (
            <ul className="quick-picks" aria-label="你點的">
              {picks.map((pick) => (
                <li key={pick.key}>
                  {pick.thumb ? <img src={pick.thumb} alt="" /> : <span className="quick-picks-blank" aria-hidden="true" />}
                  <span>{standInName(pick.kind, pick.color)}</span>
                  <button type="button" onClick={() => toggle(pick.kind, pick.color)} aria-label={`拿掉${standInName(pick.kind, pick.color)}`} disabled={Boolean(saving)}>
                    <X size={14} weight="regular" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="add-field-error" role="alert">{error}</p>}
          <div className="quick-dock-row">
            <span className="quick-status" aria-live="polite">{status}</span>
            <button type="button" className="primary-button" onClick={save} disabled={!ready} aria-busy={Boolean(saving)}>放進衣櫃，配一套</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
