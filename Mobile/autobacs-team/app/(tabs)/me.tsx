/**
 * Me: my profile as HR holds it (GET /hr/me — read-only here; changes go
 * through HR), links to marks/overtime, documents and holidays, app version,
 * and sign out. Bank/PAN show only the last 4 digits the server sends.
 */
import { Pressable, View } from 'react-native';
import { router, type Href } from 'expo-router';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useEmployee, useSession } from '../../src/auth/session';
import { confirmSignOut } from '../../src/auth/confirmSignOut';
import { formatDay } from '../../src/lib/dates';
import { versionLabel } from '../../src/updates/useOtaUpdate';
import { colors, spacing } from '../../src/theme';
import { Button, Card, Li, Screen, T, type IconName } from '../../src/ui';

const LINKS: { to: Href; label: string; hint: string; icon: IconName }[] = [
  { to: '/marks', label: 'Marks and overtime', hint: 'Late, early and overtime this month', icon: 'stopwatch-outline' },
  { to: '/documents', label: 'My documents', hint: 'Offer letter, ID and other files', icon: 'folder-open-outline' },
  { to: '/holidays', label: 'Holidays', hint: 'Days the company is closed', icon: 'sunny-outline' },
];

const TYPE_LABEL: Record<string, string> = { full_time: 'Full time', part_time: 'Part time', contract: 'Contract', intern: 'Intern' };

function Info({ label, value, last }: { label: string; value: string | null | undefined; last?: boolean }) {
  if (!value) return null;
  return (
    <Li last={last}>
      <T kind="small">{label}</T>
      <T kind="bodyBold" style={{ flexShrink: 1, textAlign: 'right', marginLeft: spacing.md }}>
        {value}
      </T>
    </Li>
  );
}

export default function Me() {
  const e = useEmployee();
  const { signOut } = useSession();
  const ec = e.emergencyContact;
  return (
    <Screen>
      <View style={{ gap: 2 }}>
        <T kind="h1">{e.name}</T>
        <T kind="small">
          {[e.designation, e.team ? `${e.team[0].toUpperCase()}${e.team.slice(1)} team` : '', e.employeeCode].filter(Boolean).join(' · ')}
        </T>
      </View>

      <Card style={{ paddingVertical: 4 }}>
        {LINKS.map((l, i) => (
          <Pressable key={l.label} onPress={() => router.push(l.to)} accessibilityRole="button" accessibilityHint={l.hint}>
            <Li last={i === LINKS.length - 1}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 }}>
                <Ionicons name={l.icon} size={20} color={colors.green} />
                <View style={{ flex: 1 }}>
                  <T kind="bodyBold">{l.label}</T>
                  <T kind="small">{l.hint}</T>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Li>
          </Pressable>
        ))}
      </Card>

      <Card style={{ paddingVertical: 4 }}>
        <T kind="label" style={{ marginTop: 8 }}>
          Work
        </T>
        <Info label="Joined" value={e.joinDate ? `${formatDay(e.joinDate)} ${e.joinDate.slice(0, 4)}` : null} />
        <Info label="Type" value={e.employmentType ? TYPE_LABEL[e.employmentType] ?? e.employmentType : null} />
        <Info label="Work email" value={e.workEmail} />
        <Info label="Phone" value={e.phone} last />
      </Card>

      {e.bank?.accountLast4 || e.panLast4 || e.uan ? (
        <Card style={{ paddingVertical: 4 }}>
          <T kind="label" style={{ marginTop: 8 }}>
            Pay details
          </T>
          <Info label="Bank account" value={e.bank?.accountLast4 ? `••${e.bank.accountLast4}` : null} />
          <Info label="IFSC" value={e.bank?.ifsc} />
          <Info label="PAN" value={e.panLast4 ? `••${e.panLast4}` : null} />
          <Info label="UAN (PF)" value={e.uan} last />
        </Card>
      ) : null}

      {ec?.name ? (
        <Card style={{ paddingVertical: 4 }}>
          <T kind="label" style={{ marginTop: 8 }}>
            Emergency contact
          </T>
          <Info label={ec.relation || 'Contact'} value={ec.name} />
          <Info label="Phone" value={ec.phone} last />
        </Card>
      ) : null}

      <T kind="small">Something wrong here? Ask HR to change it.</T>
      <Button label="Sign out" variant="danger" icon="log-out-outline" onPress={() => void confirmSignOut(e, signOut)} />
      <T kind="caption" style={{ textAlign: 'center' }}>
        Autobacs Team {versionLabel(Constants.expoConfig?.version)}
      </T>
    </Screen>
  );
}
