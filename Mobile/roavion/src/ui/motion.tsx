/**
 * Motion + haptics helpers. Every tappable in the app should feel the same:
 * a quick spring shrink on press, and a light haptic on primary actions.
 *
 *   <PressScale onPress={go} haptic="light">…</PressScale>
 *   const reduce = useReduceMotion();     // skip decorative animation
 *   haptic.success();                     // after a confirmed server action
 */
import { Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { motion } from '../theme';

// ── haptics ─────────────────────────────────────────────────────────────────

const canBuzz = Platform.OS === 'ios' || Platform.OS === 'android';
const safe = (p: () => Promise<void>) => {
  if (canBuzz) p().catch(() => {});
};

/**
 * Fire-and-forget haptics. Never throws; no-op on web.
 * - `light`: primary button press, add to wishlist.
 * - `selection`: tab change, chip/filter toggle, carousel snap.
 * - `success` / `warning` / `error`: AFTER the server confirms (never optimistic for money).
 */
export const haptic = {
  light: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  selection: () => safe(() => Haptics.selectionAsync()),
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
} as const;

export type HapticKind = keyof typeof haptic;

// ── reduce motion ───────────────────────────────────────────────────────────

/** True when the user asked the OS to reduce motion. Skip decorative animation. */
export function useReduceMotion(): boolean {
  return useReducedMotion();
}

// ── press scale ─────────────────────────────────────────────────────────────

/**
 * Returns `{ style, onPressIn, onPressOut }` to make any Animated view shrink
 * on press. Use `PressScale` unless you need the raw pieces.
 */
export function usePressScale(to: number = motion.pressScale) {
  const reduce = useReducedMotion();
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return {
    style,
    onPressIn: () => {
      if (!reduce) scale.set(withSpring(to, motion.spring));
    },
    onPressOut: () => {
      scale.set(withSpring(1, motion.spring));
    },
  };
}

const APressable = Animated.createAnimatedComponent(Pressable);

export type PressScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** Haptic fired on press (default none). */
  haptic?: HapticKind;
  /** Scale while pressed (default motion.pressScale = 0.97). */
  scaleTo?: number;
};

/**
 * Drop-in Pressable that springs to 97% while pressed and optionally buzzes.
 *
 *   <PressScale onPress={open} haptic="selection" style={s.tile}>…</PressScale>
 */
export function PressScale({ haptic: kind, scaleTo, onPress, onPressIn, onPressOut, style, disabled, ...rest }: PressScaleProps) {
  const p = usePressScale(scaleTo);
  return (
    <APressable
      accessibilityRole="button"
      disabled={disabled}
      {...rest}
      onPressIn={(e) => {
        p.onPressIn();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        p.onPressOut();
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (kind) haptic[kind]();
        onPress?.(e);
      }}
      style={[style, p.style]}
    />
  );
}
