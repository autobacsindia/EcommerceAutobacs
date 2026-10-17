/**
 * The notification chime — two soft notes, synthesised, no audio file.
 *
 * ── Why not an mp3 ──────────────────────────────────────────────────────────
 * A file means a network fetch that can fail, a decode, a binary in the repo
 * and a licence to worry about, all for 150ms of sound. Two oscillators cost
 * nothing, start instantly, and cannot 404.
 *
 * ── Why it may be silent the first time ─────────────────────────────────────
 * Every browser refuses to play audio until the person has interacted with the
 * page — a rule that exists because of autoplaying adverts, and one no site can
 * opt out of. So the context is created on the FIRST user gesture (see `arm`)
 * and is merely resumed later. Until that gesture the badge is the only signal,
 * which is why the badge, not the sound, is the thing the bell relies on.
 *
 * ── Why it is quiet ─────────────────────────────────────────────────────────
 * This fires in an office, on someone else's machine, possibly often. A chime
 * people reach to disable is worse than no chime, so it is short, soft, and
 * mutable — see `muted`.
 */

const MUTE_KEY = 'roavion-notify-muted';

let ctx: AudioContext | null = null;

/** Is the chime switched off for this person? Browser storage may refuse. */
export function muted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMuted(value: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // Private mode: the choice lasts for this page, which is the best on offer.
  }
}

/**
 * Create the audio context on a real user gesture, so later chimes can play.
 *
 * Safe to call on every click: it builds the context once, and resumes it when
 * the browser has suspended it (which it does on a backgrounded tab).
 */
export function arm(): void {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    // No Web Audio (old browser, or blocked): the badge still works.
  }
}

/** One note of the chime. */
function note(at: number, hz: number, seconds: number, peak: number): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  // A sine with a soft envelope: a square or a hard start reads as an ALARM,
  // and this is "someone needs you", not "something is wrong".
  osc.type = 'sine';
  osc.frequency.value = hz;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + seconds + 0.02);
}

/**
 * Play it. Does nothing when muted, when audio was never armed by a gesture,
 * or when the browser has no Web Audio — never throws, because a failed chime
 * must not break the render that asked for it.
 */
export function chime(): void {
  if (muted()) return;
  try {
    arm();
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    // A rising fifth: C6 then G6. Short, and clearly "a thing arrived".
    note(t, 1046.5, 0.12, 0.07);
    note(t + 0.1, 1568.0, 0.16, 0.055);
  } catch {
    // Nothing here is worth an error boundary.
  }
}
