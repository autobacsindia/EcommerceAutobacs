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
import { font, noir, noirSurface, spacing, type } from '../../src/theme';
import { Crest, GlassChip, GoldRule, Overline, PremiumButton, PressScale, SerifTitle, Shimmer } from '../../src/ui';
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
            <View style={[s.rowIcon, r.danger && { borderColor: noir.sale }]}>
              <Ionicons name={r.icon} size={18} color={r.danger ? noir.sale : noir.gold} />
            </View>
            <Text style={[s.rowLabel, r.danger && { color: noir.sale }]} numberOfLines={1}>{r.label}</Text>
            <Ionicons name="chevron-forward" size={16} color={noir.textFaint} />
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
          <View style={s.heroTop}>
            <Crest />
            <Overline tone="gold">{customer ? 'My account' : 'Welcome'}</Overline>
          </View>
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
                <SerifTitle size="title" numberOfLines={1}>{customer.name || 'Autobacs customer'}</SerifTitle>
                <Text style={s.email} numberOfLines={1}>{customer.email}</Text>
              </View>
            </View>
          ) : (
            <View style={{ marginTop: spacing.sm }}>
              <SerifTitle size="title" italicLast>Sign in to Autobacs</SerifTitle>
              <Text style={[s.email, { marginTop: 4 }]}>Track orders, save your car and check out faster.</Text>
              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
                <PremiumButton label="Sign in" variant="noir" onPress={() => router.push('/login')} style={{ flex: 1 }} />
                <PremiumButton label="Register" variant="noirOutline" onPress={() => router.push('/register')} style={{ flex: 1 }} />
              </View>
            </View>
          )}
          <GlassChip
            tone="gold"
            icon="car-sport-outline"
            label={garage ? `${garage.make}${garage.model ? ` ${garage.model}` : ''}` : 'Add your car'}
            action={garage ? 'Change' : undefined}
            onPress={() => router.push('/garage')}
            style={{ marginTop: spacing.lg, alignSelf: 'flex-start' }}
          />
        </View>
        <GoldRule />

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
  screen: { flex: 1, backgroundColor: noir.page },

  hero: { backgroundColor: noir.page, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  avatar: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: noir.green,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: noir.gold,
  },
  avatarText: { fontFamily: font.serif, fontSize: 28, color: noir.text },
  email: { ...type.smallNoir, marginTop: 2 },

  groupTitle: { ...type.capsNoir, color: noir.greenText, marginBottom: spacing.sm, marginLeft: 2 },
  group: { ...noirSurface, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, minHeight: 56 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: noir.hairline },
  rowIcon: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: noir.goldLine,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { flex: 1, fontFamily: font.medium, fontSize: 15, color: noir.text },

  version: { ...type.smallNoir, fontSize: 12, color: noir.textFaint, textAlign: 'center', marginTop: spacing.xl },
});
