/**
 * Launch intro — plays once per cold start, right after the native splash
 * (void #080808 + AB badge) so the hand-off is seamless:
 *   badge settles → three stripes sweep in → AUTOBACS letter-spaces in →
 *   thin green progress bar → whole layer fades away.
 * Hard cap `motion.introMax` (1.6s). Reduce-motion: a short static hold + fade.
 *
 * It is an overlay: the app mounts underneath at the same time, so the first
 * screen's data is already loading while the intro plays. Not shown again on
 * warm start (resume from background keeps the JS alive, and `played` stays
 * true) or after a fast refresh.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { colors, font, motion, palette } from '../theme';

let played = false;

const BADGE = 132;
const STRIPE_COLORS = [palette.green, palette.white, palette.steel];

export function LaunchIntro({ onReady }: { onReady?: () => void }) {
  const reduce = useReducedMotion();
  const [visible, setVisible] = useState(!played);

  const t = useSharedValue(0); // 0..1 over the build-up
  const out = useSharedValue(1); // layer opacity

  // Hide the native splash once we're mounted (also when the intro is skipped).
  useEffect(() => {
    onReady?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!visible) return;
    played = true;
    const total = motion.introMax; // 1600
    const fade = 280;
    const build = reduce ? 300 : total - fade - 40;
    const finish = () => setVisible(false);
    t.value = withTiming(1, { duration: reduce ? 0 : build, easing: Easing.out(Easing.cubic) });
    out.value = withDelay(
      build,
      withTiming(0, { duration: fade, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) runOnJS(finish)();
      }),
    );
    // Safety net: never block the app longer than the cap, even if an
    // animation callback is dropped.
    const guard = setTimeout(finish, total + 200);
    return () => clearTimeout(guard);
  }, [visible, reduce, t, out]);

  const layer = useAnimatedStyle(() => ({ opacity: out.value }));
  const badge = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.12], [0.6, 1], 'clamp'),
    transform: [{ scale: interpolate(t.value, [0, 0.3], [1.08, 1], 'clamp') }],
  }));
  const word = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0.35, 0.65], [0, 1], 'clamp'),
    transform: [{ translateY: interpolate(t.value, [0.35, 0.65], [6, 0], 'clamp') }],
  }));
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: t.value }] }));

  if (!visible) return null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, s.root, layer]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={badge}>
        <Image source={require('../../assets/splash-icon.png')} style={{ width: BADGE * 2, height: BADGE * 2 }} contentFit="contain" />
      </Animated.View>
      <View style={s.stripes}>
        {STRIPE_COLORS.map((c, i) => (
          <Stripe key={i} i={i} color={c} t={t} />
        ))}
      </View>
      <Animated.View style={word}>
        <Text style={s.word}>AUTOBACS</Text>
      </Animated.View>
      <View style={s.track}>
        <Animated.View style={[s.fill, bar]} />
      </View>
    </Animated.View>
  );
}

function Stripe({ i, color, t }: { i: number; color: string; t: { value: number } }) {
  const st = useAnimatedStyle(() => {
    const a = 0.18 + i * 0.07;
    const p = interpolate(t.value, [a, a + 0.22], [0, 1], 'clamp');
    return { opacity: p, transform: [{ translateX: (1 - p) * -28 }, { skewX: '-25deg' }] };
  });
  return <Animated.View style={[{ width: 26, height: 6, backgroundColor: color }, st]} />;
}

const s = StyleSheet.create({
  root: { backgroundColor: colors.void, alignItems: 'center', justifyContent: 'center', zIndex: 9999, elevation: 9999 },
  stripes: { flexDirection: 'row', gap: 6, marginTop: -BADGE * 0.32 },
  word: { fontFamily: font.extrabold, fontSize: 20, letterSpacing: 8, color: colors.white, marginTop: 18, marginLeft: 8 },
  track: { position: 'absolute', bottom: '18%', width: 140, height: 2, borderRadius: 1, backgroundColor: colors.carbon2, overflow: 'hidden' },
  fill: { width: '100%', height: '100%', backgroundColor: colors.greenOnDark, transformOrigin: 'left' },
});
