// [本 fork 新增] 去背模型下載的實際進度(2026-10-25)。Worker(cutoutWorker.js)和主執行緒(cutout.js 的退路)共用。
/* 去背套件把模型切成 4MB 一段、二十幾段同時抓,每段「整段到齊」才回報一次進度:慢一點的網路上前 40 秒以上都是 0,
   最後一口氣跳上去(新訪客實測,模擬 Fast 4G:按下去背後 40 秒只有「準備去背…」,畫面寫 52% 時實際已經下載 85%)。
   再慢的網路連 60 秒都沒有一段到齊,AddGarment 的看門狗就當成卡住、把去背停掉。
   這裡包住 fetch,只管 staticimgly.com 的模型分段,一邊收一邊數位元組。其他網址原封不動。
   總量照 resources.json:模型(isnet_fp16)＋運算程式(cpu 版;網站沒設 device,套件預設 cpu)。抓到清單以外的分段就加上去。
   一次只放 MAX_PARALLEL 段在抓(2026-10-25):二十幾段同時抓、每段都很慢時,模擬 Fast 3G 第 60 秒左右會有一段「Failed to fetch」,
   整個去背失敗,舊版也一樣(正式站實測);伺服器本身沒有斷慢連線(curl 限速 50KB/s 抓一段 82 秒照樣完成)。
   頻寬吃滿時排隊差不多快(不限速 16 秒 vs 正式站 17 秒、Fast 4G 103 vs 99 秒);延遲高、頻寬又大的連線會慢一些(驗收用代理量到) */
const HOST = "staticimgly.com";
const isModelHost = (url) => { try { const { hostname } = new URL(url); return hostname === HOST || hostname.endsWith(`.${HOST}`); } catch { return false; } };
const MODEL = "/models/isnet_fp16";
const RUNTIME = "/onnxruntime-web/ort-wasm-simd-threaded.wasm";

let installed = false;
const MAX_PARALLEL = 3;
let resetHook = null;

/** 去背失敗、要重新初始化時(cutout.js 的 modelAttempt 換了):已下載量從 0 重算,不然重試一開始就停在上一輪的百分比 */
export function resetModelMeter() { resetHook?.(); }

// 舊瀏覽器 Response 不收 stream 當內容的話整個不裝(不然去背會壞掉,沒有退路)
const streamBodies = () => { try { new Response(new ReadableStream()); return true; } catch { return false; } };

/** @param report (已下載位元組, 預估總位元組) 最多每 250ms 一次,下載完那一下一定會報 */
export function meterModelDownload(report) {
  if (installed || typeof fetch !== "function" || typeof ReadableStream === "undefined" || typeof Response === "undefined" || !streamBodies()) return;
  installed = true;
  const realFetch = fetch.bind(globalThis);
  const owners = new Map();      // 分段檔名 → 屬於哪個資源 { key, size }
  const received = new Map();    // 分段檔名 → 收到幾個位元組(同一段重抓就從 0 算,斷線重試不會灌水)
  const startedKeys = new Map(); // 開始抓的資源 → 大小
  let baseline = 0;
  let lastSent = 0;
  let active = 0;
  const queue = [];
  const acquire = () => (active < MAX_PARALLEL ? (active += 1, Promise.resolve()) : new Promise((resolve) => queue.push(resolve)));
  const release = () => { const next = queue.shift(); if (next) next(); else active -= 1; };
  const total = () => Math.max(baseline, [...startedKeys.values()].reduce((sum, size) => sum + size, 0));
  const loaded = () => [...received.values()].reduce((sum, bytes) => sum + bytes, 0);
  resetHook = () => { received.clear(); lastSent = 0; };
  const send = (force) => {
    const now = Date.now();
    if (!force && now - lastSent < 250) return;
    lastSent = now;
    report(loaded(), total());
  };

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || String(input);
    if (!isModelHost(url)) return realFetch(input, init);
    if (url.endsWith("resources.json")) {
      const response = await realFetch(input, init);
      if (!response.ok) return response;
      try {
        const map = await response.clone().json();
        for (const [key, entry] of Object.entries(map)) for (const chunk of entry.chunks || []) owners.set(chunk.name, { key, size: entry.size });
        baseline = baseline || (map[MODEL]?.size || 0) + (map[RUNTIME]?.size || 0);
      } catch { /* 讀不到清單就只報已下載量 */ }
      return response;
    }
    // 模型分段:排隊,輪到才真的抓;這段收完、出錯或被取消都讓出位子
    await acquire();
    let released = false;
    const done = () => { if (!released) { released = true; release(); } };
    let response;
    try { response = await realFetch(input, init); } catch (error) { done(); throw error; }
    if (!response.ok || !response.body) { done(); return response; }
    const name = url.slice(url.lastIndexOf("/") + 1);
    const owner = owners.get(name);
    if (owner) startedKeys.set(owner.key, owner.size);
    received.set(name, 0);
    const reader = response.body.getReader();
    const counted = new ReadableStream({
      async pull(controller) {
        let chunk;
        try { chunk = await reader.read(); } catch (error) { done(); controller.error(error); return; }
        if (chunk.done) { done(); send(true); controller.close(); return; }
        received.set(name, (received.get(name) || 0) + chunk.value.byteLength);
        send(false);
        controller.enqueue(chunk.value);
      },
      cancel(reason) { done(); return reader.cancel(reason); },
    });
    return new Response(counted, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}
