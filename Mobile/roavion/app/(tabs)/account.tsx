/**
 * Account — the customer's hub: who they are, their orders, and the settings a
 * phone app is expected to have.
 *
 * Signed out, it is a short invitation to sign in rather than a wall of
 * disabled rows.
 */
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, T } from '../../src/components/ui';
import { colors, font, radius, shadow, spacing } from '../../src/theme';
import { useApp } from '../../src/store';

const SITE = (Constants.expoConfig?.extra as { siteUrl?: string } | undefined)?.siteUrl ?? 'https://www.autobacsindia.com';
const SUPPORT_EMAIL = 'support@autobacsindia.com';
const SUPPORT_PHONE = '+919895257905';

type Row = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
};

function RowList({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <View style={{ marginTop: spacing.xl }}>
      <Text style={s.groupTitle}>{title}</Text>
      <View style={s.group}>
        {rows.map((r, i) => (
          <Pressable
            key={r.label}
            onPress={r.onPress}
            style={[s.row, i < rows.length - 1 && s.rowBorder]}
            accessibilityRole="button"
            accessibilityLabel={r.label}
          >
            <Ionicons name={r.icon} size={19} color={r.danger ? colors.red : colors.ink2} />
            <Text style={[s.rowLabel, r.danger && { color: colors.red }]}>{r.label}</Text>
            <Ionicons name="chevron-forward" size={17} color={colors.line} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function AccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { customer, signOut, garage } = useApp();

  const open = (url: string) => Linking.openURL(url).catch(() => {});

  const confirmSignOut = () =>
    Alert.alert('Sign out', 'You can sign back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);

  // Apple and Google both require an in-app route to delete an account. We send
  // the request to support rather than deleting silently, because orders are
  // financial records that cannot simply vanish.
  const requestDeletion = () =>
    Alert.alert(
      'Delete my account',
      'We will remove your account and personal details. Your past invoices are kept only as long as the law requires. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request deletion',
          style: 'destructive',
          onPress: () =>
            open(
              `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Delete my Roavion account')}&body=${encodeURIComponent(
                `Please delete the account for ${customer?.email ?? ''}.`,
              )}`,
            ),
        },
      ],
    );

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={s.title}>Account</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        {customer ? (
          <Card>
            <View style={s.identity}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>{customer.name.slice(0, 1).toUpperCase() || 'R'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <T kind="h3">{customer.name || 'Roavion customer'}</T>
                <T kind="small">{customer.email}</T>
                {garage && <T kind="small">Garage: {garage.make}{garage.model ? ` ${garage.model}` : ''}</T>}
              </View>
            </View>
          </Card>
        ) : (
          <Card>
            <T kind="h3">Sign in to Roavion</T>
            <T kind="small" style={{ marginTop: 4 }}>
              Track orders, save your car and check out faster.
            </T>
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
              <Button label="Sign in" onPress={() => router.push('/login')} style={{ flex: 1 }} />
              <Button label="Register" onPress={() => router.push('/register')} variant="outline" style={{ flex: 1 }} />
            </View>
          </Card>
        )}

        {customer && (
          <RowList
            title="ORDERS"
            rows={[
              { icon: 'receipt-outline', label: 'My orders', onPress: () => router.push('/orders') },
              { icon: 'car-sport-outline', label: 'My garage', onPress: () => router.push('/(tabs)/garage') },
              { icon: 'repeat-outline', label: 'Returns', onPress: () => open(`${SITE}/returns`) },
            ]}
          />
        )}

        <RowList
          title="HELP"
          rows={[
            { icon: 'call-outline', label: 'Call us', onPress: () => open(`tel:${SUPPORT_PHONE}`) },
            { icon: 'logo-whatsapp', label: 'WhatsApp a specialist', onPress: () => open(`https://wa.me/${SUPPORT_PHONE.replace('+', '')}`) },
            { icon: 'mail-outline', label: 'Email support', onPress: () => open(`mailto:${SUPPORT_EMAIL}`) },
            // Signed in: their orders are already here, with the status and
            // tracking number on each one. Sending them to the website's guest
            // tracker would ask someone who IS signed in to prove who they are
            // all over again, in a browser. Signed out, that page is still the
            // right answer, because it only needs an order number.
            customer
              ? { icon: 'cube-outline', label: 'Track an order', onPress: () => router.push('/orders') }
              : { icon: 'cube-outline', label: 'Track an order', onPress: () => open(`${SITE}/track`) },
          ]}
        />

        <RowList
          title="ABOUT"
          rows={[
            { icon: 'shield-outline', label: 'Privacy policy', onPress: () => open(`${SITE}/privacy`) },
            { icon: 'document-text-outline', label: 'Terms and conditions', onPress: () => open(`${SITE}/terms`) },
            { icon: 'car-outline', label: 'Shipping and delivery', onPress: () => open(`${SITE}/shipping`) },
            { icon: 'globe-outline', label: 'Visit our website', onPress: () => open(SITE) },
          ]}
        />

        {customer && (
          <RowList
            title="ACCOUNT"
            rows={[
              { icon: 'log-out-outline', label: 'Sign out', onPress: confirmSignOut },
              { icon: 'trash-outline', label: 'Delete my account', onPress: requestDeletion, danger: true },
            ]}
          />
        )}

        <Text style={s.version}>Roavion v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.header, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { fontFamily: font.bold, fontSize: 20, color: colors.white },

  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 50, height: 50, borderRadius: radius.pill, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font.bold, fontSize: 18, color: colors.green },

  groupTitle: { fontFamily: font.semibold, fontSize: 11, color: colors.muted, letterSpacing: 1, marginBottom: spacing.sm, marginLeft: 4 },
  group: { backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden', ...shadow.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.line },
  rowLabel: { flex: 1, fontFamily: font.medium, fontSize: 14, color: colors.ink },

  version: { fontFamily: font.regular, fontSize: 11.5, color: colors.muted, textAlign: 'center', marginTop: spacing.xl },
});
