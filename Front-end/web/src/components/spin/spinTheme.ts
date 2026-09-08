/**
 * Obsidian + gold palette for the reward wheel and its surrounding card.
 *
 * ── Why these are literals and not `var(--gold)` ─────────────────────────────
 * The home hero's wheel reads `var(--gold)` because it lives inside `.hr`, and the
 * whole token block in `home-redesign.css` is scoped to that class. This wheel renders
 * on `/order/[orderId]/success`, which is NOT inside `.hr`, so those custom properties
 * simply do not resolve there.
 *
 * That failure is silent and ugly: an SVG `fill="var(--gold)"` that resolves to nothing
 * falls back to the initial value — black — so the needle would paint black-on-black and
 * vanish, with no error anywhere. Hence hex, mirrored from the `.hr` block by hand.
 * `spinTheme.test.ts` pins them to the values in that stylesheet so the two cannot drift.
 *
 * Tailwind classes in SpinSection use the same hex inline rather than importing from
 * here — arbitrary values like `text-[#c9a870]` must be literal in the source for the
 * JIT scanner to emit them at all, and a class built from a TS constant produces no CSS.
 */

/** Brand gold. `--gold` in the `.hr` token block. */
export const GOLD = '#c9a870';
/** Lifted gold for a highlight edge against the flat gold fill. */
export const GOLD_BRIGHT = '#e8cfa0';
/** Hairline gold, for wedge separators and the bezel. Matches the poster's dial. */
export const GOLD_HAIRLINE = 'rgba(201, 168, 112, 0.22)';
/** Fainter still — the outer bezel ring. */
export const GOLD_FAINT = 'rgba(201, 168, 112, 0.16)';
/** Tick marks: majors read, minors recede. */
export const TICK_MAJOR = 'rgba(201, 168, 112, 0.55)';
export const TICK_MINOR = 'rgba(201, 168, 112, 0.25)';

/** Dial face + hub. `--bg2`-ish, deliberately darker than the card behind it. */
export const OBSIDIAN = '#0b0b0b';
/** The two alternating wedge fills, straight from the poster dial. */
export const WEDGE_A = '#121212';
export const WEDGE_B = '#191919';
/** Icon badge ground on an unlit wedge. */
export const BADGE_GROUND = '#131313';

/** `--text` in the `.hr` block. Clears AA on both wedge fills at 11px. */
export const TEXT = '#f0ede7';
/** Ink for text sitting ON the gold winner wedge. */
export const TEXT_ON_GOLD = '#1a1205';
