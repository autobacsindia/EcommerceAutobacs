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
 *
 * It is a GREEN pill with a white ring, not a dark circle. The dark circle was
 * invisible exactly where it mattered: the bottom of Home is a near-black
 * contact footer, so a #0f1111 button on it disappeared into the background at
 * the one point in the page where someone most wants to get back to the top.
 * The ring guarantees an edge against any backdrop, light or dark, and the
 * "TOP" label means it reads as a control rather than decoration.
 */
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, shadow, spacing } from '../theme';

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
      <Pressable
        onPress={onPress}
        hitSlop={8}
        android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: true }}
        style={s.btn}
        accessibilityRole="button"
        accessibilityLabel="Back to top"
      >
        <Ionicons name="arrow-up" size={17} color={colors.white} />
        <Text style={s.label}>TOP</Text>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', right: spacing.lg, bottom: spacing.xl },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
    // The ring is what keeps it legible on the dark footer at the end of Home.
    borderWidth: 2,
    borderColor: colors.white,
    ...shadow.raised,
  },
  label: { fontFamily: font.bold, fontSize: 11.5, color: colors.white, letterSpacing: 0.6 },
});
