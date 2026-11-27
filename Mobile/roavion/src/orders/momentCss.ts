/**
 * COPIED VERBATIM from the website: the "Order moments" block at the end of
 * Front-end/web/src/app/globals.css (the om-* keyframes). It runs inside the scene's
 * WebView exactly as it runs on the website, so the animation is identical.
 * Change the website first, then re-copy here (escape the two backticks in its comment).
 */
export const MOMENT_CSS = `
/* ───────── Order moments (components/orders/OrderMoment.tsx, orderMomentScenes.ts) ─────────
   An element's normal style IS its final frame; these keyframes only say where it
   starts. So \`.om-still\` (already seen) and reduced motion simply turn animation off
   and the finished picture remains. Each plays once (1.5–3 s); nothing loops forever. */
.om-scene .om-a { animation-fill-mode: both; transform-box: fill-box; transform-origin: center; }
.om-scene.om-still * { animation: none !important; }
@media (prefers-reduced-motion: reduce) { .om-scene * { animation: none !important; } }
@keyframes om-pop { 0% { transform: scale(0); opacity: 0; } 70% { transform: scale(1.15); opacity: 1; } 100% { transform: scale(1); } }
@keyframes om-burst { 0% { opacity: 0; transform: translate(0, 0) scale(.3) rotate(0); } 15% { opacity: 1; } 100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(1) rotate(var(--r, 0deg)); } }
@keyframes om-draw { from { stroke-dashoffset: 1; } }
@keyframes om-from-left-far { from { transform: translateX(-240px); } }
@keyframes om-from-left-near { from { transform: translateX(-70px); } }
@keyframes om-stamp { 0% { transform: scale(2.4) rotate(-12deg); opacity: 0; } 60% { transform: scale(.94) rotate(-12deg); opacity: 1; } 100% { transform: scale(1) rotate(-12deg); } }
@keyframes om-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1.6px); } }
@keyframes om-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
@keyframes om-spin-back { from { transform: rotate(-360deg); } }
@keyframes om-slide-left { to { transform: translateX(-40px); } }
@keyframes om-slide-left-long { to { transform: translateX(-160px); } }
@keyframes om-fade-out { 0% { opacity: .9; } 100% { opacity: 0; } }
@keyframes om-rise-in { from { opacity: 0; transform: translateY(8px); } }
@keyframes om-bow { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-7deg); } 50% { transform: rotate(0); } 75% { transform: rotate(-4deg); } }
@keyframes om-blink { 0%, 90%, 100% { transform: scaleY(1); } 95% { transform: scaleY(.1); } }
@keyframes om-coin { 0% { opacity: 0; transform: translate(0, 0); } 12% { opacity: 1; } 50% { transform: translate(72px, -52px); } 88% { opacity: 1; } 100% { opacity: 0; transform: translate(144px, 0); } }
@keyframes om-thump { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
@keyframes om-typing { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
@keyframes om-sway { 0%, 100% { transform: rotate(0); } 30% { transform: rotate(8deg); } 65% { transform: rotate(-5deg); } }
@keyframes om-land { 0% { transform: translateY(-110px); opacity: 0; } 15% { opacity: 1; } 60% { transform: translateY(0) scale(1.14, .82); } 80% { transform: scale(.96, 1.05); } 100% { transform: none; } }
@keyframes om-wave { 0%, 100% { transform: rotate(0); } 30% { transform: rotate(-20deg); } 65% { transform: rotate(10deg); } }
@keyframes om-arc { 0% { transform: translate(var(--dx), var(--dy)); opacity: 0; } 12% { opacity: 1; } 55% { transform: translate(calc(var(--dx) * .4), calc(var(--dy) - 34px)); } 100% { transform: none; opacity: 1; } }
@keyframes om-hop { 0%, 100% { transform: none; } 40% { transform: translateY(-12px) scale(.98, 1.04); } }
@keyframes om-hop-in { 0% { transform: translate(-120px, 0); } 45% { transform: translate(-55px, -46px); } 80% { transform: translate(0, 0) scale(1.1, .88); } 100% { transform: none; } }
@keyframes om-swing { 0% { transform: translateY(-60px) rotate(-60deg); opacity: 0; } 40% { opacity: 1; transform: rotate(25deg); } 70% { transform: rotate(-12deg); } 100% { transform: none; } }
@keyframes om-rise-fade { 0% { opacity: 0; transform: translateY(0) scale(.6); } 20% { opacity: 1; } 100% { opacity: 0; transform: translateY(-44px) scale(1.1); } }
@keyframes om-drift { from { transform: translateX(-34px); } }
@keyframes om-door { from { transform: scaleX(1); } }
@keyframes om-gray { from { filter: none; } }
@keyframes om-knock { 0%, 100% { opacity: 0; } 20%, 40%, 60% { opacity: 1; } 30%, 50% { opacity: .2; } }
@keyframes om-flip { 0% { transform: rotateX(90deg); opacity: 0; } 100% { transform: none; opacity: 1; } }
@keyframes om-pulse-ring { 0% { transform: scale(.4); opacity: .7; } 100% { transform: scale(2.2); opacity: 0; } }
`;
