/**
 * My documents (GET /hr/employees/:me/documents — scope "documents", self
 * allowed). Opening one asks the server for a 5-minute link each time, so a
 * link never lives on the phone.
 */
import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, errorMessage, type EmployeeDocument } from '../src/api';
import { useEmployee } from '../src/auth/session';
import { formatDay, istDate } from '../src/lib/dates';
import { colors, spacing } from '../src/theme';
import { Card, ComingSoon, ErrorState, Li, Loading, Screen, T } from '../src/ui';

const KIND: Record<string, string> = {
  offer_letter: 'Offer letter',
  appointment_letter: 'Appointment letter',
  pan: 'PAN card',
  photo: 'Photo',
  resume: 'Resume',
  aadhaar: 'Aadhaar',
  bank_proof: 'Bank proof',
  education: 'Education',
  experience: 'Experience letter',
  relieving_letter: 'Relieving letter',
  other: 'Other',
};

const kb = (b: number) => (b >= 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1000))} KB`);

export default function Documents() {
  const employee = useEmployee();
  const q = useQuery({ queryKey: ['documents', employee.id], queryFn: () => api.documents(employee.id) });
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const open = async (d: EmployeeDocument) => {
    setOpening(d.id);
    setOpenError(null);
    try {
      const { url } = await api.documentUrl(d.id);
      await Linking.openURL(url);
    } catch (err) {
      setOpenError(errorMessage(err));
    } finally {
      setOpening(null);
    }
  };

  return (
    <Screen edges={['bottom']} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        (q.error as { notAvailable?: boolean }).notAvailable ? (
          <ComingSoon what="Your documents" />
        ) : (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        )
      ) : q.data.items.length ? (
        <Card style={{ paddingVertical: 4 }}>
          {q.data.items.map((d, i) => (
            <Pressable key={d.id} onPress={() => void open(d)} disabled={!!opening} accessibilityRole="button" accessibilityLabel={`Open ${d.fileName}`}>
              <Li last={i === q.data.items.length - 1}>
                <View style={{ flexDirection: 'row', gap: spacing.md, flex: 1, alignItems: 'center' }}>
                  <Ionicons name={d.mimeType === 'application/pdf' ? 'document-outline' : 'image-outline'} size={22} color={colors.green} />
                  <View style={{ flex: 1 }}>
                    <T kind="bodyBold" numberOfLines={1}>
                      {KIND[d.kind] ?? d.fileName}
                    </T>
                    <T kind="small" numberOfLines={1}>
                      {[d.fileName, kb(d.sizeBytes), formatDay(istDate(new Date(d.createdAt)))].join(' · ')}
                    </T>
                  </View>
                </View>
                <Ionicons name={opening === d.id ? 'hourglass-outline' : 'open-outline'} size={18} color={colors.muted} />
              </Li>
            </Pressable>
          ))}
        </Card>
      ) : (
        <Card>
          <T kind="small">No documents yet. HR adds your offer letter and ID papers here.</T>
        </Card>
      )}
      {openError ? <T style={{ color: colors.bad }}>{openError}</T> : null}
    </Screen>
  );
}
