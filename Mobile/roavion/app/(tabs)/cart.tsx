/**
 * Cart — the same server-side cart as the website, so a basket started on the
 * phone can be finished on a laptop.
 *
 * Every amount shown here comes from the server. The app never adds up a total
 * itself, which is what keeps the price on screen and the price charged the same.
 *
 * Look: Heritage Noir (carbon page, serif title, square carbon-2 line cards,
 * frosted sticky bar with a gold hairline and a white square CTA).
 */
import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Photo } from '../../src/components/ui';
import { font, inr, noir, noirSurface, radius, spacing, type } from '../../src/theme';
import { EmptyState, GoldRule, ListSkeleton, Overline, PremiumButton, PressScale, SerifTitle } from '../../src/ui';
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

  const header = (
    <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
      <Overline noir>Your bag</Overline>
      <View style={s.titleRow}>
        <SerifTitle size="title" italicLast accessibilityRole="header">Your cart</SerifTitle>
        {cart.items.length > 0 && (
          <Text style={s.subtitle}>
            {cart.totalItems} {cart.totalItems === 1 ? 'item' : 'items'}
          </Text>
        )}
      </View>
    </View>
  );

  if (!cart.items.length) {
    return (
      <View style={s.screen}>
        {header}
        {customer === undefined ? (
          // Still restoring the session and cart on launch.
          <ListSkeleton rows={3} thumb={84} dark />
        ) : (
          <EmptyState
            icon="bag-handle-outline"
            title="Your cart is empty"
            body="Browse parts and accessories for your car."
            action={{ label: 'Start shopping', onPress: () => router.push('/(tabs)/shop') }}
            onDark
          />
        )}
      </View>
    );
  }

  return (
    <View style={s.screen}>
      {header}

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 220 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={noir.gold} colors={[noir.green]} />}
      >
        {cart.items.map((item) => (
          <View key={`${item.productId}-${item.variantId ?? 'base'}`} style={[s.line, item.stock === 'out' && s.lineOut]}>
            <PressScale onPress={() => item.slug && router.push(`/product/${item.slug}`)} style={s.imageWrap} accessibilityLabel={`Open ${item.name}`}>
              <Photo uri={item.image} style={s.image} />
            </PressScale>

            <View style={s.lineBody}>
              <Text style={s.name} numberOfLines={2}>{item.name}</Text>
              {!!item.variantLabel && <Text style={s.variant}>{item.variantLabel}</Text>}
              <Text style={s.unit}>{inr(item.price)} each</Text>
              {item.stock === 'out' && <Text style={[s.stock, { color: noir.sale }]}>Out of stock</Text>}
              {item.stock === 'low' && <Text style={[s.stock, { color: noir.gold }]}>Only a few left</Text>}

              <View style={s.lineFoot}>
                <View style={s.stepper}>
                  <PressScale
                    onPress={() => setQuantity(item.productId, item.quantity - 1, item.variantId)}
                    disabled={cartBusy}
                    hitSlop={6}
                    haptic="selection"
                    scaleTo={0.9}
                    style={s.stepBtn}
                    accessibilityLabel="Decrease quantity"
                  >
                    <Ionicons name={item.quantity <= 1 ? 'trash-outline' : 'remove'} size={16} color={noir.text} />
                  </PressScale>
                  <Text style={s.qty}>{item.quantity}</Text>
                  <PressScale
                    onPress={() => setQuantity(item.productId, item.quantity + 1, item.variantId)}
                    disabled={cartBusy || item.stock === 'out'}
                    hitSlop={6}
                    haptic="selection"
                    scaleTo={0.9}
                    style={[s.stepBtn, (cartBusy || item.stock === 'out') && { opacity: 0.4 }]}
                    accessibilityLabel="Increase quantity"
                  >
                    <Ionicons name="add" size={16} color={noir.text} />
                  </PressScale>
                </View>
                <Text style={s.lineTotal}>{inr(item.price * item.quantity)}</Text>
              </View>
            </View>

            <PressScale
              onPress={() => confirmRemove(item.productId, item.name, item.variantId)}
              hitSlop={8}
              scaleTo={0.9}
              style={s.remove}
              accessibilityLabel={`Remove ${item.name}`}
            >
              <Ionicons name="close" size={16} color={noir.textMuted} />
            </PressScale>
          </View>
        ))}

        <View style={s.note}>
          <Ionicons name="information-circle-outline" size={16} color={noir.greenText} />
          <Text style={s.noteText}>Delivery and taxes are calculated at checkout.</Text>
        </View>

        <View style={s.trustRow}>
          {[
            { icon: 'lock-closed-outline' as const, text: 'Secure payment' },
            { icon: 'shield-checkmark-outline' as const, text: 'Genuine parts' },
            { icon: 'repeat-outline' as const, text: 'Easy returns' },
          ].map((t) => (
            <View key={t.text} style={s.trust}>
              <Ionicons name={t.icon} size={16} color={noir.gold} />
              <Text style={s.trustText}>{t.text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Sticky summary — the subtotal the server returned, never a local sum. */}
      <View style={s.bar}>
        <GoldRule style={s.barRule} />
        <View style={s.barRow}>
          <View>
            <Text style={s.barLabel}>Subtotal</Text>
            <Text style={s.barHint}>Before delivery and taxes</Text>
          </View>
          <Text style={s.barTotal}>{inr(cart.totalPrice)}</Text>
        </View>
        {soldOut && (
          <View style={s.warnRow}>
            <Ionicons name="alert-circle" size={14} color={noir.sale} />
            <Text style={s.warn}>Remove the out-of-stock item to continue.</Text>
          </View>
        )}
        <PremiumButton
          label={customer ? 'Proceed to checkout' : 'Sign in to checkout'}
          onPress={() => router.push(customer ? '/checkout' : '/login?next=/checkout')}
          disabled={soldOut || cartBusy}
          iconRight="arrow-forward"
          variant="noir"
          full
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: noir.page },
  header: { backgroundColor: noir.page, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 },
  subtitle: { ...type.smallNoir },

  line: { ...noirSurface, flexDirection: 'row', gap: spacing.md, padding: spacing.md, marginBottom: spacing.md },
  lineOut: { borderColor: noir.sale },
  imageWrap: { borderRadius: radius.square, overflow: 'hidden' },
  image: { width: 88, height: 88 },
  lineBody: { flex: 1, gap: 3 },
  name: { fontFamily: font.serif, fontSize: 15, lineHeight: 20, color: noir.text, paddingRight: spacing.xl },
  variant: { ...type.capsNoir, color: noir.textMuted },
  unit: { ...type.smallNoir, fontSize: 12, color: noir.textFaint },
  stock: { ...type.capsNoir, marginTop: 2 },
  lineFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  stepper: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: noir.hairlineStrong, borderRadius: radius.square,
  },
  stepBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  qty: { fontFamily: font.bold, fontSize: 14, color: noir.text, minWidth: 28, textAlign: 'center' },
  lineTotal: { fontFamily: font.heading, fontSize: 16, color: noir.text },
  remove: {
    position: 'absolute', top: spacing.sm, right: spacing.sm, width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },

  note: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', padding: spacing.md,
    borderWidth: 1, borderColor: noir.hairline, borderRadius: radius.square,
  },
  noteText: { ...type.smallNoir, flex: 1 },
  trustRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.lg, paddingHorizontal: spacing.xs },
  trust: { alignItems: 'center', gap: 4, flex: 1 },
  trustText: { fontFamily: font.medium, fontSize: 11, color: noir.textMuted },

  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: noir.glassStrong,
    padding: spacing.lg, gap: spacing.md,
  },
  barRule: { position: 'absolute', top: 0, left: 0, right: 0 },
  barRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  barLabel: { ...type.capsNoir, color: noir.textMuted },
  barHint: { ...type.smallNoir, fontSize: 12, color: noir.textFaint, marginTop: 2 },
  barTotal: { fontFamily: font.extrabold, fontSize: 22, color: noir.text },
  warnRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  warn: { fontFamily: font.medium, fontSize: 12, color: noir.sale },
});
