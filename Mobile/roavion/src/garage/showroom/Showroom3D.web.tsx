/**
 * The 3D stage on Expo web (development previews): react-native-webview has no
 * web build, so the same page goes in a sandboxed iframe (scripts only — no
 * same-origin access, no navigation). Native uses Showroom3D.tsx.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { colors } from '../../theme';
import type { Showroom3DProps } from './Showroom3D';
import { readModelBytes } from './modelFile.web';
import { showroomHtml, STAGE_BG } from './showroomHtml';

function Showroom3D({ car, modelAsset, parts, paint, still, insetTop, insetBottom, onReady, onError }: Showroom3DProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  // Built once from the first props; later changes are posted to the page.
  const [html] = useState(() => showroomHtml({ car, model: modelAsset != null, parts, paint, accent: colors.green, still, insetTop, insetBottom }));

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || typeof e.data !== 'string') return;
      try {
        const msg = JSON.parse(e.data) as { type?: string };
        if (msg.type === 'want-model') {
          const target = frame.current?.contentWindow;
          if (modelAsset == null) target?.postMessage(JSON.stringify({ type: 'model-failed' }), '*');
          else
            readModelBytes(modelAsset)
              .then((bytes) => target?.postMessage({ type: 'model', bytes }, '*', [bytes]))
              .catch((err: unknown) => {
                console.warn('[showroom] could not read the car model', err);
                target?.postMessage(JSON.stringify({ type: 'model-failed' }), '*');
              });
        } else if (msg.type === 'model-failed') {
          console.warn('[showroom] real car model not shown, drawn car instead', msg);
        } else if (msg.type === 'ready') {
          setReady(true);
          onReady();
        } else if (msg.type === 'error') onError();
      } catch {
        /* not ours */
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onReady, onError, modelAsset]);

  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage(JSON.stringify({ type: 'parts', parts }), '*');
  }, [ready, parts]);

  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage(JSON.stringify({ type: 'paint', paint }), '*');
  }, [ready, paint]);

  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage(JSON.stringify({ type: 'insets', top: insetTop, bottom: insetBottom }), '*');
  }, [ready, insetTop, insetBottom]);

  return (
    <iframe
      ref={frame}
      title="3D view of the car"
      sandbox="allow-scripts"
      srcDoc={html}
      style={{ border: 0, width: '100%', height: '100%', display: 'block', background: STAGE_BG }}
    />
  );
}

export default memo(Showroom3D);
