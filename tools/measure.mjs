// tools/measure.mjs <png...> — 客觀評分去背成品,並輸出洋紅底檢查圖供目視
import sharp from "sharp";
for (const f of process.argv.slice(2)) {
  const img = sharp(f);
  const { width: w, height: h } = await img.metadata();
  const { data } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaque = 0, partial = 0, clear = 0;
  const total = w * h;
  for (let i = 0; i < total; i++) {
    const a = data[i * 4 + 3];
    if (a > 240) opaque++; else if (a > 25) partial++; else clear++;
  }
  const op = 100 * opaque / total, pa = 100 * partial / total;
  // 鬼影判準:實心比例太低,或半透明多到接近實心
  const ghost = op < 25 || pa > op * 0.5;
  const check = f.replace(/\.png$/, "-check.jpg");
  // 注意:composite 的 input 要用「已編碼」的 buffer,直接 toBuffer() 拿到的是原格式沒問題,
  // 但 sharp 實例重複消費會出錯,所以重新讀檔。
  await sharp({ create: { width: w, height: h, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } } })
    .composite([{ input: await sharp(f).png().toBuffer() }]).jpeg({ quality: 88 }).toFile(check);
  console.log(JSON.stringify({ file: f, opaquePct: +op.toFixed(1), partialPct: +pa.toFixed(1), clearPct: +(100*clear/total).toFixed(1), verdict: ghost ? "GHOST" : "SOLID", checkImage: check }));
}
