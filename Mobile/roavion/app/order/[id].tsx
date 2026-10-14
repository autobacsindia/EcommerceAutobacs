/**
 * One order — everything about it, without leaving the app.
 *
 * ── Why this screen exists ──────────────────────────────────────────────────
 * The orders list showed a code, a status pill, three item thumbnails and a
 * total, and nothing was tappable. A customer who had already paid could not
 * see the rest of what they bought, the address it was going to, what they were
 * charged for delivery, or where the parcel had got to. "Track an order" in the
 * account tab opened the WEBSITE in a browser, which asks someone who is
 * already signed in to sign in again somewhere else.
 *
 * ── The progress track ──────────────────────────────────────────────────────
 * Built from the order's own `statusHistory`, not from the current status
 * alone, so each step carries the date it actually happened. Where a step has
 * no recorded timestamp — true of orders migrated from the old site — the step
 * is drawn as reached but undated rather than invented.
 *
 * A cancelled or returned order leaves the path entirely. It gets a plain
 * statement instead of a progress track, because drawing "Delivered" as the
 * greyed-out next step on a cancelled order reads as a promise.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 * No invoice button. The invoice endpoint is auth-gated, so handing the URL to
 * the phone's browser would open a 401 page; doing it properly means streaming
 * the PDF through the API client and into a share sheet, which is its own
 * piece of work rather than a button bolted on here.
 */
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { fetchOrder, type OrderDetail } from '../../src/api/account';
import { JOURNEY, isOffPath, statusOf, TONES } from '../../src/lib/orderStatus';
import { Photo, Screenful } from '../../src/components/ui';
import { colors, font, inr, radius, shadow, spacing } from '../../src/theme';
import { useApp } from '../../src/store';

const dateOf = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

const timeOf = (iso: string) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '';

/** Rupee row in the totals block. `strong` is the line someone actually looks for. */
function Money({ label, value, strong, negative }: { label: string; value: number; strong?: boolean; negative?: boolean }) {
  return (
    <View style={s.moneyRow}>
      <Text style={[s.moneyLabel, strong && s.moneyStrong]}>{label}</Text>
      <Text style={[s.moneyValue, strong && s.moneyStrong, negative && s.moneyOff]}>
        {negative ? `− ${inr(Math.abs(value))}` : inr(value)}
      </Text>
    </View>
  );
}

/**
 * Processing → Shipped → Delivered, with the date each step happened.
 *
 * `reached` comes from the history where there is one and falls back to the
 * order's current position in the journey, so an order with no history (legacy,
 * or one whose status was set directly) still shows where it is.
 */
function Journey({ order }: { order: OrderDetail }) {
  const whenReached = new Map(order.history.map((h) => [h.status, h.at]));
  const currentIndex = JOURNEY.indexOf(order.status as (typeof JOURNEY)[number]);

  return (
    <View style={s.journey}>
      {JOURNEY.map((step, i) => {
        const at = whenReached.get(step) ?? '';
        const reached = !!at || (currentIndex >= 0 && i <= currentIndex);
        const last = i === JOURNEY.length - 1;
        return (
          <View key={step} style={s.step}>
            <View style={s.stepRail}>
              <View style={[s.dot, reached && s.dotOn]}>
                {reached && <Ionicons name="checkmark" size={12} color={colors.white} />}
              </View>
              {!last && <View style={[s.bar, reached && s.barOn]} />}
            </View>
            <View style={s.stepText}>
              <Text style={[s.stepLabel, reached && s.stepLabelOn]}>{statusOf(step).label}</Text>
              {at ? <Text style={s.stepWhen}>{dateOf(at)} · {timeOf(at)}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { customer } = useApp();

  const { data: order, isLoading, isError, refetch } = useQuery({
    queryKey: ['order', id],
    queryFn: ({ signal }) => fetchOrder(String(id), signal),
    enabled: !!id && !!customer,
  });

  if (!customer) {
    return (
      <>
        <Stack.Screen options={{ title: 'Order' }} />
        <Screenful
          emptyIcon="lock-closed-outline"
          emptyTitle="Sign in to see this order"
          emptyBody="Your orders are tied to your account."
          action={{ label: 'Sign in', onPress: () => router.push('/login?next=/orders') }}
        />
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Order' }} />
        <Screenful loading />
      </>
    );
  }

  if (isError || !order) {
    return (
      <>
        <Stack.Screen options={{ title: 'Order' }} />
        <Screenful
          error="We couldn't open this order. Check your connection and try again."
          onRetry={() => { void refetch(); }}
        />
      </>
    );
  }

  const status = statusOf(order.status);
  const tone = TONES[status.tone];
  const offPath = isOffPath(order.status);
  // Only sum what the server actually sent; a legacy order with no breakdown
  // shows its total alone rather than a column of convincing zeroes.
  const hasBreakdown = order.subtotal > 0;

  return (
    <>
      <Stack.Screen options={{ title: order.code }} />
      <ScrollView style={s.screen} contentContainerStyle={s.content}>
        <View style={s.card}>
          <View style={s.head}>
            <View>
              <Text style={s.code}>{order.code}</Text>
              <Text style={s.when}>Placed {dateOf(order.placedAt)}</Text>
            </View>
            <View style={[s.pill, { backgroundColor: tone.bg }]}>
              <Text style={[s.pillText, { color: tone.fg }]}>{status.label}</Text>
            </View>
          </View>

          {offPath ? (
            <Text style={s.offPath}>
              {order.status === 'cancelled'
                ? 'This order was cancelled. Any payment made is refunded to the original method.'
                : 'This order was returned.'}
            </Text>
          ) : (
            <Journey order={order} />
          )}

          {!!order.trackingNumber && (
            <View style={s.tracking}>
              <Text style={s.trackLabel}>
                {order.carrier ? `${order.carrier} tracking` : 'Tracking number'}
              </Text>
              <Text selectable style={s.trackNumber}>{order.trackingNumber}</Text>
            </View>
          )}
        </View>

        <View style={s.card}>
          <Text style={s.sectionTitle}>{order.items.length === 1 ? '1 item' : `${order.items.length} items`}</Text>
          {order.items.map((item, i) => (
            <View key={i} style={[s.item, i > 0 && s.itemTop]}>
              <Photo uri={item.image} style={s.thumb} />
              <View style={s.itemBody}>
                <Text style={s.itemName} numberOfLines={3}>{item.name}</Text>
                <Text style={s.itemMeta}>Qty {item.quantity}</Text>
              </View>
              <Text style={s.itemPrice}>{inr(item.price * item.quantity)}</Text>
            </View>
          ))}
        </View>

        <View style={s.card}>
          <Text style={s.sectionTitle}>Payment</Text>
          {hasBreakdown && (
            <>
              <Money label="Items" value={order.subtotal} />
              {order.discount > 0 && (
                <Money
                  label={order.couponCode ? `Discount (${order.couponCode})` : 'Discount'}
                  value={order.discount}
                  negative
                />
              )}
              <Money label={order.shipping > 0 ? 'Delivery' : 'Delivery (free)'} value={order.shipping} />
              {order.tax > 0 && <Money label="Tax" value={order.tax} />}
            </>
          )}
          <Money label="Total paid" value={order.total} strong />
          {!!order.paymentMethod && <Text style={s.payMeta}>Paid by {order.paymentMethod}</Text>}
        </View>

        {order.address && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Delivering to</Text>
            <Text style={s.addrName}>{order.address.fullName}</Text>
            <Text style={s.addrLine}>
              {[order.address.line1, order.address.line2, order.address.city, order.address.state, order.address.postalCode]
                .filter(Boolean)
                .join(', ')}
            </Text>
            {!!order.address.phone && <Text style={s.addrLine}>{order.address.phone}</Text>}
          </View>
        )}

        <View style={s.card}>
          <Text style={s.sectionTitle}>Need help with this order?</Text>
          <Pressable
            style={s.help}
            onPress={() => Linking.openURL(`https://wa.me/919895257905?text=${encodeURIComponent(`Hi, about my order ${order.code}`)}`)}
            accessibilityRole="button"
          >
            <Ionicons name="logo-whatsapp" size={19} color={colors.green} />
            <Text style={s.helpText}>WhatsApp us about {order.code}</Text>
            <Ionicons name="chevron-forward" size={17} color={colors.muted} />
          </Pressable>
        </View>
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },

  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.lg, ...shadow.card },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  code: { fontFamily: font.bold, fontSize: 17, color: colors.ink },
  when: { fontFamily: font.regular, fontSize: 12.5, color: colors.muted, marginTop: 2 },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  pillText: { fontFamily: font.semibold, fontSize: 11.5 },

  offPath: { fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: colors.ink2, marginTop: spacing.md },

  journey: { marginTop: spacing.lg },
  step: { flexDirection: 'row', gap: spacing.md },
  stepRail: { alignItems: 'center', width: 22 },
  dot: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.line,
    backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center',
  },
  dotOn: { backgroundColor: colors.green, borderColor: colors.green },
  bar: { flex: 1, width: 2, minHeight: 26, backgroundColor: colors.line },
  barOn: { backgroundColor: colors.green },
  stepText: { flex: 1, paddingBottom: spacing.lg },
  stepLabel: { fontFamily: font.semibold, fontSize: 14, color: colors.muted },
  stepLabelOn: { color: colors.ink },
  stepWhen: { fontFamily: font.regular, fontSize: 12, color: colors.muted, marginTop: 2 },

  tracking: { marginTop: spacing.xs, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line },
  trackLabel: { fontFamily: font.regular, fontSize: 12, color: colors.muted },
  trackNumber: { fontFamily: font.bold, fontSize: 15, color: colors.ink, marginTop: 3, letterSpacing: 0.4 },

  sectionTitle: { fontFamily: font.bold, fontSize: 15, color: colors.ink, marginBottom: spacing.md },

  item: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  itemTop: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line },
  thumb: { width: 54, height: 54, borderRadius: radius.sm, backgroundColor: colors.bg },
  itemBody: { flex: 1 },
  itemName: { fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: colors.ink },
  itemMeta: { fontFamily: font.regular, fontSize: 12, color: colors.muted, marginTop: 3 },
  itemPrice: { fontFamily: font.semibold, fontSize: 13.5, color: colors.ink },

  moneyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  moneyLabel: { fontFamily: font.regular, fontSize: 13.5, color: colors.ink2 },
  moneyValue: { fontFamily: font.regular, fontSize: 13.5, color: colors.ink2 },
  moneyStrong: { fontFamily: font.bold, fontSize: 15, color: colors.ink },
  moneyOff: { color: colors.green },
  payMeta: { fontFamily: font.regular, fontSize: 12, color: colors.muted, marginTop: spacing.xs },

  addrName: { fontFamily: font.semibold, fontSize: 13.5, color: colors.ink },
  addrLine: { fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: colors.ink2, marginTop: 2 },

  help: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  helpText: { flex: 1, fontFamily: font.semibold, fontSize: 13.5, color: colors.ink },
});
