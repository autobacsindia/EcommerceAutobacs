import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, errorMessage } from '../../src/api';
import { formatMonth } from '../../src/lib/dates';
import { formatPaise } from '../../src/lib/format';
import { colors } from '../../src/theme';
import { Card, ComingSoon, ErrorState, Li, Loading, Screen, T } from '../../src/ui';

const PAYSLIPS_KEY = ['payslips'] as const;

export default function Payslips() {
  const q = useQuery({ queryKey: PAYSLIPS_KEY, queryFn: () => api.payslips() });
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <T kind="h1">Payslips</T>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        (q.error as { notAvailable?: boolean }).notAvailable ? (
          <ComingSoon what="Your payslips" />
        ) : (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        )
      ) : q.data.items.length ? (
        <Card style={{ paddingVertical: 4 }}>
          {q.data.items.map((p, i) => (
            <Pressable key={p.id} onPress={() => router.push({ pathname: '/payslip/[id]', params: { id: p.id } })} accessibilityRole="button">
              <Li last={i === q.data.items.length - 1}>
                <View>
                  <T kind="bodyBold">{formatMonth(p.month)}</T>
                  <T kind="small">{p.kind === 'final_settlement' ? 'Final settlement' : 'Monthly salary'}</T>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <T kind="bodyBold">{formatPaise(p.netPaise)}</T>
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                </View>
              </Li>
            </Pressable>
          ))}
        </Card>
      ) : (
        <Card>
          <T kind="small">No payslips yet. They appear here once HR releases them.</T>
        </Card>
      )}
    </Screen>
  );
}
