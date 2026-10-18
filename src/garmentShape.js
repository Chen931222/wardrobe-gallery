// [本 fork 新增] 從去背圖的透明度量出一件衣服的「身形」(2026-10-18)。
// 搭配頁以前把整張照片 contain 進固定的槽位框:照片拍得遠、透明邊多,衣服就小;長袖攤開、照片比較寬,身體就被壓窄;
// 實測 104 件(tools/measure-shapes.mjs,2026-10-18,用最後這版量法):舊版畫出來的上衣身寬 54–89、外套 78–104、褲子腰寬 29–62 人台單位,
// 同一類差到快兩倍;新版同一類畫成同一個寬。
// 這裡量每類最不受拍法影響的那個尺寸,人台再用同一把尺放大縮小(src/dollLayout.js):
//   上衣、襯衫、外套:下擺上面那一段的「身寬」;從上往下第一排夠寬的地方當「肩線」(帽T 的帽子不算肩)
//   褲子、裙子:最上面那一截裡最寬的那段當「腰寬」(抽繩、褲耳翹在上面不算),那一排當「腰線」
//   鞋:一雙俯拍的「鞋長」(外框高)
//   包:各排最長那段的寬(背帶是細線,不算)
// 瀏覽器(canvas getImageData)和 Node(sharp raw)都用這支,輸入一樣是 { data, width, height, channels }。
// 回傳的值都是比例:x 以圖寬為 1、y 以圖高為 1;key 以圖寬為 1。量不出來回 null,人台就照舊版槽位畫。

const ALPHA = 40;      // 比這個透明的像素不算衣服(去背邊緣的半透明鬼影)
const GAP = 0.035;     // 同一排裡隔不到圖寬 3.5% 的空隙當成同一塊(淺色衣服去背常有小破洞)

const median = (list) => {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const percentile = (list, p) => {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

/** 量一件衣服的身形。slot 是人台的格子(upperbody / shirt / wholebody_up / lowerbody / shoes / bag …)。 */
export function measureShape({ data, width, height, channels = 4 }, slot) {
  if (!data || !width || !height) return null;
  const solid = (x, y) => data[(y * width + x) * channels + (channels - 1)] > ALPHA;

  // 外框和質心。外框只算「夠多不透明像素」的排和欄:去背常在衣服外留下零星的淡色雜點,
  // 照片底下一片雜點會讓外框高出一大截,衣服就被畫小(灰藍大學T 第一版就是這樣)
  const rowCount = new Array(height).fill(0), colCount = new Array(width).fill(0);
  let sumX = 0, count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!solid(x, y)) continue;
      rowCount[y] += 1;
      colCount[x] += 1;
      sumX += x;
      count += 1;
    }
  }
  const minRow = Math.max(2, width * 0.02), minCol = Math.max(2, height * 0.02);
  let y0 = rowCount.findIndex((n) => n >= minRow);
  let y1 = height - 1 - [...rowCount].reverse().findIndex((n) => n >= minRow);
  let x0 = colCount.findIndex((n) => n >= minCol);
  let x1 = width - 1 - [...colCount].reverse().findIndex((n) => n >= minCol);
  if (y0 < 0 || x0 < 0 || count < 30 || x1 <= x0 || y1 <= y0) return null;
  // 衣服只佔圖的一小角(或只有幾個像素):量出來的尺寸不可信,放大會畫出比人台大十倍的框(驗收:8×8 的方塊算出 2500 寬)
  if (x1 - x0 + 1 < width * 0.1 || y1 - y0 + 1 < height * 0.1) return null;
  const cx = sumX / count;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const gap = Math.max(1, Math.round(width * GAP));

  // 某一排的每一段連續不透明;closeGaps 時把小空隙接起來
  const runsAt = (y, closeGaps = false) => {
    const runs = [];
    let start = -1;
    for (let x = x0; x <= x1 + 1; x += 1) {
      const on = x <= x1 && solid(x, y);
      if (on && start < 0) start = x;
      if (!on && start >= 0) { runs.push([start, x - 1]); start = -1; }
    }
    if (!closeGaps || runs.length < 2) return runs;
    const merged = [runs[0].slice()];
    for (const run of runs.slice(1)) {
      const last = merged[merged.length - 1];
      if (run[0] - last[1] - 1 <= gap) last[1] = run[1]; else merged.push(run.slice());
    }
    return merged;
  };
  const longest = (runs) => (runs.length ? runs.reduce((best, run) => (run[1] - run[0] > best[1] - best[0] ? run : best)) : null);
  // 包含中心的那一段;中心剛好是空的就拿離中心最近的那段
  const central = (runs, center) => {
    if (!runs.length) return null;
    return runs.find(([a, b]) => a <= center && center <= b)
      || runs.reduce((best, run) => (Math.abs((run[0] + run[1]) / 2 - center) < Math.abs((best[0] + best[1]) / 2 - center) ? run : best));
  };
  const rowsIn = (from, to) => {
    const ys = [];
    for (let y = Math.max(y0, Math.floor(y0 + bh * from)); y <= Math.min(y1, Math.ceil(y0 + bh * to)); y += 1) ys.push(y);
    return ys;
  };
  const spanAt = (y) => {
    const runs = runsAt(y);
    return runs.length ? runs[runs.length - 1][1] - runs[0][0] + 1 : 0;
  };

  let key = null, axis = cx, anchor = y0;
  if (slot === "upperbody" || slot === "shirt" || slot === "wholebody_up") {
    // 身寬:下擺上面那一段、含中心的那塊(T 恤的袖子在更上面;長袖攤開時袖子多半在兩側、隔一段空)
    const widths = [], centers = [];
    for (const y of rowsIn(0.58, 0.86)) {
      const run = central(runsAt(y, true), cx);
      if (!run) continue;
      widths.push(run[1] - run[0] + 1);
      centers.push((run[0] + run[1]) / 2);
    }
    // 袖子貼著身體垂下來時會量太寬、整件破洞很多時會量太窄:夾在外框寬的 42%~95% 之間
    key = Math.min(bw * 0.95, Math.max(bw * 0.42, median(widths) ?? bw * 0.7));
    // 長寬比把關:上衣、外套平放大約是長 1~1.8 倍寬(T 恤 70×52、帽T 連帽子 95×58)。超出就是身寬量錯了
    // (西裝外套前襟敞開、只量到半片),改用長度推回身寬
    const ratio = bh / key;
    if (ratio > 1.8) key = bh / 1.5;
    else if (ratio < 0.95) key = bh / 1.0;
    // 長袖貼著身體平放(袖子和身體之間沒有空隙):量出來的「身寬」其實是連袖子的寬,佔外框八成以上。
    // 透明度分不開袖子和身體,改用長度推:上衣身長大約是身寬的 1.3 倍(淺麻灰長袖T 第一版被畫小、肩線掉到胸口)
    if (key >= bw * 0.82) key = Math.min(key, bh / 1.3);
    axis = median(centers) ?? cx;
    // 中線離外框中心太遠(前襟敞開、只量到半片):改用外框中心,不然整件往一邊歪(西裝外套)
    if (Math.abs(axis - (x0 + x1) / 2) > bw * 0.12) axis = (x0 + x1) / 2;
    // 肩線:從上往下第一排橫跨到身寬八成的地方(T 恤一開始就是肩;帽T 的帽子比肩窄,會跳過)
    const shoulder = rowsIn(0, 0.45).find((y) => spanAt(y) >= key * 0.8);
    anchor = shoulder ?? y0;
  } else if (slot === "lowerbody") {
    // 腰寬:最上面那一截裡最寬的那段(取 90 百分位);抽繩、褲耳、標籤翹在最上面,窄,不算。
    // 那一截的高度用外框「寬」的 12% 算,不用高度:長褲的 15% 高已經到臀圍,比腰寬,量出來長褲就被畫短(第一版對照圖)
    // 褲頭歪的(黑直筒牛仔褲)太薄的一截只量到褲耳,所以至少取 8% 高
    const depth = Math.min(0.2, Math.max(0.08, (bw * 0.12) / bh));
    const rows = rowsIn(0, depth).map((y) => ({ y, run: longest(runsAt(y, true)) })).filter((row) => row.run);
    const widths = rows.map(({ run }) => run[1] - run[0] + 1);
    key = percentile(widths, 0.9);
    // 平放的褲子,腰至少有外框寬的 45%(褲管再怎麼張開也不會超過腰的兩倍多);量得更窄就是量到褲耳、標籤
    if (key) key = Math.min(bw, Math.max(bw * 0.45, key));
    if (key) {
      const waist = rows.find(({ run }) => run[1] - run[0] + 1 >= key * 0.85);
      anchor = waist ? waist.y : y0;
      const centers = rows.filter(({ run }) => run[1] - run[0] + 1 >= key * 0.85).map(({ run }) => (run[0] + run[1]) / 2);
      axis = median(centers) ?? cx;
    }
  } else if (slot === "shoes" || slot === "socks") {
    key = bh;                 // 鞋長 = 外框高(下面回傳時一樣換成「以圖寬為 1」)
    axis = (x0 + x1) / 2;
    anchor = y1 + 1;          // 鞋底
  } else {
    // 包和其他配件:各排最長那段的寬取 80 百分位(背帶、背帶圈出來的大圈都是細線,不是一整段)
    const widths = [], centers = [];
    for (const y of rowsIn(0, 1)) {
      const run = longest(runsAt(y));
      if (!run) continue;
      widths.push(run[1] - run[0] + 1);
      centers.push((run[0] + run[1]) / 2);
    }
    key = percentile(widths, 0.8);
    axis = median(centers) ?? cx;
  }
  if (!key) return null;
  return {
    bx: x0 / width, by: y0 / height, bw: bw / width, bh: bh / height,
    key: key / width,           // 這類的基準尺寸(身寬/腰寬/鞋長/包身寬),以圖寬為 1
    axis: axis / width,         // 衣服的中線 x
    anchor: anchor / height,    // 對齊用的那一排:肩線/腰線/鞋底/外框頂
    aspect: width / height,
  };
}
