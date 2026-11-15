/**
 * Call sounds made with Web Audio (no audio files to load).
 *  - 'incoming': two quick rising tones, repeated — someone is calling you.
 *  - 'outgoing': a soft long tone, repeated — the other phone is ringing.
 * Browsers only play sound after the person has interacted with the page;
 * if that hasn't happened yet, this stays silent (the on-screen card and the
 * pop-up still show). Never throws.
 */
type Kind = 'incoming' | 'outgoing';

let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function tone(freq: number, start: number, length: number, volume: number) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.02);
  gain.gain.setValueAtTime(volume, start + length - 0.05);
  gain.gain.linearRampToValueAtTime(0, start + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + length + 0.01);
}

function pattern(kind: Kind) {
  if (!ctx) return;
  const t = ctx.currentTime + 0.01;
  if (kind === 'incoming') {
    tone(660, t, 0.18, 0.18);
    tone(880, t + 0.22, 0.18, 0.18);
    tone(660, t + 0.6, 0.18, 0.18);
    tone(880, t + 0.82, 0.18, 0.18);
  } else {
    tone(440, t, 1.0, 0.06);
  }
}

export function startRingtone(kind: Kind) {
  stopRingtone();
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    void ctx.resume().catch(() => {});
    pattern(kind);
    timer = setInterval(() => pattern(kind), kind === 'incoming' ? 2500 : 3000);
  } catch {
    stopRingtone();
  }
}

export function stopRingtone() {
  if (timer) clearInterval(timer);
  timer = null;
}
