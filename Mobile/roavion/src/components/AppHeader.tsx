/**
 * The Autobacs app header — Heritage Noir (owner picked 2026-11-22).
 *
 *   - `AppHeader`: transparent row laid over Home's hero photo — the round AB
 *     crest on the left, a letter-spaced serif AUTOBACS in the middle, the bell
 *     and the cart (with its count) on the right, in white. The hero's scrim is
 *     black at the top, so the row stays legible on any banner.
 *   - `SearchField`: the square carbon search bar that names the saved car.
 *     It opens the search screen.
 *
 * Presentation only — every tap routes, nothing here fetches or decides.
 */
import { memo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, noir, spacing } from '../theme';
import { useApp } from '../store';
import { Crest, IconButton, SearchBar } from '../ui';

/** Square carbon search bar; opens the search screen. */
export function SearchField({ style }: { style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const { garage } = useApp();
  const hint = garage ? `Search parts for your ${garage.model || garage.make}` : 'Search parts, brands or your car';
  return <SearchBar placeholder={hint} onPress={() => router.push('/search')} style={style} />;
}

function AppHeader({ style }: { style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { customer, cart } = useApp();

  return (
    <View style={[s.row, { paddingTop: insets.top + spacing.sm }, style]} pointerEvents="box-none">
      <Crest />
      {/* Centred on the row regardless of the icons' widths; never takes a tap. */}
      <View style={s.wordWrap} pointerEvents="none">
        <Text style={s.word} accessibilityRole="header" numberOfLines={1}>
          AUTOBACS
        </Text>
      </View>
      <View style={s.icons}>
        <IconButton
          icon="notifications-outline"
          label="Order updates"
          // No notification centre exists yet; order updates are the closest thing.
          onPress={() => router.push(customer ? '/orders' : '/login')}
          tone="plain"
          color={noir.text}
          size={36}
          iconSize={21}
        />
        <IconButton
          icon="bag-handle-outline"
          label={`Cart, ${cart.totalItems} items`}
          onPress={() => router.push('/(tabs)/cart')}
          badge={cart.totalItems}
          tone="plain"
          color={noir.text}
          size={36}
          iconSize={21}
        />
      </View>
    </View>
  );
}

export default memo(AppHeader);

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  wordWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 36, alignItems: 'center', justifyContent: 'center' },
  word: {
    fontFamily: font.serif,
    fontSize: 18,
    letterSpacing: 4.5,
    color: noir.text,
  },
  icons: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
