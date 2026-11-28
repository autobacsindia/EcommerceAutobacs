/**
 * Approvals for team heads and HR: leave, fix-day requests, overtime.
 * The tab exists only when GET /hr/me/app says this login may approve
 * (app/(tabs)/_layout.tsx); each section only if allowed for that kind.
 *
 * Nothing here is optimistic: a card leaves the list only after the server
 * accepted the decision and the list was fetched again. "Someone else decided
 * first" (409) refreshes the list and says so.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorMessage, type Decision } from '../../src/api';
import { canApproveAnything, useCapabilities } from '../../src/auth/capabilities';
import { formatDay, formatTime } from '../../src/lib/dates';
import { halfDaysToDays } from '../../src/lib/format';
import { clampOtMinutes, decisionError, OT_STEP, SECTION_LABEL, visibleSections, type Section } from '../../src/lib/approvals';
import { minutesText } from '../../src/lib/marks';
import { colors, spacing } from '../../src/theme';
import { Button, Card, Chip, ComingSoon, ErrorState, Field, Loading, Row, Screen, Segmented, T } from '../../src/ui';

const KEY = (s: Section) => ['approvals', s] as const;

export default function Approvals() {
  const caps = useCapabilities();
  const sections = visibleSections(caps);
  const [picked, setPicked] = useState<Section | null>(null);
  const section = picked && sections.includes(picked) ? picked : sections[0];

  if (!canApproveAnything(caps) || !section) {
    return (
      <Screen>
        <T kind="h1">Approvals</T>
        <Card>
          <T kind="small">Nothing for you to approve.</T>
        </Card>
      </Screen>
    );
  }
  return (
    <Screen>
      <T kind="h1">Approvals</T>
      {sections.length > 1 ? (
        <Segmented value={section} onChange={setPicked} options={sections.map((s) => ({ value: s, label: SECTION_LABEL[s] }))} />
      ) : null}
      {section === 'leave' ? <LeaveList /> : section === 'fixDay' ? <FixDayList /> : <OvertimeList />}
    </Screen>
  );
}

// ── shared ────────────────────────────────────────────────────────────────────

function useDecide<T>(section: Section, fn: (item: T, decision: Decision, note: string, extra: number) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ item, decision, note, extra }: { item: T; decision: Decision; note: string; extra: number }) => fn(item, decision, note, extra),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: KEY(section) });
    },
  });
}

function ListState({ q, what, children }: { q: { isPending: boolean; error: unknown; refetch: () => unknown }; what: string; children: () => React.ReactNode }) {
  if (q.isPending) return <Loading />;
  if (q.error) {
    if (q.error instanceof ApiError && q.error.notAvailable) return <ComingSoon what={what} />;
    return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  }
  return <>{children()}</>;
}

function Empty({ text }: { text: string }) {
  return (
    <Card>
      <T kind="small">{text}</T>
    </Card>
  );
}

/** Approve / Reject with a reason. One decision in flight per card. */
function DecisionCard({
  children,
  onDecide,
  busy,
  error,
  extra,
}: {
  children: React.ReactNode;
  onDecide: (decision: Decision, note: string) => void;
  busy: boolean;
  error: string | null;
  extra?: React.ReactNode;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  const decide = (d: Decision) => {
    const e = decisionError(d, note);
    setNoteError(e);
    if (!e) onDecide(d, note.trim());
  };

  return (
    <Card style={{ gap: spacing.sm }}>
      {children}
      {extra}
      {rejecting ? (
        <>
          <Field label="Why not? (they will see this)" value={note} onChangeText={setNote} error={noteError ?? undefined} maxLength={300} multiline />
          <Row style={{ gap: spacing.sm }}>
            <Button label="Back" variant="ghost" onPress={() => setRejecting(false)} disabled={busy} style={{ flex: 1 }} />
            <Button label="Reject" variant="danger" onPress={() => decide('rejected')} loading={busy} style={{ flex: 1 }} />
          </Row>
        </>
      ) : (
        <Row style={{ gap: spacing.sm }}>
          <Button label="Reject" variant="outline" onPress={() => setRejecting(true)} disabled={busy} style={{ flex: 1 }} />
          <Button label="Approve" variant="primary" onPress={() => decide('approved')} loading={busy} style={{ flex: 1 }} />
        </Row>
      )}
      {error ? <T style={{ color: colors.bad }}>{error}</T> : null}
    </Card>
  );
}

const conflictText = (err: unknown) =>
  err instanceof ApiError && (err.status === 409 || err.status === 404) ? 'Someone else already decided this. The list is refreshed.' : errorMessage(err);

// ── leave ─────────────────────────────────────────────────────────────────────

function LeaveList() {
  const q = useQuery({ queryKey: KEY('leave'), queryFn: () => api.leaveInbox() });
  const m = useDecide<{ id: string; rev?: number }>('leave', (r, d, note) => api.decideLeave(r.id, d, note, r.rev));
  return (
    <ListState q={q} what="Leave approvals">
      {() =>
        q.data?.items.length ? (
          q.data.items.map((r) => (
            <DecisionCard
              key={r.id}
              busy={m.isPending && m.variables?.item.id === r.id}
              error={m.error && m.variables?.item.id === r.id ? conflictText(m.error) : null}
              onDecide={(d, note) => m.mutate({ item: r, decision: d, note, extra: 0 })}
            >
              <Row>
                <T kind="bodyBold" style={{ flex: 1 }}>
                  {r.employeeName ?? 'Employee'}
                  {r.employeeCode ? ` · ${r.employeeCode}` : ''}
                </T>
                <Chip label={r.status === 'pending_head' ? 'Head step' : 'HR step'} tone="info" />
              </Row>
              <T>
                {r.leaveTypeName ?? 'Leave'} · {formatDay(r.from)}
                {r.to !== r.from ? ` – ${formatDay(r.to)}` : ''} · {halfDaysToDays(r.halfDays)} {r.halfDays === 2 ? 'day' : 'days'}
              </T>
              {r.reason ? <T kind="small">“{r.reason}”</T> : null}
            </DecisionCard>
          ))
        ) : (
          <Empty text="No leave waiting for you." />
        )
      }
    </ListState>
  );
}

// ── fix day (HR) ─────────────────────────────────────────────────────────────

function EmployeeLabel({ id }: { id?: string }) {
  const q = useQuery({ queryKey: ['employee-name', id], queryFn: () => api.employeeName(id!), enabled: !!id, staleTime: 30 * 60_000 });
  return (
    <T kind="bodyBold">
      {q.data ? `${q.data.name} · ${q.data.employeeCode}` : 'Employee'}
    </T>
  );
}

function FixDayList() {
  const q = useQuery({ queryKey: KEY('fixDay'), queryFn: () => api.pendingCorrections() });
  const m = useDecide<{ id: string; rev?: number }>('fixDay', (c, d, note) => api.decideCorrection(c.id, d, note, c.rev));
  return (
    <ListState q={q} what="Fix-day requests">
      {() =>
        q.data?.items.length ? (
          q.data.items.map((c) => (
            <DecisionCard
              key={c.id}
              busy={m.isPending && m.variables?.item.id === c.id}
              error={m.error && m.variables?.item.id === c.id ? conflictText(m.error) : null}
              onDecide={(d, note) => m.mutate({ item: c, decision: d, note, extra: 0 })}
            >
              <EmployeeLabel id={c.employee} />
              <T>
                {formatDay(c.date)} · {c.punchType === 'in' ? 'Clock in' : c.punchType === 'out' ? 'Clock out' : c.punchType} at {formatTime(c.at)}
              </T>
              {c.reason ? <T kind="small">“{c.reason}”</T> : null}
            </DecisionCard>
          ))
        ) : (
          <Empty text="No fix-day requests waiting." />
        )
      }
    </ListState>
  );
}

// ── overtime ─────────────────────────────────────────────────────────────────

function OvertimeList() {
  const q = useQuery({ queryKey: KEY('overtime'), queryFn: () => api.pendingOvertime() });
  const [minutes, setMinutes] = useState<Record<string, number>>({});
  const m = useDecide<import('../../src/api').OvertimeItem>('overtime', (o, d, note, mins) => api.decideOvertime(o, d, mins, note));
  return (
    <ListState q={q} what="Overtime approvals">
      {() =>
        q.data?.items.length ? (
          q.data.items.map((o) => {
            const chosen = minutes[o.dayId] ?? o.overtimeMinutes;
            const set = (v: number) => setMinutes((x) => ({ ...x, [o.dayId]: clampOtMinutes(v, o.overtimeMinutes) }));
            return (
              <DecisionCard
                key={o.dayId}
                busy={m.isPending && m.variables?.item.dayId === o.dayId}
                error={m.error && m.variables?.item.dayId === o.dayId ? conflictText(m.error) : null}
                onDecide={(d, note) => m.mutate({ item: o, decision: d, note, extra: chosen })}
                extra={
                  <Row style={{ gap: spacing.sm }}>
                    <Button label={`−${OT_STEP} min`} variant="ghost" onPress={() => set(chosen - OT_STEP)} disabled={chosen <= 0} />
                    <View style={{ alignItems: 'center' }}>
                      <T kind="bodyBold">{minutesText(chosen)}</T>
                      <T kind="caption">to approve</T>
                    </View>
                    <Button label={`+${OT_STEP} min`} variant="ghost" onPress={() => set(chosen + OT_STEP)} disabled={chosen >= o.overtimeMinutes} />
                  </Row>
                }
              >
                <T kind="bodyBold">
                  {o.employeeName ?? 'Employee'}
                  {o.employeeCode ? ` · ${o.employeeCode}` : ''}
                </T>
                <T>
                  {formatDay(o.date)} · worked {minutesText(o.workedMinutes)} · overtime {minutesText(o.overtimeMinutes)}
                </T>
              </DecisionCard>
            );
          })
        ) : (
          <Empty text="No overtime waiting for you." />
        )
      }
    </ListState>
  );
}
