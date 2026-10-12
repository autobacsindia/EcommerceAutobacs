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
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow } from '../theme';

export default function ScrollTopButton({ visible, onPress }: { visible: boolean; onPress: () => void }) {
  const anim = useRef(new Animated.Value(0)).current;

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
      <Pressable
        onPress={onPress}
        hitSlop={8}
        android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: true }}
        style={s.btn}
        accessibilityRole="button"
        accessibilityLabel="Back to top"
      >
        <Ionicons name="arrow-up" size={20} color={colors.white} />
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', right: 16, bottom: 20 },
  btn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
});
