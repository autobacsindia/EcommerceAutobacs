/**
 * Create an account. Only what the shop genuinely needs — name, email,
 * password, and a phone number for delivery updates.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { font, noir, spacing, type } from '../src/theme';
import { PremiumButton, PressScale } from '../src/ui';
import { AuthShell, Field, FormMessage } from '../src/account/AuthShell';
import { useApp } from '../src/store';

export default function RegisterScreen() {
  const router = useRouter();
  const { signUp } = useApp();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!name.trim()) return setError('Please enter your name.');
    if (!email.trim()) return setError('Please enter your email.');
    if (password.length < 8) return setError('Use a password of at least 8 characters.');
    setBusy(true);
    try {
      await signUp(name, email, password, phone || undefined);
      router.replace('/(tabs)');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create your account" subtitle="It takes a minute, and your cart comes with you.">
      <Field label="Full name" icon="person-outline" value={name} onChangeText={setName} placeholder="e.g. Rahul Sharma"
        autoCapitalize="words" autoComplete="name" accessibilityLabel="Full name" />

      <Field label="Email" icon="mail-outline" value={email} onChangeText={setEmail} placeholder="you@example.com"
        keyboardType="email-address" autoCapitalize="none" autoComplete="email" accessibilityLabel="Email" />

      <Field label="Mobile number (optional)" icon="call-outline" value={phone} onChangeText={setPhone} placeholder="10-digit mobile number"
        keyboardType="phone-pad" maxLength={16} accessibilityLabel="Mobile number" />

      <Field label="Password" icon="lock-closed-outline" value={password} onChangeText={setPassword}
        placeholder="At least 8 characters" secureTextEntry={!show} secureToggle={{ shown: show, onToggle: () => setShow((v) => !v) }}
        autoCapitalize="none" autoComplete="new-password" accessibilityLabel="Password" />

      <FormMessage text={error} tone="error" />

      <PremiumButton label="Create account" onPress={submit} loading={busy} iconRight="arrow-forward" variant="noir" full style={{ marginTop: spacing.sm }} />

      <Text style={s.legal}>By continuing you agree to our Terms and Privacy Policy.</Text>

      <View style={s.footer}>
        <Text style={s.footText}>Already have an account?</Text>
        <PressScale onPress={() => router.replace('/login')} accessibilityLabel="Sign in">
          <Text style={s.linkText}>Sign in</Text>
        </PressScale>
      </View>
    </AuthShell>
  );
}

const s = StyleSheet.create({
  legal: { ...type.tiny, color: noir.textFaint, textAlign: 'center', marginTop: spacing.md },
  linkText: { fontFamily: font.semibold, fontSize: 14, color: noir.gold },
  footer: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xxl },
  footText: { ...type.smallNoir },
});
