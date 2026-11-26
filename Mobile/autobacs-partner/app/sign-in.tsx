import { useState } from 'react';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { api, errorMessage } from '../src/api';
import { useSession } from '../src/auth/session';
import { EMAIL_RE } from '../src/lib/validate';
import { Banner, Button, Field, LinkButton, Screen } from '../src/ui';

export default function SignIn() {
  const { completeSignIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const clean = email.trim().toLowerCase();

  // An account that never confirmed its email signs in as email_unverified;
  // the navigator then shows the email-code screen.
  const signIn = useMutation({ mutationFn: () => api.signIn(clean, password), onSuccess: completeSignIn });

  return (
    <Screen
      footer={<Button label="Sign in" onPress={() => signIn.mutate()} disabled={!EMAIL_RE.test(clean) || !password} loading={signIn.isPending} />}
    >
      {signIn.isError ? <Banner tone="error">{errorMessage(signIn.error)}</Banner> : null}
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" onSubmitEditing={() => signIn.mutate()} />
      <LinkButton label="Forgot password?" onPress={() => router.push({ pathname: '/forgot', params: { email: clean } })} />
    </Screen>
  );
}
