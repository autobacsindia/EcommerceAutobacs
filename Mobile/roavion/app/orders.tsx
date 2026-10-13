/**
 * My orders — what was bought, what it cost, and where it is.
 *
 * Status wording mirrors the website so an email, the site and the app never
 * describe the same parcel three different ways.
 */
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { fetchOrders, type Order } from '../src/api/account';
import { Photo, Screenful, T } from '../src/components/ui';
import { colors, font, inr, radius, shadow, spacing } from '../src/theme';
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
  amber: { bg: '#fdf3e2', fg: '#9a6700' },
  grey: { bg: '#eceeed', fg: colors.muted },
  red: { bg: '#fdeaee', fg: colors.red },
};

function OrderCard({ order }: { order: Order }) {
  const status = STATUS[order.status] ?? { label: order.status, tone: 'grey' as const };
  const tone = TONES[status.tone];
  const when = order.placedAt
    ? new Date(order.placedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  return (
    <View style={s.card}>
      <View style={s.head}>
        <View>
          <Text style={s.code}>{order.code}</Text>
          <Text style={s.when}>{when}</Text>
        </View>
        <View style={[s.pill, { backgroundColor: tone.bg }]}>
          <Text style={[s.pillText, { color: tone.fg }]}>{status.label}</Text>
        </View>
      </View>

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
        <T kind="small">Total paid</T>
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
      <Screenful
        emptyIcon="receipt-outline"
        emptyTitle="Sign in to see your orders"
        emptyBody="Your order history and tracking live in your account."
        action={{ label: 'Sign in', onPress: () => router.push('/login?next=/orders') }}
      />
    );
  }

  if (orders.isLoading || orders.error) {
    return (
      <Screenful
        loading={orders.isLoading}
        error={orders.error ? (orders.error as Error).message : null}
        onRetry={() => orders.refetch()}
      />
    );
  }

  if (!orders.data?.length) {
    return (
      <Screenful
        emptyIcon="receipt-outline"
        emptyTitle="No orders yet"
        emptyBody="When you place an order it will appear here."
        action={{ label: 'Start shopping', onPress: () => router.push('/(tabs)/shop') }}
      />
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      data={orders.data}
      keyExtractor={(o) => o.id}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      showsVerticalScrollIndicator={false}
      refreshing={orders.isFetching}
      onRefresh={() => orders.refetch()}
      renderItem={({ item }) => <OrderCard order={item} />}
    />
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, ...shadow.card },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  code: { fontFamily: font.bold, fontSize: 15, color: colors.ink },
  when: { fontFamily: font.regular, fontSize: 12, color: colors.muted },
  pill: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  pillText: { fontFamily: font.semibold, fontSize: 11.5 },
  item: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  itemImage: { width: 48, height: 48, borderRadius: radius.sm },
  itemName: { fontFamily: font.medium, fontSize: 13, color: colors.ink },
  itemMeta: { fontFamily: font.regular, fontSize: 12, color: colors.muted },
  more: { fontFamily: font.regular, fontSize: 12, color: colors.muted },
  foot: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.md,
  },
  total: { fontFamily: font.bold, fontSize: 16, color: colors.ink },
});
