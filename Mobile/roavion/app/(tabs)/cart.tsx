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
import { colors, elevation, font, inr, radius, spacing, type } from '../../src/theme';
import { ApiError } from '../../src/api/client';
import { Badge, EmptyState, ErrorState, ListSkeleton, Overline, PremiumButton, PressScale, Stripes } from '../../src/ui';
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

  const header = (
    <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
      <View style={s.overRow}>
        <Stripes width={10} height={3} gap={2} />
        <Overline>Your bag</Overline>
      </View>
      <View style={s.titleRow}>
        <Text style={s.title} accessibilityRole="header">Cart</Text>
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
        {cart.items.map((item) => (
          <View key={`${item.productId}-${item.variantId ?? 'base'}`} style={[s.line, item.stock === 'out' && s.lineOut]}>
            <PressScale onPress={() => item.slug && router.push(`/product/${item.slug}`)} style={s.imageWrap} accessibilityLabel={`Open ${item.name}`}>
              <Photo uri={item.image} style={s.image} />
            </PressScale>

            <View style={s.lineBody}>
              <Text style={s.name} numberOfLines={2}>{item.name}</Text>
              {!!item.variantLabel && <Text style={s.variant}>{item.variantLabel}</Text>}
              <Text style={s.unit}>{inr(item.price)} each</Text>
              {item.stock === 'out' && <Badge text="Out of stock" tone="red" style={{ alignSelf: 'flex-start', marginTop: 2 }} />}
              {item.stock === 'low' && <Badge text="Only a few left" tone="gold" style={{ alignSelf: 'flex-start', marginTop: 2 }} />}

              <View style={s.lineFoot}>
                <View style={s.stepper}>
                  <PressScale
                    onPress={() =>
                      item.quantity <= 1
                        ? confirmRemove(item.productId, item.name, item.variantId)
                        : write(() => setQuantity(item.productId, item.quantity - 1, item.variantId))
                    }
                    disabled={cartBusy}
                    hitSlop={6}
                    haptic="selection"
                    scaleTo={0.9}
                    style={s.stepBtn}
                    accessibilityLabel={item.quantity <= 1 ? `Remove ${item.name}` : 'Decrease quantity'}
                  >
                    <Ionicons name={item.quantity <= 1 ? 'trash-outline' : 'remove'} size={16} color={colors.ink} />
                  </PressScale>
                  <Text style={s.qty}>{item.quantity}</Text>
                  <PressScale
                    onPress={() => write(() => setQuantity(item.productId, item.quantity + 1, item.variantId))}
                    disabled={cartBusy || item.stock === 'out'}
                    hitSlop={6}
                    haptic="selection"
                    scaleTo={0.9}
                    style={[s.stepBtn, (cartBusy || item.stock === 'out') && { opacity: 0.4 }]}
                    accessibilityLabel="Increase quantity"
                  >
                    <Ionicons name="add" size={16} color={colors.ink} />
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
              <Ionicons name="close" size={16} color={colors.muted} />
            </PressScale>
          </View>
        ))}

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
          full
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.bg, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  overRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 2 },
  title: { ...type.display },
  subtitle: { ...type.small, color: colors.muted },

  line: {
    flexDirection: 'row', gap: spacing.md, backgroundColor: colors.white, borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.line, padding: spacing.md, marginBottom: spacing.md, ...elevation.e1,
  },
  lineOut: { borderColor: colors.redSoft },
  imageWrap: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  image: { width: 88, height: 88 },
  lineBody: { flex: 1, gap: 3 },
  name: { fontFamily: font.medium, fontSize: 14, lineHeight: 19, color: colors.ink, paddingRight: spacing.xl },
  variant: { ...type.overline, fontSize: 10 },
  unit: { ...type.caption, color: colors.muted },
  lineFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  stepper: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.page,
    borderRadius: radius.pill, padding: 3,
  },
  stepBtn: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.white,
    alignItems: 'center', justifyContent: 'center', ...elevation.e1,
  },
  qty: { fontFamily: font.bold, fontSize: 14, color: colors.ink, minWidth: 30, textAlign: 'center' },
  lineTotal: { fontFamily: font.heading, fontSize: 16, color: colors.ink },
  remove: {
    position: 'absolute', top: spacing.sm, right: spacing.sm, width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.page, alignItems: 'center', justifyContent: 'center',
  },

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
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.lg, gap: spacing.md, ...elevation.e3,
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
