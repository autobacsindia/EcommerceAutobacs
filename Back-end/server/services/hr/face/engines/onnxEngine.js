/**
 * The real face engine: self-hosted ONNX models run IN THIS PROCESS by
 * onnxruntime-web's WebAssembly backend. No outside face API, no native binary.
 *
 * Why WASM and not onnxruntime-node: the backend image is node:20-ALPINE (musl).
 * onnxruntime-node ships glibc binaries (≈300 MB unpacked for every platform)
 * that do not load on Alpine; the WASM build runs anywhere Node runs.
 *
 * Models (OpenCV Model Zoo, both licensed for commercial use):
 *   - YuNet face detector (face_detection_yunet_2023mar.onnx, MIT, ~0.2 MB):
 *     faces + 5 landmarks (eyes, nose, mouth corners).
 *   - SFace recogniser (face_recognition_sface_2021dec.onnx, Apache-2.0, ~37 MB):
 *     a 128-number embedding of a face aligned to 112×112. Recommended cosine
 *     match cut-off 0.363 (OpenCV's published value).
 * InsightFace's ArcFace/MobileFaceNet weights were NOT used: their licence is
 * non-commercial research only.
 *
 * Files come from scripts/fetch-face-models.js (pinned URLs + SHA-256) into
 * HR_FACE_MODEL_DIR (default <server>/ml-models/face). Loaded ONCE, lazily, on
 * the first face request (services/hr/face/engine.js).
 */
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MODEL_DIR = path.resolve(here, '../../../../ml-models/face');
export const DETECTOR_FILE = 'face_detection_yunet_2023mar.onnx';
export const RECOGNISER_FILE = 'face_recognition_sface_2021dec.onnx';

const DET_SIZE = 640;              // detector input (letterboxed square)
const STRIDES = [8, 16, 32];
const SCORE_MIN = 0.7;
const NMS_IOU = 0.3;
const ALIGN = 112;
// SFace / ArcFace 112×112 alignment template (eyes, nose, mouth corners).
const DST = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];

/** Decode an image to RGB, EXIF-rotated, fitted inside DET_SIZE. */
async function decode(buffer) {
  const { data, info } = await sharp(buffer, { failOn: 'error' })
    .rotate()
    .resize({ width: DET_SIZE, height: DET_SIZE, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { rgb: data, width: info.width, height: info.height };
}

/** Letterboxed BGR NCHW float tensor data for YuNet (0–255, no normalisation). */
function detectorInput({ rgb, width, height }) {
  const plane = DET_SIZE * DET_SIZE;
  const out = new Float32Array(3 * plane);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const s = (y * width + x) * 3;
      const d = y * DET_SIZE + x;
      out[d] = rgb[s + 2]; // B
      out[plane + d] = rgb[s + 1]; // G
      out[2 * plane + d] = rgb[s]; // R
    }
  }
  return out;
}

const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x); const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w); const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

/** YuNet output decoding (as OpenCV's FaceDetectorYN does it). */
export function decodeDetections(outputs, { width, height }) {
  const faces = [];
  for (const stride of STRIDES) {
    const cls = outputs[`cls_${stride}`].data;
    const obj = outputs[`obj_${stride}`].data;
    const bbox = outputs[`bbox_${stride}`].data;
    const kps = outputs[`kps_${stride}`].data;
    const cols = DET_SIZE / stride;
    const rows = DET_SIZE / stride;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c;
        const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
        if (score < SCORE_MIN) continue;
        const cx = (c + bbox[i * 4]) * stride;
        const cy = (r + bbox[i * 4 + 1]) * stride;
        const w = Math.exp(bbox[i * 4 + 2]) * stride;
        const h = Math.exp(bbox[i * 4 + 3]) * stride;
        const landmarks = [];
        for (let k = 0; k < 5; k += 1) landmarks.push([(kps[i * 10 + 2 * k] + c) * stride, (kps[i * 10 + 2 * k + 1] + r) * stride]);
        faces.push({ score, box: { x: cx - w / 2, y: cy - h / 2, w, h }, landmarks });
      }
    }
  }
  faces.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const f of faces) if (kept.every((k) => iou(k.box, f.box) < NMS_IOU)) kept.push(f);
  // Inside the real image (the letterbox padding has no faces).
  return kept.filter((f) => f.box.x + f.box.w / 2 < width && f.box.y + f.box.h / 2 < height);
}

/**
 * Least-squares similarity transform (Umeyama) mapping `src` points onto `dst`:
 * returns [a, b, tx, ty] for  x' = a·x − b·y + tx,  y' = b·x + a·y + ty.
 */
export function similarityTransform(src, dst) {
  const n = src.length;
  let sx = 0; let sy = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < n; i += 1) { sx += src[i][0]; sy += src[i][1]; dx += dst[i][0]; dy += dst[i][1]; }
  sx /= n; sy /= n; dx /= n; dy /= n;
  let num1 = 0; let num2 = 0; let den = 0;
  for (let i = 0; i < n; i += 1) {
    const x = src[i][0] - sx; const y = src[i][1] - sy;
    const u = dst[i][0] - dx; const v = dst[i][1] - dy;
    num1 += x * u + y * v;
    num2 += x * v - y * u;
    den += x * x + y * y;
  }
  const a = num1 / (den || 1);
  const b = num2 / (den || 1);
  return [a, b, dx - (a * sx - b * sy), dy - (b * sx + a * sy)];
}

/** 112×112 aligned face as RGB NCHW float (0–255), bilinear-sampled. */
export function alignedInput({ rgb, width, height }, landmarks) {
  const [a, b, tx, ty] = similarityTransform(landmarks, DST);
  const det = a * a + b * b || 1;
  const plane = ALIGN * ALIGN;
  const out = new Float32Array(3 * plane);
  for (let v = 0; v < ALIGN; v += 1) {
    for (let u = 0; u < ALIGN; u += 1) {
      // Inverse of the similarity transform.
      const px = u - tx; const py = v - ty;
      const x = (a * px + b * py) / det;
      const y = (-b * px + a * py) / det;
      const x0 = Math.floor(x); const y0 = Math.floor(y);
      const fx = x - x0; const fy = y - y0;
      const d = v * ALIGN + u;
      for (let ch = 0; ch < 3; ch += 1) {
        const at = (xx, yy) => (xx >= 0 && yy >= 0 && xx < width && yy < height ? rgb[(yy * width + xx) * 3 + ch] : 0);
        const val = at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy)
          + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
        out[ch * plane + d] = val;
      }
    }
  }
  return out;
}

export async function createOnnxEngine({ modelDir = process.env.HR_FACE_MODEL_DIR || DEFAULT_MODEL_DIR } = {}) {
  const ort = await import('onnxruntime-web');
  ort.env.wasm.numThreads = 1; // predictable memory on Railway; a punch is one face
  ort.env.logLevel = 'error';
  const load = async (file) => {
    const bytes = await fs.readFile(path.join(modelDir, file)).catch(() => {
      throw new Error(`Face model ${file} is missing in ${modelDir}. Run: node scripts/fetch-face-models.js`);
    });
    return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  };
  const detector = await load(DETECTOR_FILE);
  const recogniser = await load(RECOGNISER_FILE);
  const detInput = detector.inputNames[0];
  const recInput = recogniser.inputNames[0];
  const recOutput = recogniser.outputNames[0];

  // One inference at a time: WASM is single-threaded per session and the
  // sessions are shared; queueing keeps memory flat under a burst.
  let chain = Promise.resolve();
  const serial = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

  return {
    version: 'yunet2023mar+sface2021dec',
    cosineThreshold: 0.363,
    analyze: (buffer) => serial(async () => {
      const img = await decode(buffer);
      const det = await detector.run({ [detInput]: new ort.Tensor('float32', detectorInput(img), [1, 3, DET_SIZE, DET_SIZE]) });
      const faces = decodeDetections(det, img);
      if (!faces.length) return { faceCount: 0, face: null, width: img.width, height: img.height };
      const face = faces.reduce((m, f) => (f.box.w * f.box.h > m.box.w * m.box.h ? f : m));
      let embedding = null;
      if (faces.length === 1) {
        const rec = await recogniser.run({ [recInput]: new ort.Tensor('float32', alignedInput(img, face.landmarks), [1, 3, ALIGN, ALIGN]) });
        const raw = rec[recOutput].data;
        const norm = Math.hypot(...raw) || 1;
        embedding = Float32Array.from(raw, (x) => x / norm);
      }
      return { faceCount: faces.length, face: { ...face, embedding }, width: img.width, height: img.height };
    }),
  };
}
