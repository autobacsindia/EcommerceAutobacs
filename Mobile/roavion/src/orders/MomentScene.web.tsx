/**
 * The animated drawing on Expo web (development previews): react-native-webview has
 * no web build, so the same page goes in a sandboxed iframe (no scripts allowed).
 * Native uses MomentScene.tsx.
 */
import { memo, useMemo } from 'react';
import type { OrderMomentData } from './momentCopy';
import { momentHtml, SCENE_BG } from './momentHtml';

function MomentScene({ moment, still }: { moment: OrderMomentData; still: boolean }) {
  const html = useMemo(() => momentHtml(moment, { still }), [moment, still]);
  return (
    <iframe
      title="Order update picture"
      aria-hidden="true"
      tabIndex={-1}
      sandbox=""
      srcDoc={html}
      style={{ border: 0, width: '100%', height: '100%', display: 'block', background: SCENE_BG, pointerEvents: 'none' }}
    />
  );
}

export default memo(MomentScene);
