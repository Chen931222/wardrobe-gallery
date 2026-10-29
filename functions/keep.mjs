// [本 fork 新增] /api/keep(2026-10-29):認得出「衣櫃被瀏覽器清掉了」,不是新訪客。
// iPhone 的 Safari 有開的日子累積約 7 天沒碰這個網站,會把網站自己寫的資料(IndexedDB、localStorage…)全部清掉,衣服就在裡面;
// 伺服器用 Set-Cookie 設的 cookie 不在那張清單裡(WebKit 2020-03 公開說明;真機沒等滿 7 天驗過)。
// 所以衣櫃有東西時網頁打一下這裡,伺服器回一個一年效期的 cookie;之後衣櫃空了、本機的標記也不見了、cookie 還在 → 是被清掉。
// cookie 裡只有三個數:自己加的件數.代表款件數.備份過沒(src/keepSafe.js 的 noteCloset),沒有衣服的名稱、照片。
// 不設 HttpOnly:網頁一打開就要讀得到,不用為了每個新訪客多問伺服器一次。件數都是 0 就把 cookie 拿掉。
// 件數放在請求本文,不放網址:網址連同 IP 會留在 Vercel 的請求紀錄裡(驗收抓到)。
import { overLimit, tooMany } from "./_rate-limit.mjs";

const COOKIE = "pt_had";
const VALUE = /^(\d{1,4})\.(\d{1,4})\.([01])$/;

export async function POST(request) {
  const wait = overLimit(request, "keep", 30);   // 衣櫃件數有變才打一次;一分鐘 30 次已經是亂打
  if (wait) return tooMany(wait);
  // 只收這個網站自己的網頁打來的:別的網站用表單 POST 過來,瀏覽器一樣會存下 cookie,入口就會對新訪客說「上次有 9999 件」(驗收抓到)。
  // 現在的瀏覽器都帶 Sec-Fetch-Site(網頁改不了);沒帶的舊瀏覽器退回比 Origin 跟 Host
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const sameHost = () => { try { return new URL(origin).host === host; } catch { return false; } };   // Origin: null 之類的
  if (site ? site !== "same-origin" : !origin || !host || !sameHost()) {
    return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const match = VALUE.exec((await request.text()).trim().slice(0, 20));
  if (!match) return new Response(null, { status: 400, headers: { "Cache-Control": "no-store" } });
  const cookie = Number(match[1]) + Number(match[2])
    ? `${COOKIE}=${match[0]}; Max-Age=31536000; Path=/; Secure; SameSite=Lax`
    : `${COOKIE}=; Max-Age=0; Path=/; Secure; SameSite=Lax`;
  return new Response(null, { status: 204, headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}
