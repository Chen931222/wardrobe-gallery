// tools/D-diag.mjs <seg.png> <src.JPG> <outprefix> — 只用 sharp。傾印 bin/core/region/k 四張圖。
import sharp from "sharp";
const [seg, src, prefix] = process.argv.slice(2);
const LONG = 1400;
const FLOOR = 20, CEIL = 80, ERODE = 16, DILATE = 6, T0 = 0.13, T1 = 0.24;

const rgbBuf = await sharp(src).rotate().resize({ height: LONG, fit: "inside" }).removeAlpha().toBuffer();
const { data: px, info } = await sharp(rgbBuf).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels, N = W * H;

const kb = Buffer.alloc(N);
for (let p = 0; p < N; p++) {
  const i = p * C, r = px[i], g = px[i + 1], b = px[i + 2];
  const L = Math.max(12, (r + g + b) / 3);
  const bs = ((r + g) / 2 - b) / L;
  kb[p] = Math.round(255 * Math.min(1, Math.max(0, (bs - T0) / (T1 - T0))));
}

const a = await sharp(seg).ensureAlpha().extractChannel("alpha")
  .resize(W, H, { fit: "fill", kernel: "cubic" }).raw().toBuffer();
const bin = new Uint8Array(N);
for (let p = 0; p < N; p++) bin[p] = ((a[p] - FLOOR) / (CEIL - FLOOR)) > 0.5 ? 1 : 0;

// largest component
const lab = new Int32Array(N).fill(-1), stack = new Int32Array(N);
let best = -1, bestSize = 0, cur = 0;
for (let s = 0; s < N; s++) {
  if (bin[s] === 0 || lab[s] !== -1) continue;
  let sp = 0, size = 0; stack[sp++] = s; lab[s] = cur;
  while (sp > 0) { const p = stack[--sp]; size++; const x = p % W, y = (p / W) | 0;
    if (x > 0 && bin[p-1] && lab[p-1]===-1){lab[p-1]=cur;stack[sp++]=p-1;}
    if (x < W-1 && bin[p+1] && lab[p+1]===-1){lab[p+1]=cur;stack[sp++]=p+1;}
    if (y > 0 && bin[p-W] && lab[p-W]===-1){lab[p-W]=cur;stack[sp++]=p-W;}
    if (y < H-1 && bin[p+W] && lab[p+W]===-1){lab[p+W]=cur;stack[sp++]=p+W;} }
  if (size > bestSize){bestSize=size;best=cur;} cur++;
}
const binLC = new Uint8Array(N);
for (let p = 0; p < N; p++) binLC[p] = (bin[p] && lab[p]===best) ? 1 : 0;

// fill holes
const filled = binLC.slice();
{ const seen = new Uint8Array(N), st = new Int32Array(N); let sp=0;
  const push=(p)=>{if(!seen[p]&&filled[p]===0){seen[p]=1;st[sp++]=p;}};
  for(let x=0;x<W;x++){push(x);push((H-1)*W+x);} for(let y=0;y<H;y++){push(y*W);push(y*W+W-1);}
  while(sp>0){const p=st[--sp];const x=p%W,y=(p/W)|0;
    if(x>0)push(p-1);if(x<W-1)push(p+1);if(y>0)push(p-W);if(y<H-1)push(p+W);}
  for(let p=0;p<N;p++)if(filled[p]===0&&!seen[p])filled[p]=1; }

const toImg = (arr, name, mul = 255) =>
  sharp(Buffer.from(arr.map ? arr : arr, arr instanceof Uint8Array ? undefined : undefined),
    { raw: { width: W, height: H, channels: 1 } });

const u8 = (arr) => { const b = Buffer.alloc(N); for (let p=0;p<N;p++) b[p]=arr[p]?255:0; return b; };
await sharp(a.length===N?a:a, { raw:{width:W,height:H,channels:1} }).jpeg().toFile(`${prefix}-alpha.jpg`);
await sharp(u8(bin), { raw:{width:W,height:H,channels:1} }).jpeg().toFile(`${prefix}-bin.jpg`);
await sharp(u8(binLC), { raw:{width:W,height:H,channels:1} }).jpeg().toFile(`${prefix}-binLC.jpg`);
await sharp(u8(filled), { raw:{width:W,height:H,channels:1} }).jpeg().toFile(`${prefix}-filled.jpg`);
await sharp(kb, { raw:{width:W,height:H,channels:1} }).jpeg().toFile(`${prefix}-k.jpg`);
console.log(JSON.stringify({W,H,largestPct:+(100*bestSize/N).toFixed(1)}));
