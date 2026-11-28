/**
 * The self-contained page the showroom WebView shows: one canvas plus the bundled
 * scene script (three.js included). Nothing is fetched — it works offline and
 * cannot load anything from the network. A real car model (.glb) is handed in by
 * the app after the page asks for it (see modelChunkScripts).
 *
 * Pure: runs under `node --test`.
 */
import { SCENE_JS } from './sceneBundle.generated';

/** The garage's own dark, shown for the instant before the first picture is drawn. */
export const STAGE_BG = '#1a1b1b';

export interface ShowroomInit {
  /** Car slug (slots.ts) — picks how the scene stands that car's model. */
  car: string;
  /** The app will send a .glb for this car when the page asks; false shows the drawn sample car. */
  model: boolean;
  /** Slot keys already fitted. */
  parts: string[];
  /** Body colour, #rrggbb. */
  paint: string;
  /** Brand colour for the turntable ring, #rrggbb. */
  accent: string;
  /** No spin and no grow-in animation (the phone asks for reduced motion). */
  still: boolean;
  /** Share of the screen (0–0.8) the app's own controls cover at the top and bottom. */
  insetTop?: number;
  insetBottom?: number;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const SLOT = /^[a-z0-9-]{1,40}$/;
const share = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(0.8, Math.round(v * 1000) / 1000)) : 0);

/**
 * Everything that goes into the page is checked first and written as JSON, so
 * no value — however it got into a saved build — can become markup or script.
 */
export function showroomConfig(init: ShowroomInit) {
  return {
    car: typeof init.car === 'string' && SLOT.test(init.car) ? init.car : '',
    model: init.model === true,
    parts: init.parts.filter((k) => SLOT.test(k)),
    paint: HEX.test(init.paint) ? init.paint : '#a3151c',
    accent: HEX.test(init.accent) ? init.accent : '#0a5c33',
    still: init.still === true,
    insetTop: share(init.insetTop),
    insetBottom: share(init.insetBottom),
  };
}

/** JSON that is safe inside an inline <script>: no "</script", no "<!--". */
const inlineJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

export function showroomHtml(init: ShowroomInit): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
html,body{margin:0;padding:0;height:100%;overflow:hidden;background:${STAGE_BG};-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
canvas{display:block;width:100%;height:100%;touch-action:none;outline:none}
</style></head><body>
<canvas id="c"></canvas>
<script>window.__SHOWROOM__=${inlineJson(showroomConfig(init))};</script>
<script>${SCENE_JS}</script>
</body></html>`;
}

/** Script the app injects to change what is fitted. Slot keys only. */
export function setPartsScript(parts: string[]): string {
  return `window.showroom&&window.showroom.setParts(${inlineJson(parts.filter((k) => SLOT.test(k)))});true;`;
}

/** Script the app injects to repaint the car. Ignored unless it is a plain hex colour. */
export function setPaintScript(hex: string): string {
  return HEX.test(hex) ? `window.showroom&&window.showroom.setPaint(${inlineJson(hex)});true;` : 'true;';
}

/** Script the app injects when its own top/bottom controls change size. Numbers only. */
export function setInsetsScript(top: number, bottom: number): string {
  return `window.showroom&&window.showroom.setInsets(${share(top)},${share(bottom)});true;`;
}

/** Base64 characters per injected script: big enough to be quick, small enough for any WebView bridge. */
export const MODEL_CHUNK = 512 * 1024;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * The scripts that hand a .glb (as base64) to the page, one piece each, in order.
 * Anything that is not plain base64 sends nothing (the page then shows the drawn car).
 */
export function modelChunkScripts(base64: string, chunk = MODEL_CHUNK): string[] {
  if (!base64 || !BASE64.test(base64)) return [];
  const n = Math.ceil(base64.length / chunk);
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(`window.showroom&&window.showroom.modelChunk(${i},${n},'${base64.slice(i * chunk, (i + 1) * chunk)}');true;`);
  }
  return out;
}

/** Script the app injects when it could not read the model file: the page falls back to the drawn car. */
export const MODEL_FAILED_SCRIPT = 'window.showroom&&window.showroom.modelFailed();true;';
