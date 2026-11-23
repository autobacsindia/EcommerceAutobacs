/** Company, documents, bank (last 4 only), sign out, sign out everywhere. */
import { Linking, StyleSheet, View } from 'react-native';
import { confirm } from '../../src/lib/dialog';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { api, errorMessage } from '../../src/api';
import { useAccount, useSession } from '../../src/auth/session';
import { colors, spacing } from '../../src/theme';
import { Banner, Button, Divider, Logo, Screen, Section, T } from '../../src/ui';

const SUPPORT = (Constants.expoConfig?.extra as { supportEmail?: string } | undefined)?.supportEmail ?? 'support@autobacsindia.com';

export default function Profile() {
  const account = useAccount();
  const { signOut } = useSession();

  const everywhere = useMutation({
    mutationFn: () => api.signOutEverywhere(),
    onSuccess: () => void signOut(),
  });

  const confirmEverywhere = async () => {
    const yes = await confirm({
      title: 'Sign out on every phone?',
      message: 'Anyone signed in to this account, on any device, will need to sign in again.',
      ok: 'Sign out everywhere',
      destructive: true,
    });
    if (yes) everywhere.mutate();
  };

  return (
    <Screen edges={['top']}>
      <Logo size={34} />
      <T kind="display" style={{ fontSize: 26, marginTop: spacing.lg, marginBottom: spacing.lg }}>
        Profile
      </T>

      <Section title="Company">
        <Row label="Name" value={account.companyName} />
        <Row label="Contact" value={account.contactName} />
        <Row label="Mobile" value={account.phone ? `+91 ${account.phone}` : '—'} />
        <Row label="Email" value={account.email} />
        <Row label="City" value={account.city} />
        <Divider />
        <Row label="GSTIN" value={account.gstin} />
        <Row label="PAN" value={account.pan} />
      </Section>

      <Section title="Bank and documents" hint="To change these, email us — procurement re-checks bank changes.">
        <Row label="Account" value={account.bank.accountLast4 ? `•••• ${account.bank.accountLast4}` : '—'} />
        <Row label="IFSC" value={account.bank.ifsc} />
        {account.bank.upiId ? <Row label="UPI" value={account.bank.upiId} /> : null}
        <Divider />
        <Doc label="GST certificate" ok={account.hasGstCertificate} />
        <Doc label="Cancelled cheque" ok={account.hasCancelledCheque} />
      </Section>

      <Section title="Help" hint={`Questions about an order, a payment or a product check: ${SUPPORT}`}>
        <Button label="Email support" variant="ghost" icon="mail-outline" onPress={() => void Linking.openURL(`mailto:${SUPPORT}?subject=${encodeURIComponent(`Autobacs Partner — ${account.companyName}`)}`)} />
      </Section>

      {everywhere.isError ? <Banner tone="error">{errorMessage(everywhere.error)}</Banner> : null}
      <View style={{ gap: spacing.sm }}>
        <Button label="Sign out" variant="outline" icon="log-out-outline" onPress={() => void signOut()} />
        <Button label="Sign out everywhere" variant="danger" onPress={() => void confirmEverywhere()} loading={everywhere.isPending} />
      </View>
      <T kind="caption" style={{ textAlign: 'center', marginTop: spacing.xl }}>
        Autobacs Partner {Constants.expoConfig?.version ?? ''}
      </T>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <T kind="small" style={{ width: 90 }}>
        {label}
      </T>
      <T style={{ flex: 1, color: colors.ink }} selectable>
        {value || '—'}
      </T>
    </View>
  );
}

function Doc({ label, ok }: { label: string; ok: boolean }) {
  return (
    <View style={styles.row}>
      <Ionicons name={ok ? 'checkmark-circle' : 'alert-circle-outline'} size={18} color={ok ? colors.green : colors.gold} style={{ marginRight: 8 }} />
      <T style={{ flex: 1, color: colors.ink }}>{label}</T>
      <T kind="small">{ok ? 'Received' : 'Missing'}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
});
