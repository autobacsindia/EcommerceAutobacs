/**
 * Account — the customer's hub: who they are, their orders, and the settings a
 * phone app is expected to have.
 *
 * Signed out, it is a short invitation to sign in rather than a wall of
 * disabled rows.
 */
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { colors, elevation, font, radius, spacing, type } from '../../src/theme';
import { GlassChip, Overline, PremiumButton, PressScale, Shimmer, Stripes } from '../../src/ui';
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
          <PressScale
            key={r.label}
            onPress={r.onPress}
            haptic="selection"
            scaleTo={0.985}
            style={[s.row, i < rows.length - 1 && s.rowBorder]}
            accessibilityLabel={r.label}
          >
            <View style={[s.rowIcon, r.danger && { backgroundColor: colors.redSoft }]}>
              <Ionicons name={r.icon} size={18} color={r.danger ? colors.red : colors.green} />
            </View>
            <Text style={[s.rowLabel, r.danger && { color: colors.red }]} numberOfLines={1}>{r.label}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.chrome} />
          </PressScale>
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
              `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Delete my Autobacs account')}&body=${encodeURIComponent(
                `Please delete the account for ${customer?.email ?? ''}.`,
              )}`,
            ),
        },
      ],
    );

  const initial = customer?.name?.trim().slice(0, 1).toUpperCase() || 'A';

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        {/* Avatar header — carbon band with the brand stripes. */}
        <View style={[s.hero, { paddingTop: insets.top + spacing.lg }]}>
          <View style={s.heroStripes} pointerEvents="none">
            <Stripes width={44} height={120} gap={10} onDark />
          </View>
          <Overline onDark>{customer ? 'My account' : 'Welcome'}</Overline>
          {customer === undefined ? (
            <View style={[s.identity, { marginTop: spacing.lg }]}>
              <Shimmer width={64} height={64} radius={32} dark />
              <View style={{ flex: 1, gap: 8 }}>
                <Shimmer width="60%" height={16} dark />
                <Shimmer width="80%" height={12} dark />
              </View>
            </View>
          ) : customer ? (
            <View style={[s.identity, { marginTop: spacing.lg }]}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>{initial}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.name} numberOfLines={1}>{customer.name || 'Autobacs customer'}</Text>
                <Text style={s.email} numberOfLines={1}>{customer.email}</Text>
              </View>
            </View>
          ) : (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={s.name}>Sign in to Autobacs</Text>
              <Text style={[s.email, { marginTop: 4 }]}>Track orders, save your car and check out faster.</Text>
              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
                <PremiumButton label="Sign in" variant="light" onPress={() => router.push('/login')} style={{ flex: 1 }} />
                <PremiumButton label="Register" variant="outlineLight" onPress={() => router.push('/register')} style={{ flex: 1 }} />
              </View>
            </View>
          )}
          <GlassChip
            icon="car-sport-outline"
            label={garage ? `${garage.make}${garage.model ? ` ${garage.model}` : ''}` : 'Add your car'}
            action={garage ? 'Change' : undefined}
            onPress={() => router.push('/garage')}
            style={{ marginTop: spacing.lg, alignSelf: 'flex-start' }}
          />
        </View>

        <View style={{ paddingHorizontal: spacing.lg }}>
        {customer && (
          <RowList
            title="Orders"
            rows={[
              { icon: 'receipt-outline', label: 'My orders', onPress: () => router.push('/orders') },
              { icon: 'repeat-outline', label: 'Returns', onPress: () => open(`${SITE}/returns`) },
            ]}
          />
        )}

        <RowList
          title="My stuff"
          rows={[
            { icon: 'film-outline', label: 'My reels', onPress: () => router.push(customer ? '/reels/mine' : '/login?next=/reels/mine') },
            {
              icon: 'car-sport-outline',
              label: garage ? `My garage · ${garage.make}${garage.model ? ` ${garage.model}` : ''}` : 'My garage',
              onPress: () => router.push('/garage'),
            },
          ]}
        />

        <RowList
          title="Help"
          rows={[
            { icon: 'call-outline', label: 'Call us', onPress: () => open(`tel:${SUPPORT_PHONE}`) },
            { icon: 'logo-whatsapp', label: 'WhatsApp a specialist', onPress: () => open(`https://wa.me/${SUPPORT_PHONE.replace('+', '')}`) },
            { icon: 'mail-outline', label: 'Email support', onPress: () => open(`mailto:${SUPPORT_EMAIL}`) },
            { icon: 'cube-outline', label: 'Track an order', onPress: () => open(`${SITE}/track`) },
          ]}
        />

        <RowList
          title="About"
          rows={[
            { icon: 'shield-outline', label: 'Privacy policy', onPress: () => open(`${SITE}/privacy`) },
            { icon: 'document-text-outline', label: 'Terms and conditions', onPress: () => open(`${SITE}/terms`) },
            { icon: 'car-outline', label: 'Shipping and delivery', onPress: () => open(`${SITE}/shipping`) },
            { icon: 'globe-outline', label: 'Visit our website', onPress: () => open(SITE) },
          ]}
        />

        {customer && (
          <RowList
            title="Account"
            rows={[
              { icon: 'log-out-outline', label: 'Sign out', onPress: confirmSignOut },
              { icon: 'trash-outline', label: 'Delete my account', onPress: requestDeletion, danger: true },
            ]}
          />
        )}

          <Text style={s.version}>Autobacs v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  hero: {
    backgroundColor: colors.carbon, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl,
    borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, overflow: 'hidden',
  },
  heroStripes: { position: 'absolute', right: spacing.lg, top: 28, opacity: 0.18 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  avatar: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.green,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.onDarkFaint,
  },
  avatarText: { fontFamily: font.extrabold, fontSize: 26, color: colors.white },
  name: { ...type.h1, color: colors.white },
  email: { ...type.small, color: colors.onDarkMuted },

  groupTitle: { ...type.overline, color: colors.muted, marginBottom: spacing.sm, marginLeft: 4 },
  group: { backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', ...elevation.e1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, minHeight: 56 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  rowIcon: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.greenFaint, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontFamily: font.medium, fontSize: 15, color: colors.ink },

  version: { ...type.caption, color: colors.muted, textAlign: 'center', marginTop: spacing.xl },
});
