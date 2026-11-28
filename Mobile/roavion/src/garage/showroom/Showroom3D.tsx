/**
 * The 3D stage, native (iOS/Android): the bundled three.js scene inside a WebView.
 *
 * Why a WebView and not expo-gl: react-native-webview is already in the app (no
 * new native module, works in Expo Go), WebGL in the system browser is the most
 * battle-tested 3D path on both platforms, and it will load artist-made .glb
 * models (textures included) without a native image-decoding workaround.
 *
 * The page is built ONCE; later changes are pushed in with injectJavaScript so
 * the car never reloads or loses the angle the customer turned it to.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { colors } from '../../theme';
import { setInsetsScript, setPaintScript, setPartsScript, showroomHtml, STAGE_BG } from './showroomHtml';

const ORIGINS = ['about:*'];

export interface Showroom3DProps {
  parts: string[];
  paint: string;
  still: boolean;
  /** Share of the screen (0–0.8) the app's own controls cover, so the car is framed in what is left. */
  insetTop: number;
  insetBottom: number;
  onReady: () => void;
  /** WebGL is unavailable on this phone, or the 3D page crashed twice. */
  onError: () => void;
}

function Showroom3D({ parts, paint, still, insetTop, insetBottom, onReady, onError }: Showroom3DProps) {
  // `WebView<object>`: the class's default type parameter makes its props `never` once a ref pins it.
  const web = useRef<WebView<object>>(null);
  const [ready, setReady] = useState(false);
  // Built once from the first props; later changes are injected, not re-rendered.
  // `page.n` goes up when the page is rebuilt after the OS kills the WebView (low memory).
  const [page, setPage] = useState(() => ({ n: 0, html: showroomHtml({ parts, paint, accent: colors.green, still, insetTop, insetBottom }) }));

  useEffect(() => {
    if (ready) web.current?.injectJavaScript(setPartsScript(parts));
  }, [ready, parts]);

  useEffect(() => {
    if (ready) web.current?.injectJavaScript(setPaintScript(paint));
  }, [ready, paint]);

  useEffect(() => {
    if (ready) web.current?.injectJavaScript(setInsetsScript(insetTop, insetBottom));
  }, [ready, insetTop, insetBottom]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let msg: { type?: string } | null = null;
      try {
        msg = JSON.parse(e.nativeEvent.data) as { type?: string };
      } catch {
        return;
      }
      if (msg?.type === 'ready') {
        setReady(true);
        onReady();
      } else if (msg?.type === 'error') {
        onError();
      }
    },
    [onReady, onError],
  );

  const onCrash = useCallback(() => {
    setReady(false);
    // One rebuild is a blip; a second crash means this phone cannot hold the scene.
    if (page.n >= 1) {
      onError();
      return;
    }
    setPage({ n: page.n + 1, html: showroomHtml({ parts, paint, accent: colors.green, still, insetTop, insetBottom }) });
  }, [page.n, parts, paint, still, insetTop, insetBottom, onError]);

  return (
    <View style={s.fill}>
      <WebView
        key={page.n}
        ref={web}
        source={{ html: page.html }}
        originWhitelist={ORIGINS}
        // Only the inline page itself; never follow a link out of it.
        onShouldStartLoadWithRequest={(req) => req.url.startsWith('about:')}
        javaScriptEnabled
        domStorageEnabled={false}
        onMessage={onMessage}
        onError={onError}
        onContentProcessDidTerminate={onCrash}
        onRenderProcessGone={onCrash}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        cacheEnabled={false}
        allowsLinkPreview={false}
        setSupportMultipleWindows={false}
        androidLayerType="hardware"
        style={s.web}
        containerStyle={s.fill}
        accessibilityLabel="3D view of the car. Drag to turn it."
      />
    </View>
  );
}

export default memo(Showroom3D);

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: STAGE_BG },
  web: { flex: 1, backgroundColor: STAGE_BG },
});
