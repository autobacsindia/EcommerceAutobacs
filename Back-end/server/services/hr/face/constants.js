/**
 * Face attendance constants. The consent TEXT lives in the app; this is the
 * version the app must send back, so a changed text forces a fresh consent.
 */
export const FACE_CONSENT_VERSION = '2026-11-v1';

/** Liveness challenge actions the server can verify from landmarks alone. */
export const CHALLENGE_ACTIONS = Object.freeze(['turn_left', 'turn_right', 'move_closer']);
export const CHALLENGE_PURPOSES = Object.freeze(['punch', 'enrol', 'offline']);
/** Online challenges live 2 minutes; an "offline" one is fetched ahead and lives as long as an offline punch may be. */
export const CHALLENGE_TTL_SECONDS = 120;

export const MIN_FRAMES = 2;
export const MAX_FRAMES = 3;
export const MAX_FRAME_BYTES = 1.5 * 1024 * 1024;

/**
 * Score shown to HR and compared with HrSettings.faceMatchThreshold. Engines
 * produce a raw cosine similarity whose sensible cut-off differs per model; the
 * score maps the engine's recommended cut-off to SCORE_ANCHOR, so the HR setting
 * keeps its meaning ("0.6 = the model's recommended strictness") across models.
 */
export const SCORE_ANCHOR = 0.6;
/** Later liveness frames (head turned) are compared with the first frame at this lower bar. */
export const CONSISTENCY_MARGIN = 0.1;
/** How long accepted frames' hashes are remembered to refuse a replay of the same pictures. */
export const FRAME_REPLAY_TTL_SECONDS = 48 * 3600;
