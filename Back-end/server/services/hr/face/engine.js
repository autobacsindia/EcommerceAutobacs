/**
 * The face model, behind one small interface so the attendance code never knows
 * which model runs — and tests use a deterministic fake.
 *
 *   engine.version                 string, stored with every template
 *   engine.cosineThreshold         the model's recommended match cut-off
 *   await engine.analyze(buffer) → {
 *     faceCount,                   faces found
 *     face: { score, box: {x,y,w,h}, landmarks: [[x,y] ×5], embedding: Float32Array } | null
 *                                  (the largest face; embedding only when faceCount === 1)
 *     width, height,
 *   }
 *
 * Runs on OUR server (docs/ADR-hr-system.md: no outside face API). The real
 * engine (engines/onnxEngine.js) is imported lazily on the first face request,
 * so a server that never sees a face never loads the model.
 *
 * HR_FACE_ENGINE=fake selects the fake engine (tests / local dev without the
 * model files); anything else is the ONNX engine.
 */
import AppError from '../../../utils/AppError.js';

let enginePromise = null;
let override = null;

export async function getFaceEngine() {
  if (override) return override;
  if (!enginePromise) {
    enginePromise = (async () => {
      if (process.env.HR_FACE_ENGINE === 'fake') return (await import('./engines/fakeEngine.js')).default;
      const { createOnnxEngine } = await import('./engines/onnxEngine.js');
      return createOnnxEngine();
    })().catch((err) => {
      enginePromise = null; // let the next request retry (e.g. model files fetched since)
      console.error('[hr-face] face engine failed to load:', err.message);
      throw new AppError('The face check is not available right now. Please tell HR.', 503, { expose: true });
    });
  }
  return enginePromise;
}

/** Tests: use this engine instead (null restores the default). */
export function setFaceEngine(engine) {
  override = engine;
}
