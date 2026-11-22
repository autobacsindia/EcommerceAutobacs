/**
 * My orders — what was bought, what it cost, and where it is.
 *
 * Status wording mirrors the website so an email, the site and the app never
 * describe the same parcel three different ways.
 */
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { fetchOrders, type Order } from '../src/api/account';
import { Photo } from '../src/components/ui';
import { colors, font, inr, radius, spacing, type } from '../src/theme';
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

/**
 * One order as a WhatsApp-style chat row: round photo of the first item, the
 * item name, grey order number + status, and the date / amount on the right.
 * Amounts are the order's own stored total (a snapshot), never recomputed.
 */
function OrderRow({ order, last }: { order: Order; last: boolean }) {
  const status = STATUS[order.status] ?? { label: order.status, tone: 'grey' as const };
  const tone = TONES[status.tone];
  const when = order.placedAt
    ? new Date(order.placedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  const first = order.items[0];
  const more = order.items.length - 1;
  const paid = order.paymentStatus === 'paid';

  return (
    <View
      style={[s.row, !last && s.rowDivider]}
      accessible
      accessibilityLabel={`Order ${order.code}, ${status.label}, ${inr(order.total)}${paid ? ' paid' : ''}, ${when}`}
    >
      <Photo uri={first?.image ?? ''} style={s.thumb} />
      <View style={s.rowBody}>
        <View style={s.rowTop}>
          <Text style={s.itemName} numberOfLines={1}>{first?.name ?? 'Order'}</Text>
          <Text style={s.when}>{when}</Text>
        </View>
        <View style={s.rowTop}>
          <Text style={s.sub} numberOfLines={1}>
            {order.code}
            {more > 0 ? ` · +${more} more` : ''}
            {first ? ` · Qty ${first.quantity}` : ''}
          </Text>
          <Text style={s.total}>{inr(order.total)}</Text>
        </View>
        <View style={s.rowTop}>
          <View style={[s.pill, { backgroundColor: tone.bg }]}>
            <View style={[s.pillDot, { backgroundColor: tone.fg }]} />
            <Text style={[s.pillText, { color: tone.fg }]}>{status.label}</Text>
          </View>
          {/* "Paid" only when the server says so. */}
          <Text style={s.paidNote}>{paid ? 'Paid' : order.paymentStatus === 'refunded' ? 'Refunded' : 'Not paid'}</Text>
        </View>
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
      style={s.list}
      data={orders.data}
      keyExtractor={(o) => o.id}
      contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={orders.isFetching} onRefresh={() => { orders.refetch(); }} tintColor={colors.green} colors={[colors.green]} />
      }
      renderItem={({ item, index }) => <OrderRow order={item} last={index === (orders.data?.length ?? 0) - 1} />}
    />
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1, backgroundColor: colors.white },
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, alignItems: 'flex-start' },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  thumb: { width: 52, height: 52, borderRadius: 26, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  rowBody: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  itemName: { flex: 1, fontFamily: font.semibold, fontSize: 15, color: colors.ink },
  when: { ...type.caption, color: colors.muted },
  sub: { flex: 1, ...type.small, color: colors.muted },
  total: { fontFamily: font.heading, fontSize: 15, color: colors.ink },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontFamily: font.semibold, fontSize: 11.5 },
  paidNote: { ...type.caption, color: colors.muted },
});
