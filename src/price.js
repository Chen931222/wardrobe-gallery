// [本 fork 新增] 價錢:顯示格式和可選的幣別。抓得到的照商品頁寫的幣別存,不換算;手動填的預設新台幣。
export const CURRENCIES = [
  ["TWD", "NT$"], ["USD", "US$"], ["JPY", "¥"], ["HKD", "HK$"], ["EUR", "€"], ["GBP", "£"], ["KRW", "₩"], ["CNY", "CN¥"],
];
const SYMBOL = Object.fromEntries(CURRENCIES);
const NO_DECIMALS = new Set(["TWD", "JPY", "KRW"]);

/** 「NT$1,290」「US$135」;沒有價錢回空字串。 */
export function formatPrice(amount, currency = "TWD") {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return "";
  const code = currency || "TWD";
  const digits = NO_DECIMALS.has(code) || Number.isInteger(value) ? 0 : 2;
  const number = value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${SYMBOL[code] || `${code} `}${number}`;
}

/** 輸入框的字 → 數字;空的、不是正數的回 null(代表沒標價)。 */
export function parsePrice(text) {
  const value = Number(String(text ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}
