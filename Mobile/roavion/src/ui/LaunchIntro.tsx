/**
 * Launch intro — plays once per cold start, right after the native splash
 * (void #080808 + AB badge) so the hand-off is seamless:
 *   badge settles → fine gold crest ring draws around it → three stripes
 *   sweep in → serif AUTOBACS letter-spaces in → thin gold progress bar →
 *   whole layer fades away (Heritage Noir).
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
import { font, motion, noir, palette } from '../theme';

let played = false;

const BADGE = 132;
/** The badge disc is ~48.5% of splash-icon.png; the ring sits just outside it. */
const RING = Math.round(BADGE * 2 * 0.485) + 18;
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
  const ring = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0.08, 0.3], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(t.value, [0.08, 0.34], [0.86, 1], 'clamp') }],
  }));

  if (!visible) return null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, s.root, layer]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={badge}>
        <Animated.View style={[s.ring, ring]} />
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
  root: { backgroundColor: noir.void, alignItems: 'center', justifyContent: 'center', zIndex: 9999, elevation: 9999 },
  stripes: { flexDirection: 'row', gap: 6, marginTop: -BADGE * 0.32 },
  ring: {
    position: 'absolute',
    width: RING,
    height: RING,
    left: BADGE - RING / 2,
    top: BADGE - RING / 2,
    borderRadius: RING / 2,
    borderWidth: 1.5,
    borderColor: noir.gold,
  },
  word: { fontFamily: font.serif, fontSize: 22, letterSpacing: 8, color: noir.text, marginTop: 18, marginLeft: 8 },
  track: { position: 'absolute', bottom: '18%', width: 140, height: 1, backgroundColor: noir.surface, overflow: 'hidden' },
  fill: { width: '100%', height: '100%', backgroundColor: noir.gold, transformOrigin: 'left' },
});
