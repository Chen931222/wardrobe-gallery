// [本 fork 新增] 書籤底線:衣櫃目錄和搭配頁衣架的分頁共用(2026-10-08)。
// 用法:nav 裡放一個 <span className="closet-index-indicator">,選中那格的名稱包在 .closet-index-label;
// nav 要有 position: relative 和底下留白(線在名稱下方 6px,超出 nav 會被當成「還沒露出來」藏起來)。
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/* 目錄的書籤底線(2026-10-08 本人在三個選項裡選「書籤滑動」)。
   原本是選中那格自己畫 text-decoration,換格時瞬間跳過去。改成整個目錄共用一條線:
   同一行裡從舊的那格滑到新的那格(240ms,ease-in-out,在畫面上移動用這條);換到別行就在新位置淡入,
   不斜著劃過整片字。量不到位置之前(第一次畫、JS 沒跑)照舊用 text-decoration,所以不會沒有底線。 */
const INDICATOR_BASE = 100;   // 線本身 100px 寬,用 scaleX 拉成標籤的寬度:只動 transform,不動 width
export function useIndexIndicator(navRef, lineRef, deps) {
  const last = useRef(null);
  const place = useCallback(() => {
    const nav = navRef.current, line = lineRef.current;
    if (!nav || !line) return;
    const folded = nav.classList.contains("is-folded");
    // 收起時分類那幾行還在 DOM 裡(只是高度 0),只找第一行裡亮著的
    const scope = folded ? nav.querySelector(".closet-index-top") : nav;
    const label = scope?.querySelector("button.active .closet-index-label");
    if (!label) {
      line.style.opacity = "0";
      last.current = null;
      return;
    }
    const navBox = nav.getBoundingClientRect(), box = label.getBoundingClientRect();
    const x = box.left - navBox.left, y = box.bottom - navBox.top + 6, width = box.width;
    // 展開到一半、那一行還被裁在外面:先藏起來,等長高到露出來(ResizeObserver 會再叫一次)再淡入
    if (y > nav.clientHeight + 1) {
      line.style.opacity = "0";
      last.current = null;
      return;
    }
    const transform = `translate(${x}px, ${y}px) scaleX(${width / INDICATOR_BASE})`;
    const before = last.current;
    last.current = { x, y, width };
    nav.classList.add("has-indicator");
    if (before && Math.abs(before.x - x) < 0.5 && Math.abs(before.y - y) < 0.5 && Math.abs(before.width - width) < 0.5) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!before || Math.abs(before.y - y) > 2 || reduce) {
      // 第一次、換行、或使用者要少一點動態:直接放到新位置,只淡入
      line.style.transition = "none";
      line.style.transform = transform;
      line.style.opacity = "1";
      void line.offsetWidth;
      line.style.transition = "";
      if (before) line.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduce ? 120 : 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
      return;
    }
    // 同一行:transition 從現在的位置接著滑(連點兩下會從半路改道,不會從頭重播)
    line.style.opacity = "1";
    line.style.transform = transform;
  }, [navRef, lineRef]);

  useLayoutEffect(place, [place, ...deps]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return undefined;
    // 視窗變寬變窄、字型載入完、展開收起:標籤位置會變,跟著重量。換行造成的 y 改變一律走淡入,不會滑來滑去
    const observer = new ResizeObserver(() => place());
    observer.observe(nav);
    document.fonts?.ready?.then(place).catch(() => {});
    // 展開做完再量一次:ResizeObserver 偶爾漏掉最後一格(實測:展開完線沒回來),展開結束的事件補上
    const onEnd = (event) => { if (event.propertyName === "grid-template-rows") place(); };
    nav.addEventListener("transitionend", onEnd);
    return () => { observer.disconnect(); nav.removeEventListener("transitionend", onEnd); };
  }, [navRef, place]);
  // 再保險一次:展開收起(220ms)結束後一定重量;動畫被關掉、事件沒來也不會停在看不見
  const [open] = deps.slice(1, 2);
  useEffect(() => {
    const timer = setTimeout(place, 260);
    return () => clearTimeout(timer);
  }, [open, place]);
}

