/**
 * Cart — the same server-side cart as the website, so a basket started on the
 * phone can be finished on a laptop.
 *
 * Every amount shown here comes from the server. The app never adds up a total
 * itself, which is what keeps the price on screen and the price charged the same.
 */
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Badge, Button, Photo, Screenful, T } from '../../src/components/ui';
import { colors, font, inr, radius, shadow, spacing } from '../../src/theme';
import { useApp } from '../../src/store';

export default function CartScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { cart, cartBusy, refreshCart, setQuantity, removeItem, customer } = useApp();
  const [refreshing, setRefreshing] = useState(false);

  // Someone may have changed the cart on the website since this tab last loaded.
  useFocusEffect(
    useCallback(() => {
      refreshCart();
    }, [refreshCart]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshCart();
    setRefreshing(false);
  };

  const confirmRemove = (productId: string, name: string, variantId: string | null) =>
    Alert.alert('Remove item', `Remove "${name}" from your cart?`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeItem(productId, variantId) },
    ]);

  const soldOut = cart.items.some((i) => i.stock === 'out');

  if (!cart.items.length) {
    return (
      <View style={s.screen}>
        <View style={[s.header, { paddingTop: insets.top + spacing.sm }]}>
          <Text style={s.title}>Your cart</Text>
        </View>
        <Screenful
          emptyIcon="cart-outline"
          emptyTitle="Your cart is empty"
          emptyBody="Browse parts and accessories for your car."
          action={{ label: 'Start shopping', onPress: () => router.push('/(tabs)/shop') }}
        />
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={s.title}>Your cart</Text>
        <Text style={s.subtitle}>
          {cart.totalItems} {cart.totalItems === 1 ? 'item' : 'items'}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 220 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />}
      >
        {cart.items.map((item) => (
          <View key={`${item.productId}-${item.variantId ?? 'base'}`} style={s.line}>
            {/* Photo AND name open the product. Only the thumbnail did, which
                is the smallest target on the row and the last place anyone
                taps — people tap the name. */}
            <Pressable
              onPress={() => item.slug && router.push(`/product/${item.slug}`)}
              disabled={!item.slug}
              accessibilityRole="button"
              accessibilityLabel={`View ${item.name}`}
              style={({ pressed }) => pressed && { opacity: 0.85 }}
            >
              <Photo uri={item.image} style={s.image} />
            </Pressable>

            <View style={s.lineBody}>
              <Pressable
                onPress={() => item.slug && router.push(`/product/${item.slug}`)}
                disabled={!item.slug}
                accessibilityRole="button"
                accessibilityLabel={`View ${item.name}`}
                style={({ pressed }) => pressed && { opacity: 0.6 }}
              >
                <Text style={s.name} numberOfLines={2}>{item.name}</Text>
              </Pressable>
              {!!item.variantLabel && <Text style={s.variant}>{item.variantLabel}</Text>}
              <Text style={s.unit}>{inr(item.price)} each</Text>
              {item.stock === 'out' && <Badge text="Out of stock" tone="red" />}

              <View style={s.lineFoot}>
                <View style={s.stepper}>
                  <Pressable
                    onPress={() => setQuantity(item.productId, item.quantity - 1, item.variantId)}
                    disabled={cartBusy}
                    hitSlop={6}
                    style={s.stepBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease quantity"
                  >
                    <Ionicons name={item.quantity <= 1 ? 'trash-outline' : 'remove'} size={16} color={colors.ink2} />
                  </Pressable>
                  <Text style={s.qty}>{item.quantity}</Text>
                  <Pressable
                    onPress={() => setQuantity(item.productId, item.quantity + 1, item.variantId)}
                    disabled={cartBusy || item.stock === 'out'}
                    hitSlop={6}
                    style={s.stepBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Increase quantity"
                  >
                    <Ionicons name="add" size={16} color={colors.ink2} />
                  </Pressable>
                </View>
                <Text style={s.lineTotal}>{inr(item.price * item.quantity)}</Text>
              </View>
            </View>

            <Pressable
              onPress={() => confirmRemove(item.productId, item.name, item.variantId)}
              hitSlop={8}
              style={s.remove}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.name}`}
            >
              <Ionicons name="close" size={18} color={colors.muted} />
            </Pressable>
          </View>
        ))}

        <View style={s.note}>
          <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
          <T kind="small" style={{ flex: 1 }}>
            Delivery and taxes are calculated at checkout.
          </T>
        </View>
      </ScrollView>

      {/* Sticky summary — the subtotal the server returned, never a local sum. */}
      <View style={[s.bar, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={s.barRow}>
          <T kind="small">Subtotal</T>
          <Text style={s.barTotal}>{inr(cart.totalPrice)}</Text>
        </View>
        {soldOut && <Text style={s.warn}>Remove the out-of-stock item to continue.</Text>}
        <Button
          label={customer ? 'Proceed to checkout' : 'Sign in to checkout'}
          onPress={() => router.push(customer ? '/checkout' : '/login?next=/checkout')}
          disabled={soldOut || cartBusy}
          icon="arrow-forward"
          full
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.header, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { fontFamily: font.bold, fontSize: 20, color: colors.white },
  subtitle: { fontFamily: font.regular, fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },

  line: {
    flexDirection: 'row', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg,
    padding: spacing.md, marginBottom: spacing.md, ...shadow.card,
  },
  image: { width: 78, height: 78, borderRadius: radius.md },
  lineBody: { flex: 1, gap: 3 },
  name: { fontFamily: font.medium, fontSize: 13, lineHeight: 18, color: colors.ink, paddingRight: spacing.lg },
  variant: { fontFamily: font.semibold, fontSize: 11, color: colors.green, textTransform: 'uppercase' },
  unit: { fontFamily: font.regular, fontSize: 11.5, color: colors.muted },
  lineFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  stepper: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.pill, paddingHorizontal: 4,
  },
  stepBtn: { padding: 7 },
  qty: { fontFamily: font.bold, fontSize: 13, color: colors.ink, minWidth: 26, textAlign: 'center' },
  lineTotal: { fontFamily: font.bold, fontSize: 14, color: colors.ink },
  remove: { position: 'absolute', top: spacing.sm, right: spacing.sm, padding: 4 },

  note: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingHorizontal: spacing.xs },

  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.card,
    borderTopWidth: 1, borderTopColor: colors.line, padding: spacing.lg, gap: spacing.md,
  },
  barRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  barTotal: { fontFamily: font.bold, fontSize: 18, color: colors.ink },
  warn: { fontFamily: font.medium, fontSize: 11.5, color: colors.red },
});
