/**
 * "Ask HR to fix a day" — POST /hr/me/corrections. One clientRequestId per
 * form, reused on a retry, so a double tap or a lost reply makes one request.
 */
import { useRef, useState } from 'react';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, type PunchType } from '../src/api';
import { addDays, istDate, istInstant, isRealDate } from '../src/lib/dates';
import { newClientId } from '../src/lib/device';
import { colors, spacing } from '../src/theme';
import { Button, Card, Field, Screen, Segmented, T } from '../src/ui';

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export default function FixDay() {
  const qc = useQueryClient();
  const today = istDate();
  const [date, setDate] = useState(addDays(today, -1));
  const [punchType, setPunchType] = useState<PunchType>('out');
  const [time, setTime] = useState('19:00');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const requestId = useRef(newClientId());

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!isRealDate(date)) e.date = 'Type the day as YYYY-MM-DD, e.g. 2026-11-16.';
    else if (date > today) e.date = 'That day has not happened yet.';
    const m = TIME_RE.exec(time.trim());
    if (!m) e.time = 'Type the time as HH:MM in 24-hour form, e.g. 19:05.';
    if (reason.trim().length < 3) e.reason = 'Please say what happened.';
    setErrors(e);
    if (Object.keys(e).length || !m) return;
    setBusy(true);
    setServerError(null);
    try {
      const hhmm = `${m[1].padStart(2, '0')}:${m[2]}`;
      await api.createCorrection({ clientRequestId: requestId.current, date, punchType, at: istInstant(date, hhmm), reason: reason.trim() });
      void qc.invalidateQueries({ queryKey: ['month'] });
      setDone(true);
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen>
        <Card style={{ gap: spacing.md }}>
          <T kind="h2">Sent to HR</T>
          <T>HR will look at it. The day updates in your history once they approve it.</T>
          <Button label="Done" variant="primary" onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <Card style={{ gap: spacing.md }}>
        <Field label="Which day (YYYY-MM-DD)" value={date} onChangeText={setDate} error={errors.date} autoCapitalize="none" keyboardType="numbers-and-punctuation" />
        <T kind="small">What should it say?</T>
        <Segmented
          value={punchType}
          onChange={setPunchType}
          options={[
            { value: 'in', label: 'Clock in' },
            { value: 'out', label: 'Clock out' },
          ]}
        />
        <Field label="Real time (24-hour, HH:MM)" value={time} onChangeText={setTime} error={errors.time} keyboardType="numbers-and-punctuation" />
        <Field label="Reason" value={reason} onChangeText={setReason} error={errors.reason} multiline maxLength={500} placeholder="e.g. Phone battery died, left at 7:05 pm" />
        {serverError ? <T style={{ color: colors.bad }}>{serverError}</T> : null}
        <Button label="Send to HR" variant="primary" loading={busy} onPress={() => void submit()} />
      </Card>
    </Screen>
  );
}
