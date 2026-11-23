/**
 * Onboarding. One route, two faces, chosen by the SERVER's account status:
 *   draft / changes_requested → the details form (+ procurement's note when asked to fix)
 *   in_review / rejected / suspended → a status page
 * Pull-to-refresh / focus refetch picks up procurement's decision; the app
 * never moves the status itself.
 */
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, IS_MOCK, type DocumentKind, type SupplierAccount } from '../src/api';
import { mockAdmin } from '../src/api/mock';
import { ME_KEY, useAccount, useSession } from '../src/auth/session';
import { choosePhotoSource, pickPhoto } from '../src/lib/pickPhoto';
import { checkOnboarding, digitsOnly, normalizePhone, normalizeUpper, type OnboardingFields } from '../src/lib/validate';
import { colors, radius, spacing } from '../src/theme';
import { Banner, Button, EmptyState, Field, Logo, Screen, Section, T } from '../src/ui';

export default function Onboarding() {
  const account = useAccount();
  return account.status === 'draft' || account.status === 'changes_requested' ? <DetailsForm account={account} /> : <ReviewStatus account={account} />;
}

// ── form ─────────────────────────────────────────────────────────────────────

function DetailsForm({ account }: { account: SupplierAccount }) {
  const { setAccount, signOut } = useSession();
  const [f, setF] = useState<OnboardingFields>({
    companyName: account.companyName,
    contactName: account.contactName,
    phone: account.phone,
    city: account.city,
    address: account.address,
    gstin: account.gstin,
    pan: account.pan,
    accountName: account.bank.accountName,
    accountNumber: '',
    accountNumberAgain: '',
    ifsc: account.bank.ifsc,
    upiId: account.bank.upiId,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof OnboardingFields, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const hasSavedAccount = !!account.bank.accountLast4;
  const set = (k: keyof OnboardingFields) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const save = useMutation({
    mutationFn: () =>
      api.updateMe({
        companyName: f.companyName.trim(),
        contactName: f.contactName.trim(),
        phone: normalizePhone(f.phone),
        city: f.city.trim(),
        address: f.address.trim(),
        gstin: normalizeUpper(f.gstin),
        pan: normalizeUpper(f.pan),
        bank: {
          accountName: f.accountName.trim(),
          ...(digitsOnly(f.accountNumber) ? { accountNumber: digitsOnly(f.accountNumber) } : {}),
          ifsc: normalizeUpper(f.ifsc),
          upiId: f.upiId.trim(),
        },
      }),
    onSuccess: (a) => {
      setAccount(a);
      setF((s) => ({ ...s, accountNumber: '', accountNumberAgain: '' }));
    },
  });

  const submit = useMutation({ mutationFn: () => api.submitForReview(), onSuccess: setAccount });

  const validate = () => {
    const e = checkOnboarding(f, { hasSavedAccount });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const docsReady = account.hasGstCertificate && account.hasCancelledCheque;

  const onSubmit = async () => {
    setProblem(null);
    if (!validate()) {
      setProblem('Some fields need a fix — they are marked in red.');
      return;
    }
    if (!docsReady) {
      setProblem('Add a photo of your GST certificate and a cancelled cheque (at the bottom).');
      return;
    }
    try {
      await save.mutateAsync();
      await submit.mutateAsync();
    } catch {
      /* shown in the banner */
    }
  };

  const busy = save.isPending || submit.isPending;
  const err = save.error ?? submit.error;

  return (
    <Screen
      edges={['top', 'bottom']}
      footer={
        <>
          <Button label="Send for approval" icon="paper-plane-outline" onPress={onSubmit} loading={busy} />
          <Button label="Save and finish later" variant="ghost" onPress={() => {
            setProblem(null);
            if (validate()) save.mutate();
            else setProblem('Some fields need a fix — they are marked in red.');
          }} disabled={busy} />
        </>
      }
    >
      <View style={styles.topRow}>
        <Logo size={34} />
        <Button label="Sign out" variant="ghost" small onPress={() => void signOut()} />
      </View>
      <T kind="h1" style={{ marginTop: spacing.lg }}>
        Your business details
      </T>
      <T kind="small" style={{ marginTop: 4, marginBottom: spacing.lg }}>
        Procurement checks these before you can list products. We pay to this bank account.
      </T>

      {account.status === 'changes_requested' ? (
        <Banner tone="warn" title="Procurement asked for a fix">
          {account.reviewNote || 'Please check your details and documents, then send again.'}
        </Banner>
      ) : null}
      {problem ? <Banner tone="warn">{problem}</Banner> : null}
      {err ? <Banner tone="error">{errorMessage(err)}</Banner> : null}
      {save.isSuccess && !submit.isPending && !submit.isSuccess ? <Banner tone="success">Saved.</Banner> : null}

      <Section title="Company">
        <Field label="Company name (as on GST)" value={f.companyName} onChangeText={set('companyName')} error={errors.companyName} autoCapitalize="words" />
        <Field label="Contact person" value={f.contactName} onChangeText={set('contactName')} error={errors.contactName} autoCapitalize="words" />
        <Field label="Mobile number" value={f.phone} onChangeText={set('phone')} error={errors.phone} keyboardType="phone-pad" prefix="+91" maxLength={14} />
        <Field label="City" value={f.city} onChangeText={set('city')} error={errors.city} autoCapitalize="words" />
        <Field label="Address" value={f.address} onChangeText={set('address')} error={errors.address} multiline containerStyle={{ marginBottom: 0 }} />
      </Section>

      <Section title="Tax">
        <Field
          label="GSTIN"
          value={f.gstin}
          onChangeText={(v) => set('gstin')(v.toUpperCase())}
          error={errors.gstin}
          autoCapitalize="characters"
          maxLength={15}
          placeholder="32ABCDE1234F1Z5"
        />
        <Field
          label="PAN"
          value={f.pan}
          onChangeText={(v) => set('pan')(v.toUpperCase())}
          error={errors.pan}
          autoCapitalize="characters"
          maxLength={10}
          placeholder="ABCDE1234F"
          containerStyle={{ marginBottom: 0 }}
        />
      </Section>

      <Section title="Bank account" hint="Payments for your products go here.">
        <Field label="Name on the account" value={f.accountName} onChangeText={set('accountName')} error={errors.accountName} autoCapitalize="words" />
        <Field
          label={hasSavedAccount ? `Account number (saved, ends ${account.bank.accountLast4})` : 'Account number'}
          value={f.accountNumber}
          onChangeText={(v) => set('accountNumber')(digitsOnly(v))}
          error={errors.accountNumber}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={18}
          placeholder={hasSavedAccount ? 'Leave blank to keep it' : ''}
        />
        {f.accountNumber ? (
          <Field
            label="Account number again"
            value={f.accountNumberAgain}
            onChangeText={(v) => set('accountNumberAgain')(digitsOnly(v))}
            error={errors.accountNumberAgain}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={18}
          />
        ) : null}
        <Field label="IFSC" value={f.ifsc} onChangeText={(v) => set('ifsc')(v.toUpperCase())} error={errors.ifsc} autoCapitalize="characters" maxLength={11} placeholder="HDFC0001234" />
        <Field label="UPI ID (optional)" value={f.upiId} onChangeText={set('upiId')} error={errors.upiId} autoCapitalize="none" containerStyle={{ marginBottom: 0 }} />
      </Section>

      <Section title="Documents" hint="Clear photos, all four corners visible.">
        <DocRow kind="gstCertificate" label="GST certificate" done={account.hasGstCertificate} />
        <View style={{ height: spacing.md }} />
        <DocRow kind="cancelledCheque" label="Cancelled cheque" done={account.hasCancelledCheque} />
      </Section>
    </Screen>
  );
}

function DocRow({ kind, label, done }: { kind: DocumentKind; label: string; done: boolean }) {
  const { setAccount } = useSession();
  const upload = useMutation({
    mutationFn: async () => {
      const source = await choosePhotoSource();
      if (!source) return null;
      const [file] = await pickPhoto(source);
      if (!file) return null;
      return api.uploadDocument(kind, file);
    },
    onSuccess: (a) => a && setAccount(a),
  });
  return (
    <View>
      <Pressable
        onPress={() => upload.mutate()}
        disabled={upload.isPending}
        accessibilityRole="button"
        accessibilityLabel={`${done ? 'Replace' : 'Add'} ${label}`}
        style={[styles.doc, done && { borderColor: colors.green, borderStyle: 'solid', backgroundColor: colors.greenFaint }]}
      >
        <Ionicons name={done ? 'checkmark-circle' : 'camera-outline'} size={26} color={colors.green} />
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <T kind="bodyBold">{label}</T>
          <T kind="small">{upload.isPending ? 'Uploading…' : done ? 'Received · tap to replace' : 'Take a photo or choose one'}</T>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.chrome} />
      </Pressable>
      {upload.isError ? (
        <T kind="caption" style={{ color: colors.red, marginTop: 6 }}>
          {errorMessage(upload.error)}
        </T>
      ) : null}
    </View>
  );
}

// ── status ───────────────────────────────────────────────────────────────────

const STATUS_COPY = {
  in_review: { icon: 'hourglass-outline', title: 'Waiting for approval', body: 'Thanks! Our procurement team is checking your details. You can close the app — come back and pull down, or tap Check again, to see the result.' },
  rejected: { icon: 'close-circle-outline', title: 'We cannot onboard you right now', body: 'Procurement could not approve this account.' },
  suspended: { icon: 'pause-circle-outline', title: 'Your account is paused', body: 'Procurement has paused this account. Your products stay as they are.' },
} as const;

function ReviewStatus({ account }: { account: SupplierAccount }) {
  const qc = useQueryClient();
  const { signOut } = useSession();
  const [refreshing, setRefreshing] = useState(false);
  const copy = STATUS_COPY[account.status as keyof typeof STATUS_COPY] ?? STATUS_COPY.in_review;

  const refresh = async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ME_KEY }).catch(() => {});
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.green} />}
      >
        <Logo size={34} />
        <EmptyState
          icon={copy.icon}
          title={copy.title}
          body={copy.body}
          action={
            <View style={{ gap: spacing.sm, alignItems: 'stretch', minWidth: 260 }}>
              {account.reviewNote ? (
                <Banner tone={account.status === 'in_review' ? 'info' : 'warn'} title="Note from procurement">
                  {account.reviewNote}
                </Banner>
              ) : null}
              <View style={styles.summary}>
                <T kind="caption">COMPANY</T>
                <T kind="bodyBold">{account.companyName}</T>
                <T kind="small">GSTIN {account.gstin || '—'}</T>
              </View>
              <Button label="Check again" icon="refresh" variant="outline" onPress={refresh} loading={refreshing} />
              <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
              {IS_MOCK ? <MockControls /> : null}
            </View>
          }
        />
      </ScrollView>
    </SafeAreaView>
  );
}

/** Dev mock only: play procurement so every state can be seen. */
function MockControls() {
  const qc = useQueryClient();
  const go = (s: Parameters<typeof mockAdmin.setAccountStatus>[0], note?: string) => {
    mockAdmin.setAccountStatus(s, note);
    void qc.invalidateQueries({ queryKey: ME_KEY });
  };
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: spacing.md }}>
      <Button small variant="outline" label="Mock: approve" onPress={() => go('approved')} />
      <Button small variant="outline" label="Mock: ask fix" onPress={() => go('changes_requested', 'The cancelled cheque photo is blurred. Please take it again in good light.')} />
      <Button small variant="outline" label="Mock: reject" onPress={() => go('rejected', 'We are not adding new suppliers in this category right now.')} />
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  doc: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.chrome,
  },
  summary: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: spacing.md, gap: 2 },
});
