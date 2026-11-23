/**
 * Today: the big clock button, shift, site status, month counts.
 * Buttons come from the server's `allowedTypes` — the phone never guesses
 * whether you are clocked in.
 */
import { useEffect, useState, type ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, errorMessage, type AttendanceStatus, type PunchType } from '../../src/api';
import { useEmployee } from '../../src/auth/session';
import { usePunchQueue } from '../../src/punch/PunchProvider';
import { formatClock, formatDay, formatMinutes, formatTime, greeting, istMonth } from '../../src/lib/dates';
import { PUNCH_LABEL } from '../../src/lib/labels';
import { colors, font, spacing, type } from '../../src/theme';
import { Button, Card, Chip, ComingSoon, ErrorState, Li, Loading, Row, Screen, T } from '../../src/ui';

function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function Today() {
  const employee = useEmployee();
  const now = useNow();
  const status = useQuery({ queryKey: ['status'], queryFn: () => api.status(), refetchInterval: 5 * 60_000 });
  const month = useQuery({ queryKey: ['month', istMonth()], queryFn: () => api.month(istMonth()) });
  const { items, syncing, syncNow, dismiss } = usePunchQueue();
  const first = employee.name.split(/\s+/)[0];

  const refresh = () => {
    void syncNow();
    void status.refetch();
    void month.refetch();
  };

  return (
    <Screen refreshing={status.isRefetching} onRefresh={refresh}>
      <Card style={{ gap: 10 }}>
        <T kind="h1">
          {greeting(now)}, {first}
        </T>
        {status.isPending ? (
          <Loading />
        ) : status.error ? (
          (status.error as { notAvailable?: boolean }).notAvailable ? (
            <ComingSoon what="Clocking in" />
          ) : (
            <ErrorState message={errorMessage(status.error)} onRetry={() => void status.refetch()} />
          )
        ) : (
          <PunchPanel s={status.data} now={now} />
        )}
      </Card>

      {items.length ? (
        <Card style={{ gap: 6 }}>
          <Row>
            <T kind="label">Saved on this phone</T>
            {syncing ? <Chip label="Sending…" tone="info" /> : null}
          </Row>
          {items.map((q, i) => (
            <Li key={q.input.clientPunchId} last={i === items.length - 1}>
              <View style={{ flex: 1 }}>
                <T kind="bodyBold">
                  {PUNCH_LABEL[q.input.type]} · {formatTime(q.input.at)}
                </T>
                {q.message && q.state !== 'pending' ? <T kind="small">{q.message}</T> : null}
              </View>
              {q.state === 'pending' ? (
                <Chip label="Waiting to send" tone="warn" />
              ) : (
                <Pressable onPress={() => void dismiss(q.input.clientPunchId)} accessibilityRole="button">
                  <Chip label={q.state === 'expired' ? 'Too old · OK' : 'Not recorded · OK'} tone="bad" />
                </Pressable>
              )}
            </Li>
          ))}
        </Card>
      ) : null}

      <Card>
        <T kind="label" style={{ marginBottom: 8 }}>
          This month
        </T>
        {month.data ? (
          <View style={{ flexDirection: 'row' }}>
            <Stat n={month.data.summary.presentDays} label="Present" />
            <Stat n={month.data.summary.lateMarks} label="Late" />
            <Stat n={month.data.summary.leaveDays} label="Leave" />
          </View>
        ) : month.error ? (
          <T kind="small">{(month.error as { notAvailable?: boolean }).notAvailable ? 'Coming soon.' : errorMessage(month.error)}</T>
        ) : (
          <Loading />
        )}
      </Card>
    </Screen>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontFamily: font.bold, fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'] }}>{n}</Text>
      <T kind="caption">{label}</T>
    </View>
  );
}

function PunchPanel({ s, now }: { s: AttendanceStatus; now: number }) {
  const { today, shift, face } = s;
  const working = today.state === 'in' || today.state === 'break';
  const firstIn = today.day?.firstIn ?? today.punches.find((p) => p.type === 'in')?.at ?? null;
  const shiftLine = `Shift ${formatClock(shift.start)} – ${formatClock(shift.end)}`;
  const site = s.sites[0];

  if (s.manualAttendance) {
    return (
      <T>HR marks your attendance by hand, so you do not need to clock in. {shiftLine}.</T>
    );
  }

  const needsSetup = face.status !== 'enrolled';
  const go = (type: PunchType) =>
    needsSetup ? router.push('/face/consent') : router.push({ pathname: '/face/check', params: { purpose: 'punch', type } });

  const primary: PunchType | undefined = today.allowedTypes.find((t) => t === 'in' || t === 'out');
  const breakType = today.allowedTypes.find((t) => t === 'break_start' || t === 'break_end');
  const workedMin = firstIn && working ? Math.max(0, Math.floor((now - Date.parse(firstIn)) / 60_000) - (today.day?.breakMinutes ?? 0)) : today.day?.workedMinutes ?? 0;

  return (
    <View style={{ gap: 10 }}>
      <Row>
        {working ? (
          <Chip label={today.state === 'break' ? `On a break` : `Clocked in at ${formatTime(firstIn)}`} tone="ok" />
        ) : today.state === 'out' ? (
          <Chip label="Clocked out" tone="grey" />
        ) : (
          <Chip label="Not clocked in" tone="grey" />
        )}
        <T kind="small">{working ? `ends ${formatClock(shift.end)}` : shiftLine}</T>
      </Row>
      <Text style={type.clock} accessibilityRole="timer">
        {working || today.state === 'out' ? formatMinutes(workedMin) : formatTime(new Date(now).toISOString())}
      </Text>
      <T kind="small">{working || today.state === 'out' ? 'worked today' : formatDay(s.date)}</T>

      {needsSetup ? (
        <View style={{ gap: 8 }}>
          <T>Set up your face once, then clock in with a quick look at the camera.</T>
          <BigButton label="Set up face check" icon="scan-outline" onPress={() => router.push('/face/consent')} />
        </View>
      ) : primary ? (
        <BigButton
          label={primary === 'in' ? 'Clock in with face' : 'Clock out'}
          icon={primary === 'in' ? 'scan-outline' : 'log-out-outline'}
          dark={primary === 'out'}
          onPress={() => go(primary)}
        />
      ) : null}
      {!needsSetup && breakType ? <Button label={breakType === 'break_start' ? 'Start a break' : 'End my break'} onPress={() => go(breakType)} /> : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {s.anywhereAllowed ? (
          <Chip label="You can clock in from anywhere" tone="info" icon="globe-outline" />
        ) : site ? (
          <Chip label={`Work site: ${site.name}${s.sites.length > 1 ? ` +${s.sites.length - 1}` : ''}`} tone="ok" icon="location" />
        ) : (
          <Chip label="No work site set. Ask HR." tone="warn" icon="location-outline" />
        )}
      </View>
    </View>
  );
}

function BigButton({ label, icon, onPress, dark }: { label: string; icon: ComponentProps<typeof Ionicons>['name']; onPress: () => void; dark?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        backgroundColor: dark ? colors.ink : colors.green,
        borderRadius: 18,
        paddingVertical: 18,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        opacity: pressed ? 0.85 : 1,
        marginTop: spacing.xs,
      })}
    >
      <Ionicons name={icon} size={22} color={colors.white} />
      <Text style={{ fontFamily: font.extrabold, fontSize: 17, color: colors.white }}>{label}</Text>
    </Pressable>
  );
}
