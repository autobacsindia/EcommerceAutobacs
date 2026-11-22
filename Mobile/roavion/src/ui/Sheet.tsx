/**
 * Bottom sheet — filter/sort, size pickers, "choose your car", share.
 *
 *   const [open, setOpen] = useState(false);
 *   <Sheet visible={open} onClose={() => setOpen(false)} title="Sort by">
 *     …rows…
 *   </Sheet>
 *
 *   <Sheet visible={open} onClose={close} title="Filters"
 *          footer={<PremiumButton label="Show 42 results" onPress={apply} full />}>
 *
 * Closes on backdrop tap and Android back. Sits above the home indicator /
 * Android nav bar. Content scrolls when taller than `maxHeight` (default 85%).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, elevation, font, motion, radius, spacing } from '../theme';
import { IconButton } from './primitives';

export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
  maxHeight = 0.85,
  scroll = true,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Sticky area under the content (primary action). */
  footer?: ReactNode;
  /** Fraction of the screen height. */
  maxHeight?: number;
  /** Wrap children in a ScrollView (default true). Pass false for your own FlatList. */
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const y = useSharedValue(height);
  const fade = useSharedValue(0);

  // Mount as soon as we become visible (derived during render, not in an effect).
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      fade.value = withTiming(1, { duration: motion.duration.base });
      y.value = reduce ? withTiming(0, { duration: motion.duration.fast }) : withSpring(0, motion.springGentle);
    } else if (mounted) {
      fade.value = withTiming(0, { duration: motion.duration.fast });
      y.value = withTiming(height, { duration: motion.duration.base, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const backdrop = useAnimatedStyle(() => ({ opacity: fade.value }));
  const panel = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  if (!mounted) return null;

  return (
    <Modal transparent visible statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }, backdrop]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View
        style={[s.panel, { maxHeight: height * maxHeight, paddingBottom: Math.max(insets.bottom, spacing.lg) }, panel]}
        accessibilityViewIsModal
      >
        <View style={s.handle} />
        {!!title && (
          <View style={s.head}>
            <Text style={s.title} accessibilityRole="header">
              {title}
            </Text>
            <IconButton icon="close" label="Close" onPress={onClose} tone="plain" size={36} />
          </View>
        )}
        {scroll ? (
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
            {children}
          </ScrollView>
        ) : (
          <View style={{ flexShrink: 1 }}>{children}</View>
        )}
        {footer && <View style={s.footer}>{footer}</View>}
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    ...elevation.e3,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginTop: 8, marginBottom: 4 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: spacing.lg, paddingRight: spacing.sm, paddingVertical: spacing.sm },
  title: { fontFamily: font.heading, fontSize: 18, color: colors.ink },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
});
