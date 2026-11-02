// [本 fork 新增] 去背後點一下修正(2026-10-27):「這也是」把漏掉的那塊加進來、「這不是」把多出來的背景拿掉。
/* MagicTouch(cutout.js)本來就是點選式的:去背時點框的正中央,這裡讓人再補幾點。
   實測(work/cutout-compare-2026-10-27/):成雙的鞋只選到一隻,點另一隻「這也是」就整雙出來;
   沙發、床單滲進來,點那塊「這不是」就拿掉,衣服不會跟著被擦。
   畫面:框起來的照片調暗,選到的部分照原色疊在上面;點過的地方標一個小圓(綠 = 這也是、紅 = 這不是)。
   每點一下就照全部的點重選一次(在 Worker 裡算,畫面不凍住);「上一點」退掉最後一點重選。
   2026-11-02 本人「操作指示不夠清楚」(截圖:想去掉鞋子,沒切到「這不是」,鞋子反而被加進來):拿掉「這也是／這不是」切換,
   點下去那一點現在有留著就是「這不是」,沒留著就是「這也是」。按鈕也不再並排「不改了」「不用改」兩個長得一樣的字。
   框的正中央剛好是背景(兩隻鞋中間、敞開的外套)時,中間那點本身就錯了:「從頭點」連它一起清掉,自己點衣服。 */
import { useEffect, useRef, useState } from "react";
import { CENTER, refineCutout, strokeAt } from "./cutout.js";

const loadImage = (src) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error("照片載不出來"));
  image.src = src;
});
const TAP_SLOP = 10;   // 按下到放開移動超過這麼多(CSS px)算拖,不算點

/** @param input 送去背的那張(框起來的照片) @param cut 現在的去背結果 @param strokes 現在用的點(第一點通常是正中央)
 *  @param onDone(cut, strokes) 改好了 @param onCancel 沒改或放棄 */
export function CutoutPicker({ input, cut, strokes: initialStrokes, onDone, onCancel }) {
  const canvasRef = useRef(null);
  const photoRef = useRef(null);
  const downRef = useRef(null);
  const keptRef = useRef(null);   // 現在選到的部分的透明度(畫布大小),點下去時看那一點有沒有留著
  const [strokes, setStrokes] = useState(initialStrokes?.length ? initialStrokes : [CENTER]);
  const [current, setCurrent] = useState(cut);   // null = 什麼都沒選(從頭點之後)
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState("");
  const changed = strokes !== initialStrokes;
  const anySelected = strokes.some((stroke) => stroke.brushMode !== 2);

  // 照片只載一次;選到的部分每次重選後換掉
  useEffect(() => {
    let cancelled = false;
    const url = URL.createObjectURL(input);
    loadImage(url).then((image) => {
      if (cancelled) return;
      photoRef.current = image;
      const canvas = canvasRef.current;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      setReady(true);
    }).catch((error) => { if (!cancelled) setProblem(error.message); }).finally(() => URL.revokeObjectURL(url));
    return () => { cancelled = true; };
  }, [input]);

  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    const url = current ? URL.createObjectURL(current) : null;
    (url ? loadImage(url) : Promise.resolve(null)).then((selected) => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.globalAlpha = 0.32;
      context.drawImage(photoRef.current, 0, 0);
      context.globalAlpha = 1;
      if (selected) context.drawImage(selected, 0, 0, canvas.width, canvas.height);
      keptRef.current = null;
      if (selected) {
        const probe = Object.assign(document.createElement("canvas"), { width: canvas.width, height: canvas.height });
        const probeContext = probe.getContext("2d", { willReadFrequently: true });
        probeContext.drawImage(selected, 0, 0, canvas.width, canvas.height);
        keptRef.current = { data: probeContext.getImageData(0, 0, canvas.width, canvas.height).data, w: canvas.width, h: canvas.height };
      }
      const r = Math.max(6, Math.round(canvas.width / 70));
      for (const stroke of strokes) {
        const [{ x, y }] = stroke.point;
        context.beginPath();
        context.arc(x * canvas.width, y * canvas.height, r, 0, Math.PI * 2);
        context.fillStyle = stroke.brushMode === 2 ? "#b3261e" : "#2e6b3a";
        context.fill();
        context.lineWidth = Math.max(2, r / 3);
        context.strokeStyle = "#fff";
        context.stroke();
      }
    }).catch(() => { /* 換下一張時舊的載不到,不用管 */ }).finally(() => { if (url) URL.revokeObjectURL(url); });
    return () => { cancelled = true; };
  }, [ready, current, strokes]);

  const reselect = async (next) => {
    setProblem("");
    // 沒有任何「這也是」:什麼都不選,不用問模型
    if (!next.some((stroke) => stroke.brushMode !== 2)) { setStrokes(next); setCurrent(null); return; }
    setBusy(true);
    try {
      setCurrent(await refineCutout(input, next));
      setStrokes(next);
    } catch (error) {
      console.error(error);
      setProblem(`沒有選成功:${error?.message || error}`);
    } finally {
      setBusy(false);
    }
  };

  // 只收第一根手指、滑鼠左鍵;點一下才算,拖過去的不算(畫布在可以捲動的視窗裡,捲動交給瀏覽器)
  const down = (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    downRef.current = { x: event.clientX, y: event.clientY };
  };
  const tap = (event) => {
    const start = downRef.current;
    downRef.current = null;
    if (!start || !ready || busy || !event.isPrimary) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    // 點到現在有留著的(照原色)= 這不是;點到變淡的 = 這也是。什麼都沒選時一定是「這也是」
    const kept = keptRef.current;
    const isKept = Boolean(kept) && anySelected
      && kept.data[(Math.min(kept.h - 1, Math.floor(y * kept.h)) * kept.w + Math.min(kept.w - 1, Math.floor(x * kept.w))) * 4 + 3] > 128;
    reselect([...strokes, strokeAt(isKept ? "remove" : "add", x, y)]);
  };
  const undo = () => { if (strokes.length) reselect(strokes.slice(0, -1)); };
  const restart = () => reselect([]);

  return (
    <div className="eraser picker">
      <p className="add-step">點一下修正</p>
      {anySelected ? (
        <ol className="picker-steps">
          <li>照原色的會留下來,變淡的會去掉。</li>
          <li>哪裡不對就點哪裡:多出來的(別件衣服、鞋、床單)點一下就去掉;漏掉的(袖子、另一隻鞋)點一下就加回來。</li>
          <li>點錯了按「上一點」。</li>
        </ol>
      ) : (
        <small className="add-hint">點一下衣服,點到的那件會照原色亮起來;成雙的鞋兩隻都點。</small>
      )}
      <div className="eraser-stage">
        <canvas
          ref={canvasRef}
          className="eraser-canvas picker-canvas"
          aria-label="框起來的照片,照原色的是會留下來的部分;點留下來的地方會去掉,點變淡的地方會加回來"
          onPointerDown={down}
          onPointerUp={tap}
          onPointerCancel={() => { downRef.current = null; }}
        />
        {busy && <span className="picker-busy" role="status">重選中…</span>}
      </div>
      <div className="eraser-tools">
        <p className="picker-legend" aria-hidden="true"><span className="is-add" />加回來的<span className="is-remove" />去掉的</p>
        <div className="picker-history">
          <button type="button" className="secondary-button" onClick={undo} disabled={busy || !strokes.length}>上一點</button>
          <button type="button" className="secondary-button" onClick={restart} disabled={busy || !strokes.length}>從頭點</button>
        </div>
      </div>
      {problem && <small className="add-field-error" role="alert">{problem}</small>}
      <div className="add-actions">
        {changed && <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>放棄這幾點</button>}
        <button
          type="button"
          className="primary-button"
          onClick={() => (changed ? onDone(current, strokes) : onCancel())}
          disabled={!ready || busy || (changed && !current)}
        >
          {!changed ? "這樣就好" : current ? "改好了" : "先點一下衣服"}
        </button>
      </div>
    </div>
  );
}
