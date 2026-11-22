/**
 * Heritage Noir tab bar: frosted carbon pill (real blur on iOS), steel icons,
 * gold active icon, and a raised racing-green Reels disc wrapped in a carbon +
 * gold double ring.
 *
 *   <Tabs tabBar={(p) => <FloatingTabBar {...p} darkRoutes={['reels']} centerRoute="reels" />} …>
 *
 * Icons/labels come from each screen's `title` + `tabBarIcon` options, and the
 * count bubble from `tabBarBadge`. The bar stays IN the layout (screens end
 * above it), so no screen needs extra bottom padding. Under the pill sits the
 * real bottom inset: iPhone home indicator, Android gesture bar, or Android's
 * 3-button nav bar (edge-to-edge is forced on Android). With no inset (older
 * phones / web) a small margin is used instead.
 *
 * `useTabBarSpace()` returns the bar's total height for anything that must
 * float above it (toast, FAB) from inside a tab screen.
 */
import { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type { Tabs } from 'expo-router';
import { colors, elevation, font, noir, radius } from '../theme';
import { PressScale, haptic } from './motion';
import { CountBubble } from './primitives';

/** Height of the pill itself. */
export const TAB_BAR_HEIGHT = 64;
const SIDE = 14;
const TOP = 6;
const MIN_BOTTOM = 10;

/** Props expo-router's <Tabs tabBar> passes in (derived so we don't import router internals). */
export type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + TOP + Math.max(insets.bottom, MIN_BOTTOM);
}

export function FloatingTabBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
  insets,
  darkRoutes = [],
  centerRoute,
}: BottomTabBarProps & {
  /** Routes whose page is black (the area around the pill turns black too). */
  darkRoutes?: string[];
  /** Route drawn as the raised green disc. */
  centerRoute?: string;
}) {
  const [kb, setKb] = useState(false);
  useEffect(() => {
    // Android pushes the bar above the keyboard; hide it like the system does.
    if (Platform.OS !== 'android') return;
    const a = Keyboard.addListener('keyboardDidShow', () => setKb(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setKb(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);

  const focused = state.routes[state.index];
  const focusedOpts = descriptors[focused.key]?.options;
  const flat = StyleSheet.flatten(focusedOpts?.tabBarStyle) as { display?: string } | undefined;
  if (kb || flat?.display === 'none') return null;

  // Heritage Noir: every page is dark; Reels (darkRoutes) is void black.
  const onVoid = darkRoutes.includes(focused.name);
  const page = onVoid ? noir.void : noir.page;
  const bottom = Math.max(insets.bottom, MIN_BOTTOM);

  return (
    <View style={{ backgroundColor: page, paddingTop: TOP, paddingBottom: bottom, paddingHorizontal: SIDE }}>
      <View style={s.pill} accessibilityRole="tablist">
        {Platform.OS === 'ios' && <BlurView intensity={30} tint="dark" style={[StyleSheet.absoluteFill, s.blur]} />}
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = index === state.index;
          const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : options.title ?? route.name;
          const onPress = () => {
            haptic.selection();
            const ev = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!isFocused && !ev.defaultPrevented) navigateToTab(route.key);
          };
          const onLongPress = () => emitter.emit({ type: 'tabLongPress', target: route.key });
          const a11y = {
            accessibilityRole: 'tab' as const,
            accessibilityState: { selected: isFocused },
            accessibilityLabel: options.tabBarAccessibilityLabel ?? `${label}, tab, ${index + 1} of ${state.routes.length}`,
          };

          if (route.name === centerRoute) {
            return (
              <PressScale key={route.key} onPress={onPress} onLongPress={onLongPress} scaleTo={0.9} style={s.item} {...a11y}>
                <View style={[s.goldRing, isFocused && elevation.glow]}>
                  <View style={s.carbonRing}>
                  <LinearGradient
                    colors={isFocused ? [colors.greenMid, colors.green] : [colors.green, colors.greenDeep]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.centerDisc}
                  >
                    <Ionicons name="play" size={20} color={colors.white} style={{ marginLeft: 2 }} />
                  </LinearGradient>
                  </View>
                </View>
                <Text style={[s.label, s.centerLabel, isFocused && s.labelOn]} numberOfLines={1}>
                  {label}
                </Text>
              </PressScale>
            );
          }

          const color = isFocused ? noir.gold : noir.textFaint;
          const badge = typeof options.tabBarBadge === 'number' ? options.tabBarBadge : 0;
          return (
            <PressScale key={route.key} onPress={onPress} onLongPress={onLongPress} scaleTo={0.9} style={s.item} {...a11y}>
              <View>
                {options.tabBarIcon?.({ focused: isFocused, color, size: 22 })}
                {badge > 0 && <CountBubble count={badge} style={s.badge} />}
              </View>
              <Text style={[s.label, isFocused && s.labelOn]} numberOfLines={1}>
                {label}
              </Text>
            </PressScale>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  pill: {
    height: TAB_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    // iOS: blur underneath shows through this translucent carbon; Android/web: the fill alone.
    backgroundColor: Platform.OS === 'ios' ? noir.glass : noir.surface,
    borderWidth: 1,
    borderColor: noir.hairlineStrong,
    paddingHorizontal: 6,
    ...elevation.e3,
  },
  blur: { borderRadius: radius.pill, overflow: 'hidden' },
  item: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: { fontFamily: font.medium, fontSize: 10, letterSpacing: 0.3, color: noir.textFaint },
  labelOn: { fontFamily: font.bold, color: noir.text },
  centerLabel: { marginTop: 0 },
  badge: { position: 'absolute', top: -6, right: -12 },
  // Double ring: 1px gold outside, 3px carbon inside, then the green disc.
  goldRing: {
    marginTop: -24,
    padding: 1,
    borderRadius: 30,
    backgroundColor: noir.gold,
  },
  carbonRing: { padding: 3, borderRadius: 29, backgroundColor: noir.page },
  centerDisc: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});
