// [本 fork 新增] 入口右上「同步」打開的面板:開通、加入、換新碼、刪除雲端。規則在 sync.js。
// 訪客(canStart=false)只能「輸入同步碼」:開通只給站主,不然陌生人先按就把唯一的開通名額拿走了。
// 訪客輸入站主的碼 = 站主的另一台,加入後切成擁有者模式並重新整理,看到跟另一台一樣的衣櫃。
import { useEffect, useState } from "react";
import { becomeOwner } from "./ownerMode.js";
import {
  deleteCloud, formatCode, isValidCode, joinSync, lastSyncError, lastSynced, normalizeCode, rotateCode,
  startSync, stopSync, syncCode, syncNotice, syncNow,
} from "./sync.js";

const timeText = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function SyncPanel({ canStart = true }) {
  const [code, setCode] = useState(syncCode);
  // 打開面板時先講最近一次的結果:上次失敗就說失敗、改動還沒上去,不要只寫「上次同步 HH:MM」(審查 F40)
  const [status, setStatus] = useState(() => (syncNotice() ? { error: syncNotice() }
    : lastSyncError() ? { error: lastSyncError() }
    : lastSynced() ? { at: lastSynced() } : null));
  const [busy, setBusy] = useState("");
  const [joining, setJoining] = useState(!canStart);
  const [typed, setTyped] = useState("");
  const [showCode, setShowCode] = useState(false);
  // 同步碼等於整個衣櫃的鑰匙(2026-10-06 資安盤點):打開 60 秒自動收起;切到別的 app 馬上收起,
  // iPhone 的多工畫面會把當下的頁面截成縮圖,碼不該留在上面
  useEffect(() => {
    if (!showCode) return undefined;
    const timer = setTimeout(() => setShowCode(false), 60000);
    const onHide = () => { if (document.visibilityState === "hidden") setShowCode(false); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", onHide); };
  }, [showCode]);

  useEffect(() => {
    const onSynced = (event) => {
      setStatus(event.detail);
      setCode(syncCode());
    };
    window.addEventListener("wardrobe-synced", onSynced);
    return () => window.removeEventListener("wardrobe-synced", onSynced);
  }, []);

  // 每個動作都一樣:顯示進行中、做完收尾、出錯就把話講出來
  const act = async (label, work) => {
    setBusy(label);
    try {
      const result = await work();
      if (result?.error) setStatus({ error: result.error });
    } catch (error) {
      setStatus({ error: error?.message || String(error) });
    } finally {
      setBusy("");
      setCode(syncCode());
    }
  };

  const join = (event) => {
    event.preventDefault();
    const next = normalizeCode(typed);
    if (!isValidCode(next)) {
      // 打了 16 個字卻被說不對,多半是把長得像的字打成 0、O、1、I:同步碼裡不會有這四個(審查 F62)
      const lookalike = next.length === 16 && /[01OI]/.test(next);
      setStatus({ error: lookalike ? "同步碼裡不會有 0、O、1、I 這四個字,是長得像的別的字,再對一次" : `同步碼是 16 個英文字母和數字,現在是 ${next.length} 個,再對一次` });
      return;
    }
    act("加入中…", async () => {
      const result = await joinSync(next);
      if (!result.error) {
        setJoining(false);
        setTyped("");
        if (!canStart) {
          // 重新整理之後講一聲加入了、拿到幾件(審查 F63:舊版直接跳回入口,沒有任何回饋)
          try { sessionStorage.setItem("open-wardrobe-joined", String(result.pulled || 0)); } catch { /* 看不到回饋而已 */ }
          becomeOwner();
          window.location.replace(window.location.pathname);   // 拿掉 ?edit=off、?public 這類參數,不然又被切回訪客
        }
      }
      return result;
    });
  };

  const rotate = () => {
    if (!confirm("換一組新碼?舊碼會立刻失效,其他裝置要用新碼重新加入。")) return;
    act("換碼中…", async () => { await rotateCode(); setShowCode(true); });
  };

  const removeCloud = () => {
    if (!confirm("刪掉雲端那份?這台的衣服都還在,只是不再同步;其他裝置下次打開也會停止同步。")) return;
    act("刪除中…", async () => { await deleteCloud(); setShowCode(false); setStatus(null); });
  };

  const stop = () => {
    if (!confirm("這台停止同步?衣服會留在這台,雲端那份也還在,其他裝置照常同步。")) return;
    stopSync();
    setCode(null);
    setShowCode(false);
    setStatus(null);
  };

  return (
    <div className="studio-sync">
      {(code || canStart) && (
      <div className="studio-backup-controls">
        {code ? (
          <>
            <button type="button" disabled={Boolean(busy)} onClick={() => act("同步中…", syncNow)}>{busy || "立即同步"}</button>
            <button type="button" onClick={() => setShowCode((on) => !on)}>{showCode ? "收起" : "看同步碼"}</button>
            <button type="button" disabled={Boolean(busy)} onClick={stop}>停止</button>
          </>
        ) : (
          canStart && (
            <>
              <button type="button" disabled={Boolean(busy)} onClick={() => act("開通中…", startSync)}>{busy && !joining ? busy : "開始同步"}</button>
              <button type="button" onClick={() => setJoining((on) => !on)}>輸入同步碼</button>
            </>
          )
        )}
      </div>
      )}

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
          <button type="submit" disabled={Boolean(busy)}>{busy || "加入"}</button>
        </form>
      )}

      {code && showCode && (
        <div className="studio-sync-manage">
          <p className="studio-sync-code">{formatCode(code)}</p>
          <div className="studio-backup-controls">
            <button type="button" disabled={Boolean(busy)} onClick={rotate}>換新碼</button>
            <button type="button" disabled={Boolean(busy)} onClick={removeCloud}>刪除雲端那份</button>
          </div>
          <p className="studio-backup-note studio-sync-warning">
            這組碼等於整個衣櫃的鑰匙:拿到的人看得到也改得到你的衣服。不要截圖、不要用訊息傳;要加新裝置,看著這裡打進去。
            給錯人或覺得外流了,按「換新碼」,舊碼立刻失效。一分鐘後、或切到別的 app 時會自動收起。
          </p>
        </div>
      )}

      {status?.error ? (
        <p className="studio-backup-msg is-error" role="status">{status.stopped || !code ? status.error : `同步沒成功,這台的改動還沒上去:${status.error}`}</p>
      ) : code && status?.at ? (
        <p className="studio-backup-msg" role="status">
          上次同步 {timeText(status.at)}
          {status.pulled ? `,從其他裝置拿到 ${status.pulled} 件` : ""}
        </p>
      ) : null}

      <p className="studio-backup-note">
        {code
          ? "另一台打開入口右上「同步」,輸入這組碼就會看到同一個衣櫃。拿到碼的人都看得到、改得到,不要貼到公開的地方。"
          : canStart
            ? "自己加的衣服、想買的、穿著紀錄和收藏會加密後存到雲端,只有輸入同步碼的裝置解得開,手機和平板就會一樣。"
            : "同步只給站主自己的裝置用:在已經同步的那台按「看同步碼」,把碼打在這裡。要把你加的衣服搬到另一台,用搭配頁最下面的「匯出備份」「匯入備份」。"}
      </p>
    </div>
  );
}
