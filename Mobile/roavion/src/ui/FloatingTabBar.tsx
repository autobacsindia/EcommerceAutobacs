/**
 * Bottom tab bar — WhatsApp / Material 3 style (owner, 2026-11-22).
 *
 *   <Tabs tabBar={(p) => <FloatingTabBar {...p} />} …>
 *
 * A white bar with a hairline top border. Every tab is an icon over a label.
 * The ACTIVE tab sits inside a soft green-tint pill, with a bold label and a
 * brand-green icon, like WhatsApp's light theme. Reels is an ordinary tab in
 * the centre (no raised disc). The cart count is a round green badge, like an
 * unread count.
 *
 * Icons/labels come from each screen's `title` + `tabBarIcon` options, and the
 * count from `tabBarBadge`. The bar stays IN the layout (screens end above it),
 * and under it sits the real bottom inset: iPhone home indicator, Android
 * gesture bar or 3-button nav (edge-to-edge is forced on Android).
 *
 * `useTabBarSpace()` returns the bar's total height for anything that must
 * float above it (toast, FAB) from inside a tab screen. The component keeps
 * its old name and accepts the old `darkRoutes` / `centerRoute` props, which
 * are ignored now, so existing call sites still compile.
 */
import { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ComponentProps } from 'react';
import type { Tabs } from 'expo-router';
import { colors, font } from '../theme';
import { PressScale, haptic } from './motion';
import { CountBubble } from './primitives';

/** Height of the bar itself (above the bottom inset). */
export const TAB_BAR_HEIGHT = 64;
const MIN_BOTTOM = 6;

/** Props expo-router's <Tabs tabBar> passes in (derived so we don't import router internals). */
export type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + Math.max(insets.bottom, MIN_BOTTOM);
}

export function FloatingTabBar({
  state,
  descriptors,
  emitter,
  navigateToTab,
  insets,
  hiddenRoutes,
}: BottomTabBarProps & {
  /** @deprecated ignored — the bar is always white now. */
  darkRoutes?: string[];
  /** @deprecated ignored — Reels is an ordinary tab now. */
  centerRoute?: string;
  /** Route names that are tab screens but get no button (the cart, reached from the header). */
  hiddenRoutes?: string[];
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

  return (
    <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, MIN_BOTTOM) }]} accessibilityRole="tablist">
      {state.routes.map((route, index) => {
        if (hiddenRoutes?.includes(route.name)) return null;
        const { options } = descriptors[route.key];
        const isFocused = index === state.index;
        const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : options.title ?? route.name;
        const onPress = () => {
          haptic.selection();
          const ev = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!isFocused && !ev.defaultPrevented) navigateToTab(route.key);
        };
        const onLongPress = () => emitter.emit({ type: 'tabLongPress', target: route.key });
        const color = isFocused ? colors.green : colors.ink2;
        const badge = typeof options.tabBarBadge === 'number' ? options.tabBarBadge : 0;
        return (
          <PressScale
            key={route.key}
            onPress={onPress}
            onLongPress={onLongPress}
            scaleTo={0.92}
            style={s.item}
            accessibilityRole="tab"
            accessibilityState={{ selected: isFocused }}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? `${label}, tab`}
          >
            <View style={[s.pill, isFocused && s.pillOn]}>
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
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: 8,
    minHeight: TAB_BAR_HEIGHT,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', gap: 4 },
  // WhatsApp's active-tab indicator: a 64×32 tinted pill behind the icon.
  pill: { width: 60, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: colors.greenSoft },
  label: { fontFamily: font.medium, fontSize: 11.5, color: colors.ink2 },
  labelOn: { fontFamily: font.bold, color: colors.ink },
  badge: { position: 'absolute', top: -3, right: 6 },
});
