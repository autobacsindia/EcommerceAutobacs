/**
 * "Back to top" — the way out of a long scroll.
 *
 * The home page is five product rails deep and the shop list pages forever, so
 * a customer who has browsed down has no quick way back to the search field.
 * Flicking up repeatedly is the alternative, and on a long list it is a dozen
 * flicks.
 *
 * It sits above the tab bar rather than beside it: the thumb rests at the
 * bottom-right of a phone, and anything in that corner must not overlap the
 * tab bar's own targets. Fades rather than pops, so it does not read as an
 * alert, and it is hidden from the accessibility tree while invisible so a
 * screen reader does not announce a control nobody can see.
 */
import { useEffect, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, elevation, radius } from '../theme';
import { PressScale } from '../ui';

export default function ScrollTopButton({ visible, onPress }: { visible: boolean; onPress: () => void }) {
  // Created once; see the note in useHeaderScroll on why this is not a ref.
  const [anim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      style={[
        s.wrap,
        {
          opacity: anim,
          transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }],
        },
      ]}
    >
      <PressScale onPress={onPress} haptic="selection" scaleTo={0.9} hitSlop={8} style={s.btn} accessibilityLabel="Back to top">
        <Ionicons name="arrow-up" size={20} color={colors.white} />
      </PressScale>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', right: 16, bottom: 16 },
  btn: {
    // WhatsApp-style FAB: brand-green rounded square.
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.e2,
  },
});
