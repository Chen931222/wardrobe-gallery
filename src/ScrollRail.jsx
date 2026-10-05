// [本 fork 新增] 看得到的捲軸:新增衣服、同步這類視窗比螢幕高時,右邊常駐一條細捲軸。
//
// 為什麼自己畫:iPhone 的 Safari 不讓網頁改捲軸樣式,捲軸平常也藏起來,只有手指在滑的那一下才出現。
// 確認那一步(去背完、選還沒買)在 iPhone SE 上有 764px 高、螢幕只有 568px,「放進想買的」在畫面外,
// 畫面上卻完全看不出下面還有東西(2026-10-05 本人要「滑軌、可以上下滑」)。
// 視窗塞得下就不畫;拖著小塊可以捲,點軌道其他地方翻一頁。螢幕閱讀器照原本的捲動走,這條藏起來。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MIN_THUMB = 0.14;   // 小塊至少佔軌道 14%,內容很長也還抓得到

/**
 * @param target 會捲的那個元素(ref)
 * @param watch  換成另一個元素時(同一個流程的下一步)要重新綁,就把會變的東西放這裡
 */
export function ScrollRail({ target, watch = null }) {
  const [view, setView] = useState(null);   // { size, pos } 都是 0–1;null = 不用捲
  const railRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    const element = target.current;
    if (!element) { setView(null); return undefined; }
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = element;
      if (scrollHeight <= clientHeight + 4) { setView(null); return; }
      setView({ size: Math.max(clientHeight / scrollHeight, MIN_THUMB), pos: scrollTop / (scrollHeight - clientHeight) });
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    // 內容高度會變:圖載進來、跳出「很像的」那一塊、換到下一步
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    window.addEventListener("resize", update);
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [target, watch]);

  if (!view) return null;

  const scrollBy = (pixels) => target.current?.scrollBy({ top: pixels, behavior: "smooth" });
  const onThumbDown = (event) => {
    const element = target.current;
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { y: event.clientY, top: element.scrollTop };
  };
  const onThumbMove = (event) => {
    const drag = dragRef.current, element = target.current, rail = railRef.current;
    if (!drag || !element || !rail) return;
    const track = rail.clientHeight * (1 - view.size);   // 小塊能走的距離
    const range = element.scrollHeight - element.clientHeight;
    element.scrollTop = drag.top + ((event.clientY - drag.y) / Math.max(track, 1)) * range;
  };
  const onThumbUp = () => { dragRef.current = null; };
  // 點軌道空的地方:往那邊翻一頁(八成高,留一點上一頁的內容接著看)
  const onRailDown = (event) => {
    const element = target.current, rail = railRef.current;
    if (!element || !rail || event.target !== rail) return;
    const thumbTop = rail.getBoundingClientRect().top + rail.clientHeight * view.pos * (1 - view.size);
    scrollBy((event.clientY < thumbTop ? -1 : 1) * element.clientHeight * 0.8);
  };

  return createPortal(
    <div ref={railRef} className="scroll-rail" aria-hidden="true" onPointerDown={onRailDown}>
      <div
        className="scroll-rail-thumb"
        style={{ top: `${view.pos * (1 - view.size) * 100}%`, height: `${view.size * 100}%` }}
        onPointerDown={onThumbDown}
        onPointerMove={onThumbMove}
        onPointerUp={onThumbUp}
        onPointerCancel={onThumbUp}
      />
    </div>,
    document.body,
  );
}
