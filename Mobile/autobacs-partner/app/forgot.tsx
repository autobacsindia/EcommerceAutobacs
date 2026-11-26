import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { api, errorMessage } from '../src/api';
import { useSession } from '../src/auth/session';
import { CODE_RE, digitsOnly, EMAIL_RE, passwordProblem } from '../src/lib/validate';
import { Banner, Button, Field, LinkButton, Screen, T } from '../src/ui';

/** Two steps on one screen: email → (code + new password). */
export default function Forgot() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { completeSignIn } = useSession();
  const [email, setEmail] = useState(params.email ?? '');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [pwError, setPwError] = useState<string>();
  const clean = email.trim().toLowerCase();

  // The server answers the same whether or not the email has an account.
  const send = useMutation({ mutationFn: () => api.forgotPassword(clean), onSuccess: () => setStep('code') });
  const reset = useMutation({
    mutationFn: () => api.resetPassword(clean, code, password),
    // A successful reset signs in (and revokes every older session server-side).
    onSuccess: completeSignIn,
  });

  if (step === 'email') {
    return (
      <Screen footer={<Button label="Send code" onPress={() => send.mutate()} disabled={!EMAIL_RE.test(clean)} loading={send.isPending} />}>
        <T style={{ marginBottom: 20 }}>Enter your account email. If it is registered, we will send a 6-digit code to reset your password.</T>
        {send.isError ? <Banner tone="error">{errorMessage(send.error)}</Banner> : null}
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      </Screen>
    );
  }

  const submit = () => {
    const p = passwordProblem(password);
    setPwError(p ?? undefined);
    if (!p) reset.mutate();
  };

  return (
    <Screen footer={<Button label="Set new password" onPress={submit} disabled={!CODE_RE.test(code)} loading={reset.isPending} />}>
      <T style={{ marginBottom: 20 }}>
        If <T kind="bodyBold">{clean}</T> has an account, a code is on its way.
      </T>
      {reset.isError ? <Banner tone="error">{errorMessage(reset.error)}</Banner> : null}
      <Field label="6-digit code" value={code} onChangeText={(v) => setCode(digitsOnly(v).slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} />
      <Field label="New password" value={password} onChangeText={setPassword} error={pwError} hint="At least 8 characters, letters and numbers" secureTextEntry autoComplete="new-password" />
      <LinkButton label="Use a different email" onPress={() => setStep('email')} />
    </Screen>
  );
}
