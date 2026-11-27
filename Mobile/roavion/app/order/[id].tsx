/**
 * One order: the order-update picture ("order moment") on top, then what was
 * bought and what it cost.
 *
 * Everything here is the server's: the picture's key (GET /orders/:id → `moment`),
 * the status, the payment state and the amounts (the order's own stored snapshot,
 * never recomputed). The app never moves an order forward on its own.
 */
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { fetchOrder } from '../../src/api/account';
import { Photo } from '../../src/components/ui';
import { OrderMoment } from '../../src/orders/OrderMoment';
import { orderStatus, paymentLabel } from '../../src/orders/orderStatus';
import { useApp } from '../../src/store';
import { colors, font, inr, radius, spacing, type } from '../../src/theme';
import { EmptyState, ErrorState, ListSkeleton } from '../../src/ui';

export default function OrderScreen() {
  const router = useRouter();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = typeof rawId === 'string' ? rawId : '';
  const { customer } = useApp();
  const order = useQuery({
    queryKey: ['order', id],
    queryFn: ({ signal }) => fetchOrder(id, signal),
    enabled: !!customer && !!id,
    // An order update should show the moment it's opened, not a minute later.
    staleTime: 0,
  });

  if (!customer) {
    return (
      <View style={s.screen}>
        <EmptyState
          icon="receipt-outline"
          title="Sign in to see this order"
          body="Your orders and their updates live in your account."
          action={{ label: 'Sign in', onPress: () => router.push(`/login?next=${encodeURIComponent(`/order/${id}`)}`) }}
        />
      </View>
    );
  }

  if (order.isLoading) {
    return (
      <View style={s.screen}>
        <View style={s.sceneSkeleton} />
        <ListSkeleton rows={2} thumb={56} />
      </View>
    );
  }

  if (order.error || !order.data) {
    return (
      <View style={s.screen}>
        <ErrorState error={order.error} onRetry={() => order.refetch()} />
      </View>
    );
  }

  const o = order.data;
  const { status, tone } = orderStatus(o.status);
  const when = o.placedAt
    ? new Date(o.placedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={order.isRefetching} onRefresh={() => { order.refetch(); }} tintColor={colors.green} colors={[colors.green]} />
      }
    >
      <Stack.Screen options={{ title: `Order ${o.code}` }} />

      {o.moment ? <OrderMoment orderId={o.id} moment={o.moment} shipped={o.shipped} /> : null}

      <View style={s.card}>
        <View style={s.headRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.code}>{o.code}</Text>
            {when ? <Text style={s.muted}>Placed {when}</Text> : null}
          </View>
          <View style={[s.pill, { backgroundColor: tone.bg }]}>
            <View style={[s.pillDot, { backgroundColor: tone.fg }]} />
            <Text style={[s.pillText, { color: tone.fg }]}>{status.label}</Text>
          </View>
        </View>

        {o.items.map((item, i) => (
          <View key={`${item.name}-${i}`} style={[s.line, i > 0 && s.lineDivider]}>
            <Photo uri={item.image} style={s.thumb} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.itemName} numberOfLines={2}>{item.name}</Text>
              <Text style={s.muted}>Qty {item.quantity} · {inr(item.price)} each</Text>
            </View>
          </View>
        ))}

        <View style={s.totalRow}>
          <Text style={s.totalLabel}>Total</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.total}>{inr(o.total)}</Text>
            <Text style={s.muted}>{paymentLabel(o.paymentStatus)}</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  sceneSkeleton: { margin: spacing.lg, aspectRatio: 16 / 9, borderRadius: radius.lg, backgroundColor: colors.line },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.md,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  code: { ...type.h3 },
  muted: { ...type.caption, color: colors.muted },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontFamily: font.semibold, fontSize: 11.5 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.md },
  lineDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  thumb: { width: 52, height: 52, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  itemName: { fontFamily: font.semibold, fontSize: 14, color: colors.ink },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: spacing.md,
  },
  totalLabel: { ...type.h3 },
  total: { fontFamily: font.heading, fontSize: 17, color: colors.ink },
});
