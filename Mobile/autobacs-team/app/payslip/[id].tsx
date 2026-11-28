/**
 * Payslip detail. Every figure is the server's snapshot (paise); the app only
 * formats it. The PDF downloads with the same Bearer login and opens in the
 * phone's PDF viewer (src/lib/openPdf.ts). Each line may carry a note saying
 * how it was counted (the payroll `calc` text, e.g. "Late/early marks: 4 → ½ day
 * LOP"). Employer-only lines are not shown: they are not part of take-home.
 */
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage, type PayslipAttendance, type PayslipLine } from '../../src/api';
import { formatMonth } from '../../src/lib/dates';
import { formatPaise } from '../../src/lib/format';
import { openPdf as showPdf } from '../../src/lib/openPdf';
import { colors, font, spacing } from '../../src/theme';
import { Button, Card, ErrorState, Li, Loading, Screen, T } from '../../src/ui';

export default function PayslipDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ['payslip', id], queryFn: () => api.payslip(id), enabled: !!id });
  const slip = q.data;
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const openPdf = async () => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      if (!slip) return;
      const uri = await api.payslipPdf(slip.id);
      await showPdf(uri, `Payslip ${formatMonth(slip.month)}`);
    } catch (err) {
      setPdfError(errorMessage(err));
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: slip ? formatMonth(slip.month) : 'Payslip' }} />
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : !slip ? (
        <ErrorState message="This payslip is not available." />
      ) : (
        <>
          <View style={{ backgroundColor: colors.greenSoft, borderRadius: 14, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <T kind="small">
                {formatMonth(slip.month)} {slip.kind === 'final_settlement' ? 'final settlement' : 'take-home'}
              </T>
              <T kind="small">Gross {formatPaise(slip.grossPaise)} · Deductions {formatPaise(slip.deductionsPaise)}</T>
            </View>
            <Text style={{ fontFamily: font.heading, fontSize: 22, color: colors.green, fontVariant: ['tabular-nums'] }}>{formatPaise(slip.netPaise)}</Text>
          </View>
          <Lines title="Earnings" lines={slip.earnings} />
          <Lines title="Deductions" lines={slip.deductions} negative />
          <T kind="small">{daysLine(slip.attendance)}Payslip {slip.number}</T>
          {pdfError ? <T style={{ color: colors.bad }}>{pdfError}</T> : null}
          <Button label="View PDF" icon="document-attach-outline" loading={pdfBusy} onPress={() => void openPdf()} />
        </>
      )}
    </Screen>
  );
}

function Lines({ title, lines, negative }: { title: string; lines: PayslipLine[]; negative?: boolean }) {
  if (!lines.length) return null;
  return (
    <Card style={{ paddingVertical: 6, gap: 0 }}>
      <T kind="label" style={{ marginTop: 6, marginBottom: spacing.xs }}>
        {title}
      </T>
      {lines.map((l, i) => (
        <Li key={`${l.label}-${i}`} last={i === lines.length - 1}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <T>{l.label}</T>
            {l.note ? <T kind="caption">{l.note}</T> : null}
          </View>
          <T kind="bodyBold">{negative ? formatPaise(-l.amountPaise) : formatPaise(l.amountPaise)}</T>
        </Li>
      ))}
    </Card>
  );
}

function daysLine(a: PayslipAttendance): string {
  const parts: string[] = [];
  if (a.daysInMonth != null) parts.push(`Days in month ${a.daysInMonth}`);
  if (a.paidDays != null) parts.push(`Paid days ${a.paidDays}`);
  if (a.marks) parts.push(`Marks ${a.marks}`);
  return parts.length ? `${parts.join(' · ')} · ` : '';
}
