/**
 * One-time consent before face enrolment. The text is versioned: the server
 * names the current version (FaceStatus.currentConsentVersion) and the app
 * sends it back, so a changed text asks everyone again.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, errorMessage } from '../../src/api';
import { getDeviceId } from '../../src/lib/device';
import { colors, spacing } from '../../src/theme';
import { Button, Card, Screen, T, type IconName } from '../../src/ui';

/** Version of the text below. Must equal the server's FACE_CONSENT_VERSION. */
export const CONSENT_TEXT_VERSION = '2026-11-v1';

const POINTS: { icon: IconName; text: string }[] = [
  { icon: 'scan-outline', text: 'We use your face only to check it is really you when you clock in or out.' },
  { icon: 'lock-closed-outline', text: 'Autobacs keeps a face code (numbers, not a photo), locked on our own server. No other company sees it.' },
  { icon: 'trash-outline', text: 'Photos are deleted right after the check. A photo is kept only if you ask HR to check a failed match, and then for 30 days at most.' },
  { icon: 'location-outline', text: 'When you clock in, the app also sends your location once, to check you are at your work site. It does not track you.' },
  { icon: 'exit-outline', text: 'You can withdraw at any time by asking HR (HR then marks your attendance by hand). Your face code is erased when you leave Autobacs.' },
];

export default function Consent() {
  const status = useQuery({ queryKey: ['status'], queryFn: () => api.status() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const serverVersion = status.data?.face.currentConsentVersion;
  const mismatch = !!serverVersion && serverVersion !== CONSENT_TEXT_VERSION;

  const agree = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.consent(CONSENT_TEXT_VERSION, await getDeviceId());
      router.replace({ pathname: '/face/check', params: { purpose: 'enrol' } });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <T kind="h1">Clock in with your face</T>
      <T kind="small">Please read this once. It takes a minute.</T>
      <Card style={{ gap: spacing.md }}>
        {POINTS.map((p) => (
          <View key={p.icon} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
            <Ionicons name={p.icon} size={20} color={colors.green} style={{ marginTop: 1 }} />
            <T style={{ flex: 1 }}>{p.text}</T>
          </View>
        ))}
      </Card>
      {mismatch ? (
        <T style={{ color: colors.bad }}>This app has an older version of this notice. Please update the app first.</T>
      ) : null}
      {error ? <T style={{ color: colors.bad }}>{error}</T> : null}
      <Button label="I agree, set up my face" variant="primary" loading={busy} disabled={mismatch} onPress={() => void agree()} />
      <Button label="Not now" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
