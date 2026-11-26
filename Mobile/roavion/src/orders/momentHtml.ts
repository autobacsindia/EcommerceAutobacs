/**
 * The self-contained page the scene's WebView shows: the website's exact SVG
 * (momentScenes.ts) animated by the website's exact CSS (momentCss.ts). No script,
 * no network — everything is inline, so it renders offline and can't load anything.
 * Pure: runs under `node --test`.
 */
import { MOMENT_CSS } from './momentCss';
import { sceneMarkup } from './momentScenes';
import { momentDayShort, type OrderMomentData } from './momentCopy';

/** The scene well behind the drawing — same as the website's `bg-[#f5f7f6]`. */
export const SCENE_BG = '#f5f7f6';

export function momentSvg(moment: OrderMomentData): string {
  return sceneMarkup(moment.key, {
    lateDay: momentDayShort(moment.late?.dueDay),
    newDay: momentDayShort(moment.newDay),
  });
}

/** @param still - show the finished picture (already seen, or the phone asks for reduced motion) */
export function momentHtml(moment: OrderMomentData, { still }: { still: boolean }): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
html,body{margin:0;padding:0;height:100%;overflow:hidden;background:${SCENE_BG};-webkit-user-select:none;user-select:none;
font-family:-apple-system,BlinkMacSystemFont,system-ui,Roboto,"Helvetica Neue",Arial,sans-serif}
.om-scene{width:100%;height:100%}
.om-scene svg{display:block;width:100%;height:100%}
${MOMENT_CSS}
</style></head><body>
<div class="om-scene${still ? ' om-still' : ''}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid meet" focusable="false">${momentSvg(moment)}</svg></div>
</body></html>`;
}
