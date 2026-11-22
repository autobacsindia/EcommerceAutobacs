/**
 * Floating ink-black pill tab bar with a raised green Reels button.
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type { Tabs } from 'expo-router';
import { colors, elevation, font, radius } from '../theme';
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

  const page = darkRoutes.includes(focused.name) ? colors.black : colors.bg;
  const bottom = Math.max(insets.bottom, MIN_BOTTOM);

  return (
    <View style={{ backgroundColor: page, paddingTop: TOP, paddingBottom: bottom, paddingHorizontal: SIDE }}>
      <View style={[s.pill, page === colors.black && s.pillOnBlack]} accessibilityRole="tablist">
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
                <View style={[s.centerRing, isFocused && elevation.glow]}>
                  <LinearGradient
                    colors={isFocused ? [colors.greenMid, colors.green] : [colors.green, colors.greenDeep]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.centerDisc}
                  >
                    <Ionicons name={isFocused ? 'play' : 'play-outline'} size={22} color={colors.white} style={{ marginLeft: 2 }} />
                  </LinearGradient>
                </View>
                <Text style={[s.label, s.centerLabel, isFocused && s.labelOn]} numberOfLines={1}>
                  {label}
                </Text>
              </PressScale>
            );
          }

          const color = isFocused ? colors.white : colors.chrome;
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
              <View style={[s.dot, isFocused && s.dotOn]} />
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
    backgroundColor: colors.ink,
    paddingHorizontal: 6,
    ...elevation.e3,
  },
  pillOnBlack: { backgroundColor: colors.carbon2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.onDarkFaint },
  item: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontFamily: font.medium, fontSize: 10.5, color: colors.chrome, marginTop: 2 },
  labelOn: { fontFamily: font.bold, color: colors.white },
  centerLabel: { marginTop: 0 },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 1, backgroundColor: 'transparent' },
  dotOn: { backgroundColor: colors.greenOnDark },
  badge: { position: 'absolute', top: -6, right: -12 },
  centerRing: {
    marginTop: -26,
    padding: 4,
    borderRadius: 32,
    backgroundColor: colors.ink,
  },
  centerDisc: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
});
