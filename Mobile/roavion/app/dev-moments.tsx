/**
 * Dev-only gallery of every order-moment card (the Boxy scenes), so reviewers can
 * see all 16 without placing real orders. Redirects home in production builds —
 * never reachable by customers. Sample values are made up; real cards only ever
 * show what GET /orders/:id returns.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { OrderMoment } from '../src/orders/OrderMoment';
import type { OrderMomentData } from '../src/orders/momentCopy';
import { colors, font, spacing, type } from '../src/theme';

const SAMPLES: { moment: OrderMomentData; shipped?: boolean }[] = [
  { moment: { key: 'placed' } },
  { moment: { key: 'preparing' } },
  { moment: { key: 'packed' } },
  { moment: { key: 'shipped' }, shipped: true },
  { moment: { key: 'in_transit', note: 'Reached the Bengaluru hub.', at: '2026-12-01T09:30:00Z' }, shipped: true },
  { moment: { key: 'out_for_delivery', note: 'Arriving before 6 pm.', at: '2026-12-02T04:00:00Z' }, shipped: true },
  { moment: { key: 'delivery_failed', note: 'The gate was locked. We will try again tomorrow.', at: '2026-12-02T12:00:00Z' }, shipped: true },
  { moment: { key: 'date_moved', newDay: '2026-12-05', at: '2026-12-02T12:00:00Z' }, shipped: true },
  { moment: { key: 'delivered' }, shipped: true },
  { moment: { key: 'partly' }, shipped: true },
  { moment: { key: 'late', late: { dueDay: '2026-11-30' } }, shipped: true },
  { moment: { key: 'on_hold' } },
  { moment: { key: 'payment_failed' } },
  { moment: { key: 'cancelled', refundDue: true } },
  { moment: { key: 'refunded', refund: { amount: 2499 } } },
  { moment: { key: 'returning', returnStep: 1 } },
];

export default function DevMoments() {
  // A fresh id per "Replay" so every card plays again (play-once is per order).
  const [run, setRun] = useState(() => Date.now().toString(36));
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Stack.Screen options={{ title: 'Order moments (dev)' }} />
      <Pressable onPress={() => setRun(Date.now().toString(36))} style={s.replay} accessibilityRole="button">
        <Text style={s.replayText}>Replay all</Text>
      </Pressable>
      {SAMPLES.map(({ moment, shipped }) => (
        <OrderMoment key={`${moment.key}-${run}`} orderId={`dev-${moment.key}-${run}`} moment={moment} shipped={shipped} />
      ))}
      <Text style={type.caption}>Sample values only.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  replay: { alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, backgroundColor: colors.green },
  replayText: { fontFamily: font.semibold, color: colors.white },
});
