/**
 * The notification sounds — synthesised, no audio file. `chime` (a bright rising
 * three-note "ding") is for team chat; `alert` (a falling "ding-dong", twice) is
 * for everything else that needs the person — see the bottom of this file.
 *
 * ── Why not an mp3 ──────────────────────────────────────────────────────────
 * A file means a network fetch that can fail, a decode, a binary in the repo
 * and a licence to worry about (the chimes of Google Chat, Slack and the like
 * belong to those companies). Oscillators start instantly and cannot 404.
 *
 * ── Why it may be silent the first time ─────────────────────────────────────
 * Every browser refuses to play audio until the person has interacted with the
 * page — a rule that exists because of autoplaying adverts, and one no site can
 * opt out of. So the context is created on the FIRST user gesture (see `arm`)
 * and is merely resumed later. Until that gesture the badge is the only signal,
 * which is why the badge, not the sound, is the thing the bell relies on.
 *
 * ── Why it sounds the way it does ───────────────────────────────────────────
 * The first version was two pure sine tones at ~7% volume: polite, but lost on
 * a laptop speaker in a busy office, so people missed new work. This one is
 * what messaging apps do — a quick rising arpeggio (A5 → C#6 → E6, a major
 * chord, which reads as "something arrived", not "something is wrong") with a
 * bell-like timbre: each note is a sine plus a quieter octave and a faint
 * twelfth, struck fast and decaying naturally. Loud, but through a limiter
 * (DynamicsCompressor) so overlapping notes never clip or crackle. Still
 * mutable from the bell — see `muted`.
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

/** Overall loudness (0–1) after the limiter. */
export const CHIME_VOLUME = 0.9;

/**
 * Where notes go: a limiter feeding a volume control feeding the speakers.
 * Built once per audio context.
 */
let bus: AudioNode | null = null;
function output(): AudioNode | null {
  if (!ctx) return null;
  if (!bus) {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    const volume = ctx.createGain();
    volume.gain.value = CHIME_VOLUME;
    limiter.connect(volume).connect(ctx.destination);
    bus = limiter;
  }
  return bus;
}

/** One partial of a note: a sine with a fast strike and a natural decay. */
function partial(at: number, hz: number, seconds: number, peak: number, dest: AudioNode, wave: OscillatorType = 'sine'): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = wave;
  osc.frequency.value = hz;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  osc.connect(gain).connect(dest);
  osc.start(at);
  osc.stop(at + seconds + 0.03);
}

/** One bell-like note: fundamental, octave and a faint twelfth. */
function note(at: number, hz: number, seconds: number, peak: number, wave: OscillatorType = 'sine'): void {
  const dest = output();
  if (!dest) return;
  partial(at, hz, seconds, peak, dest, wave);
  partial(at, hz * 2, seconds * 0.6, peak * 0.35, dest);
  partial(at, hz * 3, seconds * 0.35, peak * 0.12, dest);
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
    const t = ctx.currentTime + 0.01;
    // A5 → C#6 → E6: a quick rising major arpeggio, the last note left to ring.
    note(t, 880.0, 0.22, 0.5);
    note(t + 0.09, 1108.73, 0.22, 0.5);
    note(t + 0.18, 1318.51, 0.55, 0.55);
  } catch {
    // Nothing here is worth an error boundary.
  }
}

/**
 * The OTHER sound: new work (a payment to approve or pay, an order to handle, a
 * refund) — never chat. It must be told apart from the chat chime without
 * looking, so it differs in every way the ear uses:
 *   • it FALLS (B5 → G5, a "ding-dong") where the chat chime rises;
 *   • it is played TWICE, like a doorbell, where the chat chime plays once;
 *   • its notes are fuller (a triangle wave, not a pure sine) and lower.
 * Same limiter and volume as the chime, same mute switch, same rules about the
 * first user gesture; never throws.
 */
export function alert(): void {
  if (muted()) return;
  try {
    arm();
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.01;
    for (const start of [t, t + 0.62]) {
      note(start, 987.77, 0.28, 0.55, 'triangle'); // B5 — "ding"
      note(start + 0.2, 783.99, 0.45, 0.55, 'triangle'); // G5 — "dong"
    }
  } catch {
    // Nothing here is worth an error boundary.
  }
}
