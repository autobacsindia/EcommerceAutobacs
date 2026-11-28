/**
 * Server-side checks on the liveness evidence (pure functions).
 *
 * The app runs an ACTIVE random challenge (turn left / turn right / move closer)
 * that the SERVER chose and will accept once. It sends 2–3 frames: the first
 * looking straight at the camera, the last after doing the action. The server
 * re-checks what it can see in the frames themselves:
 *
 *   - every frame has exactly one face, and the frames are not identical bytes;
 *   - the head moved the way the challenge asked (nose position between the eyes
 *     for a turn, face size for "closer");
 *   - every frame is the SAME person (embeddings agree), so a live person can't
 *     do the challenge and then swap in a photo for the matched frame.
 *
 * Frames are expected as the camera captured them (NOT mirrored like a selfie
 * preview); the app says `mirrored: true` if it sends mirrored frames.
 */
/** Normalised yaw: nose x offset from the eye midpoint, in eye-distance units. + = towards image right. */
export function yawOf(landmarks) {
  const [re, le, nose] = landmarks;
  const eyeDist = Math.hypot(le[0] - re[0], le[1] - re[1]) || 1;
  return (nose[0] - (re[0] + le[0]) / 2) / eyeDist;
}

export const TURN_MIN_DELTA = 0.15;
export const FRONTAL_MAX_YAW = 0.25;
export const CLOSER_MIN_RATIO = 1.15;

/**
 * Did the head do `action` between the first and the last analysed frame?
 * The person's left is the image's right in an unmirrored frame.
 */
export function motionMatches(action, first, last, { mirrored = false } = {}) {
  if (action === 'move_closer') return last.box.w / (first.box.w || 1) >= CLOSER_MIN_RATIO;
  const delta = (yawOf(last.landmarks) - yawOf(first.landmarks)) * (mirrored ? -1 : 1);
  if (action === 'turn_left') return delta >= TURN_MIN_DELTA;
  if (action === 'turn_right') return delta <= -TURN_MIN_DELTA;
  return false;
}

export const cosine = (a, b) => {
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/**
 * Map a raw cosine to the 0–1 score HR sees: the engine's recommended cut-off
 * lands on `anchor`, monotonic, -1 → 0 and 1 → 1.
 */
export function scoreOf(cos, engineThreshold, anchor) {
  const c = Math.max(-1, Math.min(1, cos));
  const t = engineThreshold;
  const s = c <= t ? (anchor * (c + 1)) / (t + 1) : anchor + ((1 - anchor) * (c - t)) / (1 - t);
  return Math.round(s * 1000) / 1000;
}
