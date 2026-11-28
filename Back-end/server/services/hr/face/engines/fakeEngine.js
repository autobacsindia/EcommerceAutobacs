/**
 * Deterministic stand-in for the face model, for tests and local development
 * without model files (HR_FACE_ENGINE=fake). NEVER real faces: a "frame" is a
 * JPEG/PNG magic header followed by `FAKEFACE` and a JSON description:
 *
 *   { faces: 1, emb: [..numbers..], yaw: 0, size: 200 }
 *
 * `emb` is returned (normalised) as the embedding, `yaw` places the nose between
 * the eyes, `size` is the face box width. `fakeFrame()` builds one.
 */
const MARKER = Buffer.from('FAKEFACE');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

export function fakeFrame({ faces = 1, emb = [1, 0, 0, 0], yaw = 0, size = 200, nonce = Math.random() } = {}) {
  return Buffer.concat([JPEG, MARKER, Buffer.from(JSON.stringify({ faces, emb, yaw, size, nonce }))]);
}

function parse(buffer) {
  const i = buffer.indexOf(MARKER);
  if (i < 0) return null;
  try { return JSON.parse(buffer.subarray(i + MARKER.length).toString()); } catch { return null; }
}

const fakeEngine = {
  version: 'fake-v1',
  cosineThreshold: 0.5,
  async analyze(buffer) {
    const d = parse(buffer);
    if (!d || !d.faces) return { faceCount: 0, face: null, width: 640, height: 480 };
    const size = Number(d.size) || 200;
    const cx = 320;
    const eyeDx = size * 0.3;
    const yaw = Number(d.yaw) || 0;
    const landmarks = [
      [cx - eyeDx / 2, 200], [cx + eyeDx / 2, 200], [cx + yaw * eyeDx, 230], [cx - eyeDx / 2.5, 260], [cx + eyeDx / 2.5, 260],
    ];
    const v = Float32Array.from(d.emb || []);
    const norm = Math.hypot(...v) || 1;
    return {
      faceCount: d.faces,
      face: {
        score: 0.99,
        box: { x: cx - size / 2, y: 120, w: size, h: size * 1.2 },
        landmarks,
        embedding: d.faces === 1 ? v.map((x) => x / norm) : null,
      },
      width: 640,
      height: 480,
    };
  },
};

export default fakeEngine;
