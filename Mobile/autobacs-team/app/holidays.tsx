/** Company holidays for a year (GET /hr/holidays?year=). Optional ones are not days off. */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, errorMessage } from '../src/api';
import { formatDay, istDate } from '../src/lib/dates';
import { colors } from '../src/theme';
import { Card, Chip, ErrorState, Li, Loading, Row, Screen, T } from '../src/ui';

export default function Holidays() {
  const today = istDate();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const q = useQuery({ queryKey: ['holidays', year], queryFn: () => api.holidays(year), staleTime: 60 * 60_000 });
  const items = (q.data ?? []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const next = items.find((h) => h.date >= today && !h.optional);

  return (
    <Screen edges={['bottom']} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Row>
        <Pressable onPress={() => setYear(year - 1)} accessibilityLabel="Previous year" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
        <T kind="h2">{String(year)}</T>
        <Pressable onPress={() => setYear(year + 1)} accessibilityLabel="Next year" hitSlop={12}>
          <Ionicons name="chevron-forward" size={22} color={colors.ink} />
        </Pressable>
      </Row>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : items.length ? (
        <>
          {next ? (
            <Card style={{ backgroundColor: colors.greenSoft, borderColor: colors.greenSoft }}>
              <T kind="small">Next holiday</T>
              <T kind="bodyBold">
                {next.name} · {formatDay(next.date)}
              </T>
            </Card>
          ) : null}
          <Card style={{ paddingVertical: 4 }}>
            {items.map((h, i) => (
              <Li key={h.id} last={i === items.length - 1}>
                <View style={{ flex: 1, opacity: h.date < today ? 0.55 : 1 }}>
                  <T kind="bodyBold">{h.name}</T>
                  <T kind="small">{formatDay(h.date)}</T>
                </View>
                {h.optional ? <Chip label="Optional" tone="info" /> : null}
              </Li>
            ))}
          </Card>
          <T kind="small">Optional holidays are not days off. Apply for leave if you want one.</T>
        </>
      ) : (
        <Card>
          <T kind="small">No holidays added for {year} yet.</T>
        </Card>
      )}
    </Screen>
  );
}
