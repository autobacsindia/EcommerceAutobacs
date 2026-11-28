import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, errorMessage } from '../../src/api';
import { formatDay, formatMinutes, formatMonth, formatTime, istMonth, shiftMonth } from '../../src/lib/dates';
import { dayChip } from '../../src/lib/labels';
import { colors } from '../../src/theme';
import { Button, Card, Chip, ComingSoon, ErrorState, Li, Loading, Row, Screen, T } from '../../src/ui';

export default function History() {
  const thisMonth = istMonth();
  const [month, setMonth] = useState(thisMonth);
  const q = useQuery({ queryKey: ['month', month], queryFn: () => api.month(month) });
  const days = [...(q.data?.days ?? [])].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Row>
        <Pressable onPress={() => setMonth(shiftMonth(month, -1))} accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
        <T kind="h1">{formatMonth(month)}</T>
        <Pressable
          onPress={() => setMonth(shiftMonth(month, 1))}
          disabled={month >= thisMonth}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          hitSlop={12}
          style={{ opacity: month >= thisMonth ? 0.25 : 1 }}
        >
          <Ionicons name="chevron-forward" size={22} color={colors.ink} />
        </Pressable>
      </Row>

      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        (q.error as { notAvailable?: boolean }).notAvailable ? (
          <ComingSoon what="Your attendance history" />
        ) : (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        )
      ) : days.length ? (
        <Card style={{ paddingVertical: 4 }}>
          {days.map((d, i) => {
            const chip = dayChip(d);
            const timed = d.firstIn || d.lastOut;
            return (
              <Li key={d.date} last={i === days.length - 1}>
                <View style={{ flex: 1 }}>
                  <T kind="bodyBold">{formatDay(d.date)}</T>
                  {timed ? (
                    <T kind="small">
                      {formatTime(d.firstIn)} → {formatTime(d.lastOut)}
                      {d.workedMinutes ? ` · ${formatMinutes(d.workedMinutes)}` : ''}
                    </T>
                  ) : null}
                </View>
                <Chip label={chip.label} tone={chip.tone} />
              </Li>
            );
          })}
        </Card>
      ) : (
        <Card>
          <T kind="small">Nothing for this month yet.</T>
        </Card>
      )}

      <Button label="Ask HR to fix a day" icon="create-outline" onPress={() => router.push('/fix-day')} />
      <T kind="small">
        Forgot to clock out, or the time is wrong? Pick the day, type the real time and a reason. HR approves it.
      </T>
    </Screen>
  );
}
