/**
 * My late/early marks and overtime for a month (GET /hr/me/attendance?month=).
 * Every count is the server's; the app words it (src/lib/marks.ts).
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, errorMessage } from '../src/api';
import { formatDay, formatMonth, istMonth, shiftMonth } from '../src/lib/dates';
import { markRows, marksVerdict, minutesText, ruleLines, totalMarks } from '../src/lib/marks';
import { colors, spacing } from '../src/theme';
import { Card, Chip, ErrorState, Li, Loading, Row, Screen, T } from '../src/ui';

const OT_CHIP: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'grey' }> = {
  approved: { label: 'Approved', tone: 'ok' },
  pending: { label: 'Waiting', tone: 'warn' },
  rejected: { label: 'Not approved', tone: 'bad' },
};

export default function Marks() {
  const thisMonth = istMonth();
  const [month, setMonth] = useState(thisMonth);
  const q = useQuery({ queryKey: ['month', month], queryFn: () => api.month(month) });

  return (
    <Screen edges={['bottom']} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Row>
        <Pressable onPress={() => setMonth(shiftMonth(month, -1))} accessibilityLabel="Previous month" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
        <T kind="h2">{formatMonth(month)}</T>
        <Pressable
          onPress={() => setMonth(shiftMonth(month, 1))}
          disabled={month >= thisMonth}
          accessibilityLabel="Next month"
          hitSlop={12}
          style={{ opacity: month >= thisMonth ? 0.3 : 1 }}
        >
          <Ionicons name="chevron-forward" size={22} color={colors.ink} />
        </Pressable>
      </Row>

      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Stat label="Marks" value={String(totalMarks(q.data.summary))} />
            <Stat label="Late" value={String(q.data.summary.lateCount ?? q.data.summary.lateMarks)} />
            <Stat label="Early" value={q.data.summary.earlyCount != null ? String(q.data.summary.earlyCount) : '–'} />
            <Stat label="OT approved" value={minutesText(q.data.summary.otApprovedMinutes ?? 0)} />
          </View>
          <Card>
            <T kind="bodyBold">{marksVerdict(q.data.summary)}</T>
            {q.data.summary.otPendingMinutes ? (
              <T kind="small">{minutesText(q.data.summary.otPendingMinutes)} of overtime is waiting for approval.</T>
            ) : null}
          </Card>

          <Days rows={markRows(q.data.days)} />

          <Card style={{ gap: 6 }}>
            <T kind="label">How it works</T>
            {ruleLines(q.data.summary).map((l) => (
              <T key={l} kind="small">
                • {l}
              </T>
            ))}
            <T kind="small">A wrong time? Ask HR to fix the day from History.</T>
          </Card>
        </>
      )}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center', gap: 2 }}>
      <T kind="bodyBold">{value}</T>
      <T kind="caption" style={{ textAlign: 'center' }}>
        {label}
      </T>
    </Card>
  );
}

function Days({ rows }: { rows: ReturnType<typeof markRows> }) {
  if (!rows.length) {
    return (
      <Card>
        <T kind="small">No late, early or overtime days this month.</T>
      </Card>
    );
  }
  return (
    <Card style={{ paddingVertical: 4 }}>
      {rows.map((r, i) => (
        <Li key={r.date} last={i === rows.length - 1}>
          <View style={{ flex: 1, gap: 2 }}>
            <T kind="bodyBold">{formatDay(r.date)}</T>
            <T kind="small">
              {[
                r.late ? `Late ${minutesText(r.late)}` : '',
                r.early ? `Left ${minutesText(r.early)} early` : '',
                r.otMinutes ? `Overtime ${minutesText(r.otMinutes)}${r.otApproved && r.otApproved !== r.otMinutes ? ` (${minutesText(r.otApproved)} approved)` : ''}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </T>
          </View>
          <View style={{ gap: 4, alignItems: 'flex-end' }}>
            {r.late || r.early ? <Chip label={r.late && r.early ? '2 marks' : '1 mark'} tone="warn" /> : null}
            {r.otMinutes ? <Chip label={OT_CHIP[r.otStatus]?.label ?? 'Overtime'} tone={OT_CHIP[r.otStatus]?.tone ?? 'grey'} /> : null}
          </View>
        </Li>
      ))}
    </Card>
  );
}
