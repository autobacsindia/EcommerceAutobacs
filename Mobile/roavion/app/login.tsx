/**
 * Sign in. Deliberately short: email, password, and a way out if the password
 * is forgotten. Errors come from the server verbatim, so "wrong password" and
 * "too many attempts" read the same here as on the website.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { font, noir, spacing, type } from '../src/theme';
import { PremiumButton, PressScale } from '../src/ui';
import { AuthShell, Field, FormMessage } from '../src/account/AuthShell';
import { useApp } from '../src/store';
import { requestPasswordReset } from '../src/api/account';

export default function LoginScreen() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { signIn } = useApp();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const submit = async () => {
    setError('');
    setNotice('');
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setBusy(true);
    try {
      await signIn(email, password);
      // Back to whatever they were doing, or to the shop.
      if (next) router.replace(next as never);
      else router.back();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    setError('');
    if (!email.trim()) return setError('Enter your email first, then tap "Forgot password".');
    try {
      await requestPasswordReset(email);
      setNotice('If that email is registered, a reset link is on its way.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to track orders and check out faster.">
      <Field
        label="Email"
        icon="mail-outline"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        accessibilityLabel="Email"
      />

      <Field
        label="Password"
        icon="lock-closed-outline"
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
        secureTextEntry={!show}
        secureToggle={{ shown: show, onToggle: () => setShow((v) => !v) }}
        autoCapitalize="none"
        autoComplete="current-password"
        accessibilityLabel="Password"
        onSubmitEditing={submit}
        returnKeyType="go"
      />

      <PressScale onPress={forgot} style={s.forgot} accessibilityLabel="Forgot password?">
        <Text style={s.linkText}>Forgot password?</Text>
      </PressScale>

      <FormMessage text={error} tone="error" />
      <FormMessage text={notice} tone="notice" />

      <PremiumButton label="Sign in" onPress={submit} loading={busy} iconRight="arrow-forward" variant="noir" full style={{ marginTop: spacing.sm }} />

      <View style={s.footer}>
        <Text style={s.footText}>New to Autobacs?</Text>
        <PressScale onPress={() => router.replace('/register')} accessibilityLabel="Create an account">
          <Text style={s.linkText}>Create an account</Text>
        </PressScale>
      </View>
    </AuthShell>
  );
}

const s = StyleSheet.create({
  forgot: { alignSelf: 'flex-end', marginTop: -spacing.sm, marginBottom: spacing.lg, paddingVertical: spacing.xs },
  linkText: { fontFamily: font.semibold, fontSize: 14, color: noir.gold },
  footer: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xxl },
  footText: { ...type.smallNoir },
});
