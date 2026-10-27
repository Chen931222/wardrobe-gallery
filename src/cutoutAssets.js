// [本 fork 新增] 去背用的檔案放哪、哪個版本(2026-10-27)。網站(cutout.js)和準備檔案的工具(tools/prepare-cutout.mjs)共用這一份。
/* 去背 2026-10-27 起改用 Google MediaPipe 的 MagicTouch v2(model card 寫 Apache-2.0;舊的 @imgly 去背是 AGPL,
   模型的訓練資料又說不清楚能不能商用,見 work/授權盤點-2026-10-26.md 第 6 項)。
   模型和運算程式都放在這個網站自己的 /cutout/ 底下,不連到別人的服務;檔名帶版本,內容不會變,可以一直快取。 */
export const TASKS_VISION_VERSION = "1.1.0";   // 要跟 package.json 的 @mediapipe/tasks-vision 一樣(工具會檢查)
export const CUTOUT_BASE = "/cutout";
export const WASM_DIR = `${CUTOUT_BASE}/tasks-vision-${TASKS_VISION_VERSION}`;
export const MODEL_FILE = "magic-touch-v2-1.task";
export const MODEL_PATH = `${CUTOUT_BASE}/${MODEL_FILE}`;
// 官方頁(developers.google.com/edge/mediapipe/solutions/vision/interactive_segmenter)列的 v2,int8,768×768;路徑釘在版本 1
export const MODEL_SOURCE = "https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task";
export const MODEL_BYTES = 30525312;
export const MODEL_SHA256 = "38431bc66b883404e8397f74c3579404315b9b52b04a46c6346fe906a7309b03";   // 2026-10-27 第一次下載時算的
// 下載進度的分母:模型＋運算程式(有 SIMD 的版本;舊瀏覽器用 nosimd,小一點,差不多)
export const WASM_BYTES = 12997248 + 335393;
