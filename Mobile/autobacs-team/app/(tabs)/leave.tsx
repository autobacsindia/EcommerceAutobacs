/**
 * Leave: balances (server figures, half-days), apply (full or half day), past
 * requests. The phone only checks obvious mistakes (lib/leaveForm); the server
 * counts working days and checks balance and notice. The request is shown as
 * "waiting" only after the server accepted it — never optimistically.
 */
import { useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, type LeaveBalance, type LeaveRequest } from '../../src/api';
import { addDays, formatDay, istDate } from '../../src/lib/dates';
import { newClientId } from '../../src/lib/device';
import { halfDaysToDays } from '../../src/lib/format';
import { estimateHalfDays, validateLeave, type DayPart, type LeaveErrors } from '../../src/lib/leaveForm';
import { leaveChip } from '../../src/lib/labels';
import { colors, font, spacing } from '../../src/theme';
import { Button, Card, Chip, ComingSoon, ErrorState, Field, Li, Loading, Row, Screen, Segmented, T } from '../../src/ui';
import { DateField } from '../../src/ui/DateField';

const year = () => Number(istDate().slice(0, 4));

export default function Leave() {
  const balances = useQuery({ queryKey: ['leave', 'balances', year()], queryFn: () => api.leaveBalances(year()) });
  const mine = useQuery({ queryKey: ['leave', 'mine'], queryFn: () => api.myLeave() });
  const notAvailable = (balances.error as { notAvailable?: boolean } | null)?.notAvailable;

  return (
    <Screen
      refreshing={balances.isRefetching || mine.isRefetching}
      onRefresh={() => {
        void balances.refetch();
        void mine.refetch();
      }}
    >
      <T kind="h1">Leave</T>
      {balances.isPending ? (
        <Loading />
      ) : notAvailable ? (
        <ComingSoon what="Leave" />
      ) : balances.error ? (
        <ErrorState message={errorMessage(balances.error)} onRetry={() => void balances.refetch()} />
      ) : (
        <>
          <Balances items={balances.data.filter((b) => b.leaveType.paid)} />
          <ApplyForm balances={balances.data} />
        </>
      )}
      {mine.data ? <Past items={mine.data.items} /> : null}
    </Screen>
  );
}

function Balances({ items }: { items: LeaveBalance[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {items.slice(0, 3).map((b) => (
        <Card key={b.leaveType.id} style={{ flex: 1, alignItems: 'center', padding: 10 }}>
          <Text style={{ fontFamily: font.heading, fontSize: 20, color: colors.ink, fontVariant: ['tabular-nums'] }}>
            {halfDaysToDays(b.available)}
          </Text>
          <T kind="caption">{b.leaveType.name.replace(/ leave$/i, '')}</T>
        </Card>
      ))}
    </View>
  );
}

function ApplyForm({ balances }: { balances: LeaveBalance[] }) {
  const qc = useQueryClient();
  const types = balances.map((b) => b.leaveType).filter((t) => t.active);
  const tomorrow = addDays(istDate(), 1);
  const [typeId, setTypeId] = useState<string | null>(types[0]?.id ?? null);
  const [from, setFrom] = useState(tomorrow);
  const [to, setTo] = useState(tomorrow);
  const [part, setPart] = useState<DayPart>('full');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<LeaveErrors>({});
  const [sent, setSent] = useState<LeaveRequest | null>(null);
  // One id per filled-in form: a double tap or retry is one request.
  const requestId = useRef(newClientId());

  const leaveType = types.find((t) => t.id === typeId) ?? null;
  const balance = balances.find((b) => b.leaveType.id === typeId);
  const estimate = estimateHalfDays({ from, to, part });

  const apply = useMutation({
    mutationFn: (input: Parameters<typeof api.applyLeave>[0]) => api.applyLeave(input),
    onSuccess: (r) => {
      setSent(r.request);
      requestId.current = newClientId();
      setReason('');
      void qc.invalidateQueries({ queryKey: ['leave'] });
    },
  });

  const submit = () => {
    const check = validateLeave({ leaveType, from, to, part, reason });
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    setErrors({});
    apply.mutate({ clientRequestId: requestId.current, ...check.input });
  };

  if (sent) {
    const chip = leaveChip(sent.status);
    return (
      <Card style={{ gap: 6 }}>
        <Row>
          <T kind="bodyBold">
            {sent.leaveTypeName ?? 'Leave'} · {formatDay(sent.from)}
            {sent.to !== sent.from ? ` – ${formatDay(sent.to)}` : ''}
          </T>
          <Chip label={chip.label} tone={chip.tone} />
        </Row>
        <T kind="small">
          Sent. Counts as {halfDaysToDays(sent.halfDays)} {sent.halfDays === 2 ? 'day' : 'days'}. You will see the answer here.
        </T>
        <Button label="Apply for more leave" variant="ghost" onPress={() => setSent(null)} />
      </Card>
    );
  }

  return (
    <Card style={{ gap: spacing.md }}>
      <T kind="label">Apply for leave</T>
      <Segmented
        value={typeId}
        onChange={(v) => {
          setTypeId(v);
          if (!types.find((t) => t.id === v)?.allowHalfDay) setPart('full');
        }}
        options={types.slice(0, 4).map((t) => ({ value: t.id, label: t.name.replace(/ leave$/i, '') }))}
      />
      {errors.leaveType ? <T style={{ color: colors.bad }}>{errors.leaveType}</T> : null}
      <Row style={{ gap: spacing.md, alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <DateField label="From" value={from} onChange={(v) => { setFrom(v); if (to < v) setTo(v); }} error={errors.from} />
        </View>
        <View style={{ flex: 1 }}>
          <DateField label="To" value={to} min={from} onChange={setTo} error={errors.to} />
        </View>
      </Row>
      <Segmented
        value={part}
        onChange={setPart}
        options={[
          { value: 'full', label: 'Full day' },
          { value: 'first_half', label: 'First half', disabled: from !== to || !leaveType?.allowHalfDay },
          { value: 'second_half', label: 'Second half', disabled: from !== to || !leaveType?.allowHalfDay },
        ]}
      />
      {errors.part ? <T style={{ color: colors.bad }}>{errors.part}</T> : null}
      <Field label="Reason" value={reason} onChangeText={setReason} error={errors.reason} maxLength={500} placeholder="e.g. Family function" />
      {estimate !== null && balance ? (
        <T kind="small">
          Up to {halfDaysToDays(estimate)} {estimate === 2 ? 'day' : 'days'}. You have {halfDaysToDays(balance.available)} left. Holidays and weekly offs are not counted.
        </T>
      ) : null}
      {apply.error ? <T style={{ color: colors.bad }}>{errorMessage(apply.error)}</T> : null}
      <Button label="Send to HR" variant="primary" loading={apply.isPending} onPress={submit} />
    </Card>
  );
}

function Past({ items }: { items: LeaveRequest[] }) {
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelLeave(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['leave'] }),
    onError: (err) => Alert.alert('Could not cancel', errorMessage(err)),
  });
  if (!items.length) return null;
  return (
    <Card style={{ paddingVertical: 6 }}>
      <T kind="label" style={{ marginTop: 6 }}>
        Past requests
      </T>
      {items.map((r, i) => {
        const chip = leaveChip(r.status);
        const cancellable = r.status === 'pending_head' || r.status === 'pending_hr';
        return (
          <Li key={r.id} last={i === items.length - 1}>
            <View style={{ flex: 1 }}>
              <T kind="bodyBold">
                {(r.leaveTypeName ?? 'Leave').replace(/ leave$/i, '')} · {formatDay(r.from)}
                {r.to !== r.from ? ` – ${formatDay(r.to)}` : ''}
              </T>
              {cancellable ? (
                <Text
                  onPress={() =>
                    Alert.alert('Cancel this request?', undefined, [
                      { text: 'Keep it', style: 'cancel' },
                      { text: 'Cancel request', style: 'destructive', onPress: () => cancel.mutate(r.id) },
                    ])
                  }
                  style={{ fontFamily: font.bold, fontSize: 13, color: colors.bad, marginTop: 2 }}
                  accessibilityRole="button"
                >
                  Cancel request
                </Text>
              ) : null}
            </View>
            <Chip label={chip.label} tone={chip.tone} />
          </Li>
        );
      })}
    </Card>
  );
}
