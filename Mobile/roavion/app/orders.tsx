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
import { font, inr, noir, noirSurface, radius, spacing, type } from '../src/theme';
import { EmptyState, ErrorState, ListSkeleton, SerifTitle } from '../src/ui';
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
  green: { bg: noir.greenWash, fg: noir.text, dot: noir.greenText },
  amber: { bg: noir.goldFaint, fg: noir.text, dot: noir.gold },
  grey: { bg: noir.page, fg: noir.textMuted, dot: noir.textFaint },
  red: { bg: noir.page, fg: noir.sale, dot: noir.sale },
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
                {on && i < stage && <Ionicons name="checkmark" size={9} color={noir.text} />}
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
          <SerifTitle size="section">{order.code}</SerifTitle>
          <Text style={s.when}>{when}</Text>
        </View>
        <View style={[s.pill, { backgroundColor: tone.bg }]}>
          <View style={[s.pillDot, { backgroundColor: tone.dot }]} />
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
        <Text style={s.footLabel}>Total paid</Text>
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
          onDark
        />
      </View>
    );
  }

  if (orders.isLoading) {
    return (
      <View style={s.screen}>
        <ListSkeleton rows={4} thumb={56} dark />
      </View>
    );
  }

  if (orders.error) {
    return (
      <View style={s.screen}>
        <ErrorState error={orders.error} onRetry={() => orders.refetch()} onDark />
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
          onDark
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
        <RefreshControl refreshing={orders.isFetching} onRefresh={() => { orders.refetch(); }} tintColor={noir.gold} colors={[noir.green]} />
      }
      renderItem={({ item }) => <OrderCard order={item} />}
    />
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: noir.page },
  card: { ...noirSurface, padding: spacing.lg, gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  overline: { ...type.capsNoir },
  when: { ...type.smallNoir, fontSize: 12, color: noir.textFaint },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 5,
    borderRadius: radius.square, borderWidth: 1, borderColor: noir.hairlineStrong,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontFamily: font.heading, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' },

  timeline: { flexDirection: 'row', paddingVertical: spacing.xs },
  tlStep: { flex: 1, alignItems: 'center', gap: 6 },
  tlTrack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  tlLine: { flex: 1, height: 1, backgroundColor: noir.hairlineStrong },
  tlLineOn: { backgroundColor: noir.gold },
  tlDot: {
    width: 16, height: 16, borderRadius: 8, backgroundColor: noir.page, borderWidth: 1.5, borderColor: noir.hairlineStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  tlDotOn: { backgroundColor: noir.green, borderColor: noir.gold },
  tlDotNow: { borderWidth: 2.5, width: 18, height: 18, borderRadius: 9 },
  tlLabel: { fontFamily: font.medium, fontSize: 10.5, color: noir.textFaint },
  tlLabelOn: { fontFamily: font.semibold, color: noir.text },

  item: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  itemImage: { width: 52, height: 52, borderRadius: radius.square },
  itemName: { fontFamily: font.serif, fontSize: 14, color: noir.text },
  itemMeta: { ...type.smallNoir, fontSize: 12, color: noir.textFaint },
  more: { ...type.smallNoir, fontSize: 12, color: noir.textFaint },
  foot: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: noir.goldLine, paddingTop: spacing.md,
  },
  footLabel: { ...type.capsNoir, color: noir.textMuted },
  total: { fontFamily: font.heading, fontSize: 17, color: noir.text },
});
