#!/usr/bin/env node
/**
 * Fetch the self-hosted face models used by HR attendance
 * (services/hr/face/engines/onnxEngine.js) into HR_FACE_MODEL_DIR
 * (default Back-end/server/ml-models/face, git-ignored).
 *
 * URLs are pinned to an exact opencv_zoo commit AND checked against a SHA-256,
 * so a changed or tampered upstream file is refused instead of silently loaded.
 * Idempotent: a file already present with the right hash is skipped. Writes to a
 * temp file and renames, so a half-downloaded model is never left in place.
 *
 * Licences: YuNet — MIT; SFace — Apache-2.0 (both allow commercial use).
 *
 * Usage:  node scripts/fetch-face-models.js            (fetch / verify)
 *         node scripts/fetch-face-models.js --check    (verify only; exit 1 if missing/wrong)
 * Touches no database.
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.HR_FACE_MODEL_DIR || path.resolve(here, '../ml-models/face');
const ZOO = 'https://github.com/opencv/opencv_zoo/raw';

export const FACE_MODELS = Object.freeze([
  {
    file: 'face_detection_yunet_2023mar.onnx',
    url: `${ZOO}/f12e12798e8314f7c074a6656816c048dcc95b7a/models/face_detection_yunet/face_detection_yunet_2023mar.onnx`,
    sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
    bytes: 232589,
  },
  {
    file: 'face_recognition_sface_2021dec.onnx',
    url: `${ZOO}/ba91a3b91d00d76e86540d4013f944bd6b514e39/models/face_recognition_sface/face_recognition_sface_2021dec.onnx`,
    sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
    bytes: 38696353,
  },
]);

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function present(m) {
  try { return sha(await fs.readFile(path.join(DIR, m.file))) === m.sha256; } catch { return false; }
}

async function fetchOne(m) {
  const res = await fetch(m.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${m.file}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha(buf);
  if (got !== m.sha256) throw new Error(`${m.file}: SHA-256 mismatch (got ${got}) — refusing to install it`);
  const tmp = path.join(DIR, `.${m.file}.${process.pid}.tmp`);
  await fs.writeFile(tmp, buf);
  await fs.rename(tmp, path.join(DIR, m.file));
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  await fs.mkdir(DIR, { recursive: true });
  let bad = 0;
  for (const m of FACE_MODELS) {
    if (await present(m)) { console.log(`ok       ${m.file}`); continue; }
    if (checkOnly) { console.error(`MISSING  ${m.file}`); bad += 1; continue; }
    console.log(`fetching ${m.file} (${(m.bytes / 1e6).toFixed(1)} MB)…`);
    await fetchOne(m);
    console.log(`ok       ${m.file}`);
  }
  if (bad) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
