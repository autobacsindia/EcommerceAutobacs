/**
 * The animated drawing, native (iOS/Android): the website's own SVG + CSS inside a
 * WebView. Why a WebView and not react-native-svg + Reanimated: it reuses the 16
 * owner-approved scenes byte-for-byte (a native port would be ~30 KB of drawings and
 * ~35 keyframes redone by hand, and drift from the site with every tweak), and
 * react-native-webview is already in the app (checkout) — no new native module, no
 * new app-store build. It is decoration only: hidden from screen readers, no touches,
 * no JavaScript, no navigation.
 */
import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { OrderMomentData } from './momentCopy';
import { momentHtml, SCENE_BG } from './momentHtml';

const ORIGINS = ['about:*'];

function MomentScene({ moment, still }: { moment: OrderMomentData; still: boolean }) {
  const html = useMemo(() => momentHtml(moment, { still }), [moment, still]);
  return (
    <View style={s.fill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <WebView
        source={{ html }}
        originWhitelist={ORIGINS}
        // Only the inline page itself; never follow a link out of it.
        onShouldStartLoadWithRequest={(req) => req.url.startsWith('about:')}
        javaScriptEnabled={false}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        cacheEnabled={false}
        allowsLinkPreview={false}
        setSupportMultipleWindows={false}
        style={s.web}
        containerStyle={s.fill}
      />
    </View>
  );
}

export default memo(MomentScene);

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: SCENE_BG },
  web: { flex: 1, backgroundColor: SCENE_BG },
});
