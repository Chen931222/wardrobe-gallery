// [本 fork 新增] 對話框的焦點:打開時焦點進來、Tab 不跑到背景、Esc 關掉、關掉後焦點回到原本按的那顆。
//
// 審查 F46(2026-10-02):新增和同步按 Esc 關不掉、焦點不進對話框;單品頁 Tab 會跑到背景,關掉後焦點掉到 body。
// 不用 inert:對話框就放在 .gallery-pane 裡面,把背景設 inert 會連它自己一起關掉。改成自己圈住 Tab。
import { useEffect, useRef } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const visible = (element) => element.offsetParent !== null || element.getClientRects().length > 0;

/**
 * @param ref       對話框本體(role="dialog" 那個元素)
 * @param onClose   按 Esc 時叫;給 null 就不處理 Esc(單品頁自己處理:先取消吸色、有沒存的先擋)
 * @param options.initialFocus  打開時要聚焦的元素(ref);不給就聚焦第一個可以按的
 * @param options.active        false 時整個不作用(對話框沒顯示)
 * @param options.watch         同一個流程換到下一步(換成另一個對話框元素)時要重新聚焦,就把會變的東西放這裡
 */
export function useDialog(ref, onClose, { initialFocus = null, active = true, watch = null } = {}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // 原本按的那顆只在「打開」那一刻記一次,整個流程走完才還回去。每一步都記的話,中間那步(去背中)
  // 新增鈕是停用的,焦點還不回去、掉到 body,之後就一路接著錯(審查抓到)
  const openerRef = useRef(null);
  useEffect(() => {
    if (!active) return undefined;
    openerRef.current = document.activeElement;
    return () => {
      const opener = openerRef.current;
      // 還在畫面上才還給它;不在了(例如刪掉那件、換了頁)就不搶
      if (opener && opener !== document.body && document.contains(opener) && typeof opener.focus === "function") {
        opener.focus({ preventScroll: true });
      }
    };
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;
    const dialog = ref.current;
    if (!dialog) return undefined;

    const focusables = () => [...dialog.querySelectorAll(FOCUSABLE)].filter(visible);
    const target = initialFocus?.current || focusables()[0] || dialog;
    if (target === dialog && !dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });

    const onKeyDown = (event) => {
      // 注音、倉頡選字中按 Esc 是取消選字,不是關掉對話框
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape" && closeRef.current) {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusables();
      if (!list.length) { event.preventDefault(); return; }
      const first = list[0], last = list[list.length - 1];
      const inside = dialog.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !inside)) { event.preventDefault(); first.focus(); }
    };
    // 掛在 document 的捕獲階段:焦點不管在哪,Tab、Esc 都先經過這裡
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active, ref, initialFocus, watch]);
}
