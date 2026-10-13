/**
 * Create an account. Only what the shop genuinely needs — name, email,
 * password, and a phone number for delivery updates.
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, T } from '../src/components/ui';
import { colors, font, radius, spacing } from '../src/theme';
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
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <T kind="h1">Create your account</T>
        <T kind="small" style={{ marginTop: 4, marginBottom: spacing.xl }}>
          It takes a minute, and your cart comes with you.
        </T>

        <Text style={s.label}>Full name</Text>
        <TextInput value={name} onChangeText={setName} style={s.input} placeholder="e.g. Rahul Sharma"
          placeholderTextColor={colors.muted} autoCapitalize="words" autoComplete="name" accessibilityLabel="Full name" />

        <Text style={s.label}>Email</Text>
        <TextInput value={email} onChangeText={setEmail} style={s.input} placeholder="you@example.com"
          placeholderTextColor={colors.muted} keyboardType="email-address" autoCapitalize="none"
          autoComplete="email" accessibilityLabel="Email" />

        <Text style={s.label}>Mobile number (optional)</Text>
        <TextInput value={phone} onChangeText={setPhone} style={s.input} placeholder="10-digit mobile number"
          placeholderTextColor={colors.muted} keyboardType="phone-pad" maxLength={16} accessibilityLabel="Mobile number" />

        <Text style={s.label}>Password</Text>
        <View style={s.passwordRow}>
          <TextInput value={password} onChangeText={setPassword} style={[s.input, { flex: 1, marginBottom: 0 }]}
            placeholder="At least 8 characters" placeholderTextColor={colors.muted} secureTextEntry={!show}
            autoCapitalize="none" autoComplete="new-password" accessibilityLabel="Password" />
          <Pressable onPress={() => setShow((v) => !v)} style={s.showBtn} accessibilityRole="button">
            <Text style={s.showText}>{show ? 'Hide' : 'Show'}</Text>
          </Pressable>
        </View>

        {!!error && <Text style={s.error}>{error}</Text>}

        <Button label="Create account" onPress={submit} loading={busy} full style={{ marginTop: spacing.lg }} />

        <T kind="tiny" style={{ textAlign: 'center', marginTop: spacing.md }}>
          By continuing you agree to our Terms and Privacy Policy.
        </T>

        <View style={s.footer}>
          <T kind="small">Already have an account?</T>
          <Pressable onPress={() => router.replace('/login')} accessibilityRole="button">
            <Text style={s.linkText}>Sign in</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.xl, paddingTop: spacing.xl },
  label: { fontFamily: font.semibold, fontSize: 13, color: colors.ink2, marginBottom: 6 },
  input: {
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: spacing.lg, height: 50, fontFamily: font.regular, fontSize: 15,
    color: colors.ink, marginBottom: spacing.lg,
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  showBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  showText: { fontFamily: font.semibold, fontSize: 13, color: colors.green },
  error: { fontFamily: font.medium, fontSize: 13, color: colors.red, marginBottom: spacing.sm },
  linkText: { fontFamily: font.semibold, fontSize: 14, color: colors.green },
  footer: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xxl },
});
