// [本 fork 新增] 搭配頁底下的「同步」:產生或輸入同步碼,手機、平板看同一個衣櫃。規則在 sync.js。
import { useEffect, useState } from "react";
import { formatCode, isValidCode, lastSynced, newSyncCode, normalizeCode, setSyncCode, stopSync, syncCode, syncNow } from "./sync.js";

const timeText = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function SyncPanel() {
  const [code, setCode] = useState(syncCode);
  const [status, setStatus] = useState(() => (lastSynced() ? { at: lastSynced() } : null));
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const [typed, setTyped] = useState("");
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    const onSynced = (event) => { setStatus(event.detail); setBusy(false); };
    window.addEventListener("wardrobe-synced", onSynced);
    return () => window.removeEventListener("wardrobe-synced", onSynced);
  }, []);

  const start = (next) => {
    setSyncCode(next);
    setCode(next);
    setJoining(false);
    setTyped("");
    setBusy(true);
    syncNow();
  };

  const join = (event) => {
    event.preventDefault();
    const next = normalizeCode(typed);
    if (!isValidCode(next)) { setStatus({ error: "同步碼是 16 個英文字母和數字,再對一次" }); return; }
    start(next);
  };

  const stop = () => {
    if (!confirm("這台停止同步?衣服會留在這台,只是之後不再跟其他裝置交換。")) return;
    stopSync();
    setCode(null);
    setStatus(null);
  };

  return (
    <div className="studio-sync">
      <div className="studio-backup-controls">
        <span className="studio-backup-label">同步</span>
        {code ? (
          <>
            <button type="button" disabled={busy} onClick={() => { setBusy(true); syncNow(); }}>{busy ? "同步中…" : "立即同步"}</button>
            <button type="button" onClick={() => setShowCode((on) => !on)}>{showCode ? "收起同步碼" : "看同步碼"}</button>
            <button type="button" onClick={stop}>停止</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => start(newSyncCode())}>開始同步</button>
            <button type="button" onClick={() => setJoining((on) => !on)}>輸入同步碼</button>
          </>
        )}
      </div>

      {joining && !code && (
        <form className="studio-sync-join" onSubmit={join}>
          <label htmlFor="sync-code-input">另一台的同步碼</label>
          <input
            id="sync-code-input"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
          <button type="submit">加入</button>
        </form>
      )}

      {code && showCode && <p className="studio-sync-code">{formatCode(code)}</p>}

      {status?.error ? (
        <p className="studio-backup-msg" role="status">同步失敗:{status.error}</p>
      ) : code && status?.at ? (
        <p className="studio-backup-msg" role="status">
          上次同步 {timeText(status.at)}
          {status.pulled ? `,從其他裝置拿到 ${status.pulled} 件` : ""}
        </p>
      ) : null}

      <p className="studio-backup-note">
        {code
          ? "在另一台按「輸入同步碼」,打這組碼就會看到同一個衣櫃。拿到碼的人都看得到、改得到,不要貼到公開的地方。"
          : "自己加的衣服、想買的、穿著紀錄和收藏會存到雲端一份(只有拿到同步碼的人讀得到),手機和平板就會一樣。"}
      </p>
    </div>
  );
}
