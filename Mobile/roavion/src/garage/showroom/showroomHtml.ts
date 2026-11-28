/**
 * The self-contained page the showroom WebView shows: one canvas plus the bundled
 * scene script (three.js included). Nothing is fetched — it works offline and
 * cannot load anything from the network.
 *
 * Pure: runs under `node --test`.
 */
import { SCENE_JS } from './sceneBundle.generated';

/** The stage behind the car — the app's own light page grey. */
export const STAGE_BG = '#f5f7f6';

export interface ShowroomInit {
  /** Slot keys already fitted. */
  parts: string[];
  /** Body colour, #rrggbb. */
  paint: string;
  /** Brand colour for the turntable ring, #rrggbb. */
  accent: string;
  /** No spin and no grow-in animation (the phone asks for reduced motion). */
  still: boolean;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const SLOT = /^[a-z0-9-]{1,40}$/;

/**
 * Everything that goes into the page is checked first and written as JSON, so
 * no value — however it got into a saved build — can become markup or script.
 */
export function showroomConfig(init: ShowroomInit) {
  return {
    bg: STAGE_BG,
    parts: init.parts.filter((k) => SLOT.test(k)),
    paint: HEX.test(init.paint) ? init.paint : '#f4f4f2',
    accent: HEX.test(init.accent) ? init.accent : '#0a5c33',
    still: init.still === true,
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
