/**
 * Cart — the same server-side cart as the website, so a basket started on the
 * phone can be finished on a laptop.
 *
 * Every amount shown here comes from the server. The app never adds up a total
 * itself, which is what keeps the price on screen and the price charged the same.
 */
import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Photo } from '../../src/components/ui';
import { colors, font, inr, radius, spacing, type } from '../../src/theme';
import { ApiError } from '../../src/api/client';
import { EmptyState, ErrorState, ListSkeleton, PremiumButton, PressScale } from '../../src/ui';
import { useApp } from '../../src/store';

export default function CartScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { cart, cartBusy, cartError, refreshCart, setQuantity, removeItem, customer } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    await refreshCart();
    setRetrying(false);
  };

  /**
   * Quantity / remove go through the server; if one fails (offline, item gone)
   * say so instead of letting the tap silently do nothing.
   */
  const write = (action: () => Promise<void>) =>
    action().catch((err: unknown) =>
      Alert.alert('Cart not updated', err instanceof ApiError ? err.message : 'Please check your connection and try again.'),
    );

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
      { text: 'Remove', style: 'destructive', onPress: () => write(() => removeItem(productId, variantId)) },
    ]);

  const soldOut = cart.items.some((i) => i.stock === 'out');

  // WhatsApp-style large bold title.
  const header = (
    <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
      <Text style={s.title} accessibilityRole="header">Cart</Text>
      {cart.items.length > 0 && (
        <Text style={s.subtitle}>
          {cart.totalItems} {cart.totalItems === 1 ? 'item' : 'items'}
        </Text>
      )}
    </View>
  );

  if (!cart.items.length) {
    return (
      <View style={s.screen}>
        {header}
        {customer === undefined ? (
          // Still restoring the session and cart on launch.
          <ListSkeleton rows={3} thumb={84} />
        ) : cartError ? (
          // Could not reach the server: don't claim the cart is empty.
          <ErrorState
            message="We couldn't load your cart. Check your connection and try again."
            onRetry={retry}
          />
        ) : (
          <EmptyState
            icon="bag-handle-outline"
            title="Your cart is empty"
            body="Browse parts and accessories for your car."
            action={{ label: 'Start shopping', onPress: () => router.push('/(tabs)/shop') }}
            secondary={{ label: 'Watch reels', onPress: () => router.push('/(tabs)/reels') }}
          />
        )}
      </View>
    );
  }

  return (
    <View style={s.screen}>
      {header}

      {cartError && (
        <PressScale onPress={retry} style={s.stale} accessibilityLabel="Couldn't refresh your cart. Tap to try again.">
          <Ionicons name="cloud-offline-outline" size={16} color={colors.ink2} />
          <Text style={s.staleText}>Showing your last saved cart. Prices are confirmed again at checkout.</Text>
          <Text style={s.staleAction}>{retrying ? '…' : 'Retry'}</Text>
        </PressScale>
      )}

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 220 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} colors={[colors.green]} />}
      >
        {/* Chat-row list: round photo, name, grey details, line amount on the right. */}
        <View style={s.list}>
          {cart.items.map((item, idx) => (
            <View
              key={`${item.productId}-${item.variantId ?? 'base'}`}
              style={[s.line, idx < cart.items.length - 1 && s.lineDivider]}
            >
              <PressScale onPress={() => item.slug && router.push(`/product/${item.slug}`)} style={s.imageWrap} accessibilityLabel={`Open ${item.name}`}>
                <Photo uri={item.image} style={s.image} />
              </PressScale>

              <View style={s.lineBody}>
                <View style={s.lineTop}>
                  <Text style={s.name} numberOfLines={2}>{item.name}</Text>
                  <Text style={s.lineTotal}>{inr(item.price * item.quantity)}</Text>
                </View>
                <Text style={s.unit} numberOfLines={1}>
                  {item.variantLabel ? `${item.variantLabel} · ` : ''}
                  {inr(item.price)} each
                  {item.stock === 'out' ? <Text style={s.outText}>  ·  Out of stock</Text> : null}
                  {item.stock === 'low' ? <Text style={s.lowText}>  ·  Only a few left</Text> : null}
                </Text>

                <View style={s.stepper}>
                  <PressScale
                    onPress={() =>
                      item.quantity <= 1
                        ? confirmRemove(item.productId, item.name, item.variantId)
                        : write(() => setQuantity(item.productId, item.quantity - 1, item.variantId))
                    }
                    disabled={cartBusy}
                    hitSlop={8}
                    haptic="selection"
                    scaleTo={0.9}
                    style={s.stepBtn}
                    accessibilityLabel={item.quantity <= 1 ? `Remove ${item.name}` : 'Decrease quantity'}
                  >
                    <Ionicons name={item.quantity <= 1 ? 'trash-outline' : 'remove'} size={16} color={item.quantity <= 1 ? colors.red : colors.ink} />
                  </PressScale>
                  <Text style={s.qty}>{item.quantity}</Text>
                  <PressScale
                    onPress={() => write(() => setQuantity(item.productId, item.quantity + 1, item.variantId))}
                    disabled={cartBusy || item.stock === 'out'}
                    hitSlop={8}
                    haptic="selection"
                    scaleTo={0.9}
                    style={[s.stepBtn, (cartBusy || item.stock === 'out') && { opacity: 0.4 }]}
                    accessibilityLabel="Increase quantity"
                  >
                    <Ionicons name="add" size={16} color={colors.green} />
                  </PressScale>
                </View>
              </View>
            </View>
          ))}
        </View>

        <View style={s.note}>
          <Ionicons name="information-circle-outline" size={16} color={colors.green} />
          <Text style={s.noteText}>
            Prices and the subtotal come from our server, and are checked again at checkout. Delivery is added there.
          </Text>
        </View>

        <View style={s.trustRow}>
          {[
            { icon: 'lock-closed-outline' as const, text: 'Secure payment' },
            { icon: 'shield-checkmark-outline' as const, text: 'Genuine parts' },
            { icon: 'repeat-outline' as const, text: 'Easy returns' },
          ].map((t) => (
            <View key={t.text} style={s.trust}>
              <Ionicons name={t.icon} size={16} color={colors.green} />
              <Text style={s.trustText}>{t.text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Sticky summary — the subtotal the server returned, never a local sum. */}
      <View style={s.bar}>
        <View style={s.barRow}>
          <View>
            <Text style={s.barLabel}>Subtotal</Text>
            <View style={s.barHintRow}>
              <Ionicons name="shield-checkmark-outline" size={12} color={colors.green} />
              <Text style={s.barHint}>Calculated by Autobacs · delivery at checkout</Text>
            </View>
          </View>
          <Text style={s.barTotal}>{inr(cart.totalPrice)}</Text>
        </View>
        {soldOut && (
          <View style={s.warnRow}>
            <Ionicons name="alert-circle" size={14} color={colors.red} />
            <Text style={s.warn}>Remove the out-of-stock item to continue.</Text>
          </View>
        )}
        <PremiumButton
          label={customer ? 'Proceed to checkout' : 'Sign in to checkout'}
          onPress={() => router.push(customer ? '/checkout' : '/login?next=/checkout')}
          disabled={soldOut || cartBusy}
          iconRight="arrow-forward"
          variant="green"
          full
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  header: { backgroundColor: colors.white, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { fontFamily: font.extrabold, fontSize: 30, color: colors.ink, letterSpacing: -0.5 },
  subtitle: { ...type.small, color: colors.muted },

  list: { backgroundColor: colors.white, marginBottom: spacing.md },
  line: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, alignItems: 'flex-start' },
  // Hairline divider inset past the photo, like chat rows.
  lineDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, marginLeft: 0 },
  imageWrap: {
    width: 56, height: 56, borderRadius: 28, overflow: 'hidden', backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
  },
  image: { width: 56, height: 56 },
  lineBody: { flex: 1, gap: 2 },
  lineTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  name: { flex: 1, fontFamily: font.semibold, fontSize: 15, lineHeight: 20, color: colors.ink },
  unit: { ...type.small, color: colors.muted },
  outText: { color: colors.red, fontFamily: font.semibold },
  lowText: { color: colors.ink2, fontFamily: font.semibold },
  lineTotal: { fontFamily: font.heading, fontSize: 15, color: colors.ink },
  stepper: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: spacing.sm,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, padding: 2,
  },
  stepBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  qty: { fontFamily: font.bold, fontSize: 14, color: colors.ink, minWidth: 28, textAlign: 'center' },

  note: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', padding: spacing.md,
    backgroundColor: colors.greenFaint, borderRadius: radius.md,
  },
  noteText: { ...type.small, color: colors.ink2, flex: 1 },
  trustRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.lg, paddingHorizontal: spacing.xs },
  trust: { alignItems: 'center', gap: 4, flex: 1 },
  trustText: { ...type.tiny, color: colors.muted },

  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line,
    padding: spacing.lg, gap: spacing.md,
  },
  barRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  barLabel: { fontFamily: font.semibold, fontSize: 15, color: colors.ink },
  barHint: { ...type.caption, color: colors.muted },
  barHintRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  stale: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.goldSoft,
  },
  staleText: { ...type.caption, color: colors.ink2, flex: 1 },
  staleAction: { fontFamily: font.bold, fontSize: 13, color: colors.green },
  barTotal: { fontFamily: font.extrabold, fontSize: 22, color: colors.ink },
  warnRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  warn: { fontFamily: font.medium, fontSize: 12, color: colors.red },
});
