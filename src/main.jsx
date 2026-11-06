import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { ErrorBoundary } from "./ErrorBoundary.jsx";
import { loadAnalytics } from "./analytics.js";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

loadAnalytics();

// 完整字型晚點才載:先用站上字的小檔(styles.css),這裡只補使用者打的罕見字;CSS 本身就有 50 KB,不擋第一屏
const loadFullFonts = () => { import("@fontsource/noto-sans-tc/500.css"); import("@fontsource/noto-serif-tc/700.css"); };
window.addEventListener("load", () => (window.requestIdleCallback ? requestIdleCallback(loadFullFonts, { timeout: 4000 }) : setTimeout(loadFullFonts, 3000)));

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
