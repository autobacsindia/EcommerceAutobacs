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
import { Image } from 'expo-image';
import { PremiumButton, PressScale, Shimmer } from '../../src/ui';
import { useApp } from '../../src/store';

const BADGE = require('../../assets/icon.png');

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
        {/* WhatsApp-style: large bold title, then the profile as a chat row. */}
        <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
          <Text style={s.title} accessibilityRole="header">Account</Text>
        </View>

        <View style={{ paddingHorizontal: spacing.lg }}>
          {customer === undefined ? (
            <View style={[s.group, s.profile]}>
              <Shimmer width={56} height={56} radius={28} />
              <View style={{ flex: 1, gap: 8 }}>
                <Shimmer width="60%" height={16} />
                <Shimmer width="80%" height={12} />
              </View>
            </View>
          ) : customer ? (
            <View style={[s.group, s.profile]}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>{initial}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.name} numberOfLines={1}>{customer.name || 'Autobacs customer'}</Text>
                <Text style={s.email} numberOfLines={1}>{customer.email}</Text>
              </View>
            </View>
          ) : (
            <View style={[s.group, s.signedOut]}>
              <View style={s.profileRow}>
                <Image source={BADGE} style={s.avatar} contentFit="cover" />
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>Sign in to Autobacs</Text>
                  <Text style={s.email}>Track orders, save your car and check out faster.</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
                <PremiumButton label="Sign in" variant="green" onPress={() => router.push('/login')} style={{ flex: 1 }} />
                <PremiumButton label="Register" variant="outline" onPress={() => router.push('/register')} style={{ flex: 1 }} />
              </View>
            </View>
          )}
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
            {
              icon: 'car-sport-outline',
              label: garage ? `My garage · ${garage.make}${garage.model ? ` ${garage.model}` : ''}` : 'Add your car',
              onPress: () => router.push('/garage'),
            },
            { icon: 'film-outline', label: 'My reels', onPress: () => router.push(customer ? '/reels/mine' : '/login?next=/reels/mine') },
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
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.bg },
  title: { fontFamily: font.extrabold, fontSize: 30, color: colors.ink, letterSpacing: -0.5 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  signedOut: { padding: spacing.lg },

  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.green, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: font.extrabold, fontSize: 22, color: colors.white },
  name: { fontFamily: font.bold, fontSize: 17, color: colors.ink },
  email: { ...type.small, color: colors.muted, marginTop: 2 },

  groupTitle: { ...type.overline, color: colors.muted, marginBottom: spacing.sm, marginLeft: 4 },
  group: { backgroundColor: colors.white, borderRadius: radius.lg, overflow: 'hidden', ...elevation.e1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: spacing.lg, paddingRight: spacing.md, minHeight: 60 },
  // Chat-row divider: inset to start after the round icon.
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  rowIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontFamily: font.medium, fontSize: 15, color: colors.ink },

  version: { ...type.caption, color: colors.muted, textAlign: 'center', marginTop: spacing.xl },
});
