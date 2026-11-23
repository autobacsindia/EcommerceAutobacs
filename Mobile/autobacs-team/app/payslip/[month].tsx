/**
 * Payslip detail. Every figure is the server's snapshot (paise); the app only
 * formats it. The PDF downloads with the same login and opens the share sheet.
 */
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import { api, errorMessage, type PayslipLine } from '../../src/api';
import { formatDay, formatMonth } from '../../src/lib/dates';
import { formatPaise } from '../../src/lib/format';
import { colors, font, spacing } from '../../src/theme';
import { Button, Card, ErrorState, Li, Loading, Screen, T } from '../../src/ui';

const PAYSLIPS_KEY = ['payslips'] as const;

export default function PayslipDetail() {
  const { month } = useLocalSearchParams<{ month: string }>();
  const q = useQuery({ queryKey: PAYSLIPS_KEY, queryFn: () => api.payslips() });
  const slip = q.data?.items.find((p) => p.month === month);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const openPdf = async () => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      const uri = await api.payslipPdf(month);
      if (Platform.OS !== 'web' && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `Payslip ${formatMonth(month)}` });
      }
    } catch (err) {
      setPdfError(errorMessage(err));
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: month ? formatMonth(month) : 'Payslip' }} />
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
              <T kind="small">{formatMonth(slip.month)} take-home</T>
              <T kind="small">
                {slip.paidOn ? `Paid on ${formatDay(slip.paidOn)}` : 'Not paid yet'}
                {slip.bankLast4 ? ` to bank ••${slip.bankLast4}` : ''}
              </T>
            </View>
            <Text style={{ fontFamily: font.heading, fontSize: 22, color: colors.green, fontVariant: ['tabular-nums'] }}>{formatPaise(slip.netPaise)}</Text>
          </View>
          <Lines title="Earnings" lines={slip.earnings} />
          <Lines title="Deductions" lines={slip.deductions} negative />
          <T kind="small">
            Days in month {slip.daysInMonth} · Paid days {slip.paidDays} · Payslip {slip.number}
          </T>
          {pdfError ? <T style={{ color: colors.bad }}>{pdfError}</T> : null}
          <Button label="Download PDF" icon="download-outline" loading={pdfBusy} onPress={() => void openPdf()} />
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
          <T>{l.label}</T>
          <T kind="bodyBold">{negative ? formatPaise(-l.amountPaise) : formatPaise(l.amountPaise)}</T>
        </Li>
      ))}
    </Card>
  );
}
