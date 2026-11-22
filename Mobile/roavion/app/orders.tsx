/**
 * My orders — what was bought, what it cost, and where it is.
 *
 * Status wording mirrors the website so an email, the site and the app never
 * describe the same parcel three different ways.
 */
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { fetchOrders, type Order } from '../src/api/account';
import { Photo } from '../src/components/ui';
import { colors, elevation, font, inr, radius, spacing, type } from '../src/theme';
import { EmptyState, ErrorState, ListSkeleton } from '../src/ui';
import { useApp } from '../src/store';

const STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'grey' | 'red' }> = {
  awaiting_payment: { label: 'Awaiting payment', tone: 'amber' },
  processing: { label: 'Processing', tone: 'amber' },
  shipped: { label: 'Shipped', tone: 'green' },
  delivered: { label: 'Delivered', tone: 'green' },
  returned: { label: 'Returned', tone: 'grey' },
  cancelled: { label: 'Cancelled', tone: 'red' },
};

const TONES = {
  green: { bg: colors.greenSoft, fg: colors.green },
  amber: { bg: colors.goldSoft, fg: colors.ink2 },
  grey: { bg: colors.page, fg: colors.muted },
  red: { bg: colors.redSoft, fg: colors.red },
};

/** Where each status sits on the delivery timeline; absent = no timeline (returned/cancelled). */
const STAGES = ['Placed', 'Processing', 'Shipped', 'Delivered'] as const;
const STAGE_OF: Record<string, number> = { awaiting_payment: 0, processing: 1, shipped: 2, delivered: 3 };

function Timeline({ stage }: { stage: number }) {
  return (
    <View style={s.timeline} accessibilityLabel={`Progress: ${STAGES[stage]}`}>
      {STAGES.map((label, i) => {
        const on = i <= stage;
        return (
          <View key={label} style={s.tlStep}>
            <View style={s.tlTrack}>
              <View style={[s.tlLine, { opacity: i === 0 ? 0 : 1 }, i <= stage && s.tlLineOn]} />
              <View style={[s.tlDot, on && s.tlDotOn, i === stage && s.tlDotNow]}>
                {on && i < stage && <Ionicons name="checkmark" size={9} color={colors.white} />}
              </View>
              <View style={[s.tlLine, { opacity: i === STAGES.length - 1 ? 0 : 1 }, i < stage && s.tlLineOn]} />
            </View>
            <Text style={[s.tlLabel, on && s.tlLabelOn]} numberOfLines={1}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function OrderCard({ order }: { order: Order }) {
  const status = STATUS[order.status] ?? { label: order.status, tone: 'grey' as const };
  const tone = TONES[status.tone];
  const stage = STAGE_OF[order.status];
  const when = order.placedAt
    ? new Date(order.placedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  return (
    <View style={s.card}>
      <View style={s.head}>
        <View>
          <Text style={s.overline}>Order</Text>
          <Text style={s.code}>{order.code}</Text>
          <Text style={s.when}>{when}</Text>
        </View>
        <View style={[s.pill, { backgroundColor: tone.bg }]}>
          <View style={[s.pillDot, { backgroundColor: tone.fg }]} />
          <Text style={[s.pillText, { color: tone.fg }]}>{status.label}</Text>
        </View>
      </View>

      {stage !== undefined && <Timeline stage={stage} />}

      {order.items.slice(0, 3).map((item, i) => (
        <View key={i} style={s.item}>
          <Photo uri={item.image} style={s.itemImage} />
          <View style={{ flex: 1 }}>
            <Text style={s.itemName} numberOfLines={2}>{item.name}</Text>
            <Text style={s.itemMeta}>Qty {item.quantity} · {inr(item.price)}</Text>
          </View>
        </View>
      ))}
      {order.items.length > 3 && <Text style={s.more}>+{order.items.length - 3} more</Text>}

      <View style={s.foot}>
        {/* Only say "paid" when the server says it was — an unpaid or failed order shows its total, not a payment. */}
        <Text style={s.footLabel}>
          {order.paymentStatus === 'paid' ? 'Total paid' : order.paymentStatus === 'refunded' ? 'Total (refunded)' : 'Order total'}
        </Text>
        <Text style={s.total}>{inr(order.total)}</Text>
      </View>
    </View>
  );
}

export default function OrdersScreen() {
  const router = useRouter();
  const { customer } = useApp();
  const orders = useQuery({ queryKey: ['orders'], queryFn: () => fetchOrders(), enabled: !!customer });

  if (!customer) {
    return (
      <View style={s.screen}>
        <EmptyState
          icon="receipt-outline"
          title="Sign in to see your orders"
          body="Your order history and tracking live in your account."
          action={{ label: 'Sign in', onPress: () => router.push('/login?next=/orders') }}
        />
      </View>
    );
  }

  if (orders.isLoading) {
    return (
      <View style={s.screen}>
        <ListSkeleton rows={4} thumb={56} />
      </View>
    );
  }

  if (orders.error) {
    return (
      <View style={s.screen}>
        <ErrorState error={orders.error} onRetry={() => orders.refetch()} />
      </View>
    );
  }

  if (!orders.data?.length) {
    return (
      <View style={s.screen}>
        <EmptyState
          icon="receipt-outline"
          title="No orders yet"
          body="When you place an order it will appear here."
          action={{ label: 'Start shopping', onPress: () => router.push('/(tabs)/shop') }}
        />
      </View>
    );
  }

  return (
    <FlatList
      style={s.screen}
      data={orders.data}
      keyExtractor={(o) => o.id}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={orders.isFetching} onRefresh={() => { orders.refetch(); }} tintColor={colors.green} colors={[colors.green]} />
      }
      renderItem={({ item }) => <OrderCard order={item} />}
    />
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.white, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.line,
    padding: spacing.lg, gap: spacing.md, ...elevation.e1,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  overline: { ...type.overline, fontSize: 10 },
  code: { fontFamily: font.heading, fontSize: 16, color: colors.ink },
  when: { ...type.caption, color: colors.muted },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.pill },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontFamily: font.semibold, fontSize: 11.5 },

  timeline: { flexDirection: 'row', paddingVertical: spacing.xs },
  tlStep: { flex: 1, alignItems: 'center', gap: 6 },
  tlTrack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  tlLine: { flex: 1, height: 2, backgroundColor: colors.line },
  tlLineOn: { backgroundColor: colors.green },
  tlDot: {
    width: 16, height: 16, borderRadius: 8, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  tlDotOn: { backgroundColor: colors.green, borderColor: colors.green },
  tlDotNow: { borderColor: colors.greenSoft, borderWidth: 3, width: 18, height: 18, borderRadius: 9 },
  tlLabel: { ...type.tiny, color: colors.steel },
  tlLabelOn: { fontFamily: font.semibold, color: colors.ink },

  item: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  itemImage: { width: 52, height: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  itemName: { fontFamily: font.medium, fontSize: 13.5, color: colors.ink },
  itemMeta: { ...type.caption, color: colors.muted },
  more: { ...type.caption, color: colors.muted },
  foot: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: spacing.md,
  },
  footLabel: { ...type.small, color: colors.muted },
  total: { fontFamily: font.heading, fontSize: 17, color: colors.ink },
});
