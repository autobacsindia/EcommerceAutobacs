/**
 * Circular progress ring without react-native-svg (not in the Expo Go set we
 * ship): two clipped half-rings rotated by the native driver.
 *
 *   <ProgressRing progress={0.42} size={132} stroke={8}>{children}</ProgressRing>
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors } from '../theme';

export function ProgressRing({
  progress,
  size = 132,
  stroke = 8,
  color = colors.green,
  track = colors.greenSoft,
  children,
}: {
  /** 0..1 */
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
}) {
  const [p] = useState(() => new Animated.Value(0));
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));

  useEffect(() => {
    Animated.timing(p, { toValue: clamped, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [clamped, p]);

  const half = size / 2;
  const ring = { width: size, height: size, borderRadius: half, borderWidth: stroke } as const;
  const firstHalf = p.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '180deg', '180deg'] });
  const secondHalf = p.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '0deg', '180deg'] });

  return (
    <View style={{ width: size, height: size }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}>
      <View style={[StyleSheet.absoluteFill, ring, { borderColor: track }]} />

      {/* 0–50%: right half window, showing a rotating LEFT half-ring. */}
      <View style={{ position: 'absolute', left: half, top: 0, width: half, height: size, overflow: 'hidden' }}>
        <Animated.View style={{ position: 'absolute', left: -half, width: size, height: size, transform: [{ rotate: firstHalf }] }}>
          <View style={{ width: half, height: size, overflow: 'hidden' }}>
            <View style={[ring, { borderColor: color }]} />
          </View>
        </Animated.View>
      </View>

      {/* 50–100%: left half window, showing a rotating RIGHT half-ring. */}
      <View style={{ position: 'absolute', left: 0, top: 0, width: half, height: size, overflow: 'hidden' }}>
        <Animated.View style={{ position: 'absolute', left: 0, width: size, height: size, transform: [{ rotate: secondHalf }] }}>
          <View style={{ position: 'absolute', left: half, width: half, height: size, overflow: 'hidden' }}>
            <View style={[ring, { borderColor: color, marginLeft: -half }]} />
          </View>
        </Animated.View>
      </View>

      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>{children}</View>
    </View>
  );
}
