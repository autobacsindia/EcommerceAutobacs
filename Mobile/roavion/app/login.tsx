/**
 * Sign in. Deliberately short: email, password, and a way out if the password
 * is forgotten. Errors come from the server verbatim, so "wrong password" and
 * "too many attempts" read the same here as on the website.
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, T } from '../src/components/ui';
import { colors, font, radius, spacing } from '../src/theme';
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
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <T kind="h1">Welcome back</T>
        <T kind="small" style={{ marginTop: 4, marginBottom: spacing.xl }}>
          Sign in to track orders and check out faster.
        </T>

        <Text style={s.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          style={s.input}
          placeholder="you@example.com"
          placeholderTextColor={colors.muted}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          accessibilityLabel="Email"
        />

        <Text style={s.label}>Password</Text>
        <View style={s.passwordRow}>
          <TextInput
            value={password}
            onChangeText={setPassword}
            style={[s.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Your password"
            placeholderTextColor={colors.muted}
            secureTextEntry={!show}
            autoCapitalize="none"
            autoComplete="current-password"
            accessibilityLabel="Password"
            onSubmitEditing={submit}
            returnKeyType="go"
          />
          <Pressable onPress={() => setShow((v) => !v)} style={s.showBtn} accessibilityRole="button">
            <Text style={s.showText}>{show ? 'Hide' : 'Show'}</Text>
          </Pressable>
        </View>

        {!!error && <Text style={s.error}>{error}</Text>}
        {!!notice && <Text style={s.notice}>{notice}</Text>}

        <Button label="Sign in" onPress={submit} loading={busy} full style={{ marginTop: spacing.lg }} />

        <Pressable onPress={forgot} style={s.link} accessibilityRole="button">
          <Text style={s.linkText}>Forgot password?</Text>
        </Pressable>

        <View style={s.footer}>
          <T kind="small">New to Roavion?</T>
          <Pressable onPress={() => router.replace('/register')} accessibilityRole="button">
            <Text style={s.linkText}>Create an account</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.xl, paddingTop: spacing.xxl },
  label: { fontFamily: font.semibold, fontSize: 12.5, color: colors.ink2, marginBottom: 6 },
  input: {
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: spacing.lg, height: 50, fontFamily: font.regular, fontSize: 14,
    color: colors.ink, marginBottom: spacing.lg,
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  showBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  showText: { fontFamily: font.semibold, fontSize: 12.5, color: colors.green },
  error: { fontFamily: font.medium, fontSize: 12.5, color: colors.red, marginBottom: spacing.sm },
  notice: { fontFamily: font.medium, fontSize: 12.5, color: colors.green, marginBottom: spacing.sm },
  link: { alignSelf: 'center', marginTop: spacing.lg, padding: spacing.sm },
  linkText: { fontFamily: font.semibold, fontSize: 13, color: colors.green },
  footer: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xxl },
});
