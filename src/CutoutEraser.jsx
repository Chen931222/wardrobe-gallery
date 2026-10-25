// [本 fork 新增] 去背後擦掉多餘的(2026-10-25):衣架、床單、旁邊的手。模型留下的這些以前只能重拍。
/* 一張 canvas 畫去背結果,手指(或滑鼠)塗過去的地方用 destination-out 變透明。
   復原不存整張像素(1400² 一張 7.8MB,手機存十張就爆):只記每一筆的點,「上一筆」就從原圖重畫剩下的筆。
   不做放大縮小:細的衣架鉤子用「小」筆刷;再細的就是這個工具的極限,改重拍。 */
import { useEffect, useRef, useState } from "react";

// 筆刷半徑,照畫面上的尺寸(CSS px)定,換算成 canvas 的像素;衣架鉤子用小,床單用大
const SIZES = [["小", 7], ["中", 14], ["大", 26]];

/** @param src 去背結果(object URL) @param onDone(blob) 擦完的 PNG @param onCancel 沒擦或放棄 */
export function CutoutEraser({ src, onDone, onCancel }) {
  const canvasRef = useRef(null);
  const cursorRef = useRef(null);
  const imageRef = useRef(null);      // 原本那張,復原時從它重畫
  const strokesRef = useRef([]);      // [{ r, points: [[x, y], …] }],canvas 座標
  const strokeRef = useRef(null);     // 正在畫的這一筆
  const [size, setSize] = useState(1);
  const [count, setCount] = useState(0);   // 畫了幾筆:復原鈕能不能按、「完成」要不要存
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      const canvas = canvasRef.current;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d").drawImage(image, 0, 0);
      setReady(true);
    };
    image.src = src;
    return () => { cancelled = true; };
  }, [src]);

  const paint = (context, r, points) => {
    context.globalCompositeOperation = "destination-out";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = r * 2;
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    // 只點一下也要擦出一個圓:零長度的線 Safari 不畫,挪 0.01 像素
    if (points.length === 1) context.lineTo(points[0][0] + 0.01, points[0][1]);
    for (let index = 1; index < points.length; index += 1) context.lineTo(points[index][0], points[index][1]);
    context.stroke();
    context.globalCompositeOperation = "source-over";
  };
  const redraw = () => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(imageRef.current, 0, 0);
    for (const stroke of strokesRef.current) paint(context, stroke.r, stroke.points);
  };

  // 畫面座標 → canvas 像素;canvas 用 CSS 縮到版面裡,比例照實際顯示的寬算
  const scaleOf = () => canvasRef.current.width / canvasRef.current.getBoundingClientRect().width;
  const pointOf = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scale = scaleOf();
    return [(event.clientX - rect.left) * scale, (event.clientY - rect.top) * scale];
  };
  const moveCursor = (event) => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const d = SIZES[size][1] * 2;
    cursor.style.transform = `translate(${event.clientX - rect.left - d / 2}px, ${event.clientY - rect.top - d / 2}px)`;
    cursor.style.width = `${d}px`;
    cursor.style.height = `${d}px`;
    cursor.style.opacity = "1";
  };
  const hideCursor = () => { if (cursorRef.current) cursorRef.current.style.opacity = "0"; };

  // 只收第一根手指、滑鼠左鍵:第二根手指抬起不能把第一筆提早收掉,右鍵(Mac 的 Ctrl+點)開了選單就收不到 pointerup
  const down = (event) => {
    if (!ready || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    setProblem("");
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointOf(event);
    strokeRef.current = { r: SIZES[size][1] * scaleOf(), points: [point] };
    paint(canvasRef.current.getContext("2d"), strokeRef.current.r, [point]);
    moveCursor(event);
  };
  const move = (event) => {
    moveCursor(event);
    const stroke = strokeRef.current;
    if (!stroke || !event.isPrimary) return;
    if (event.pointerType === "mouse" && event.buttons === 0) { up(event); return; }   // 按鍵已經放掉卻沒收到 pointerup(選單搶走了)
    const point = pointOf(event);
    const previous = stroke.points[stroke.points.length - 1];
    stroke.points.push(point);
    paint(canvasRef.current.getContext("2d"), stroke.r, [previous, point]);   // 只畫新的那一段;圓頭疊在一起看不出接縫
  };
  const up = (event) => {
    if (!strokeRef.current || (event && !event.isPrimary)) return;
    strokesRef.current.push(strokeRef.current);
    strokeRef.current = null;
    setCount(strokesRef.current.length);
  };
  const undo = () => {
    if (!strokesRef.current.length) return;
    strokesRef.current.pop();
    redraw();
    setCount(strokesRef.current.length);
  };
  // 整張擦光不能存(會存出一件看不見的衣服):還有看得到的像素(alpha > 24,跟 trimTransparent 同門檻)才算
  const anythingLeft = () => {
    const canvas = canvasRef.current;
    const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 3; index < data.length; index += 4) if (data[index] > 24) return true;
    return false;
  };
  const finish = () => {
    if (!count) { onCancel(); return; }
    if (!anythingLeft()) { setProblem("全部擦光了,衣服不見了。按「上一筆」退回。"); return; }
    setBusy(true);
    canvasRef.current.toBlob((blob) => {
      if (blob) onDone(blob); else { setBusy(false); setProblem("這張存不出來,筆畫還留著;再按一次,或「不擦了」。"); }
    }, "image/png");
  };

  return (
    <div className="eraser">
      <p className="add-step">擦掉多餘的</p>
      <small className="add-hint">在衣架、床單、手這些不要的地方塗過去,塗到的會變透明。擦錯了按「上一筆」。</small>
      <div className="eraser-stage">
        <canvas
          ref={canvasRef}
          className="eraser-canvas"
          aria-label="去背結果;在不要的地方塗過去就會擦掉"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={hideCursor}
        />
        <span ref={cursorRef} className="eraser-cursor" aria-hidden="true" />
      </div>
      <div className="eraser-tools">
        <div className="eraser-sizes" role="group" aria-label="筆刷大小">
          {SIZES.map(([label], index) => (
            <button key={label} type="button" aria-pressed={index === size} onClick={() => setSize(index)}>{label}</button>
          ))}
        </div>
        <button type="button" className="secondary-button" onClick={undo} disabled={!count}>上一筆</button>
      </div>
      {problem && <small className="add-field-error" role="alert">{problem}</small>}
      <div className="add-actions">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>不擦了</button>
        <button type="button" className="primary-button" onClick={finish} disabled={!ready || busy}>{busy ? "處理中…" : count ? "擦好了" : "沒有要擦的"}</button>
      </div>
    </div>
  );
}
