// [本 fork 新增] 最後一道:畫面哪裡丟例外,不要整頁變白。
// 2026-10-26 破壞測試:整個網站沒有 error boundary,任何一個元件 render 時丟錯,React 就把整個網站卸載成空白,
// 壞資料還在的話重新整理也是白,使用者連「再匯一次備份」都按不到。資料在 IndexedDB、localStorage,這裡不碰,只給出口。
import { Component } from "react";
import { Logo } from "./Brand.jsx";
import { Feedback } from "./Feedback.jsx";

export class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("畫面出錯", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="crash">
        <Logo className="crash-logo" />
        <h1>畫面出錯了</h1>
        <p>你的衣服還在這個瀏覽器裡，沒有被刪掉。先重新整理一次；還是一樣的話，告訴我你剛剛在做什麼。</p>
        <div className="crash-actions">
          <button type="button" className="crash-reload" onClick={() => window.location.reload()}>重新整理</button>
          <Feedback where="出錯畫面" label="告訴我哪裡壞了" />
        </div>
      </main>
    );
  }
}
