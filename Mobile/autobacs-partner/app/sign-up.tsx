import { useState } from 'react';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { api, errorMessage } from '../src/api';
import { useSession } from '../src/auth/session';
import { EMAIL_RE, normalizePhone, passwordProblem, PHONE_RE } from '../src/lib/validate';
import { Banner, Button, Field, LinkButton, Screen, T } from '../src/ui';

type Errors = Partial<Record<'email' | 'password' | 'companyName' | 'contactName' | 'phone', string>>;

export default function SignUp() {
  const [f, setF] = useState({ email: '', password: '', companyName: '', contactName: '', phone: '' });
  const [errors, setErrors] = useState<Errors>({});
  const { completeSignIn } = useSession();
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const signUp = useMutation({
    mutationFn: () =>
      api.signUp({
        email: f.email.trim().toLowerCase(),
        password: f.password,
        companyName: f.companyName.trim(),
        contactName: f.contactName.trim(),
        phone: normalizePhone(f.phone),
      }),
    // The server signs the new account in at once (status email_unverified);
    // the navigator then shows the email-code screen.
    onSuccess: completeSignIn,
  });

  const submit = () => {
    const e: Errors = {};
    if (!EMAIL_RE.test(f.email.trim())) e.email = 'Enter a valid email';
    const pw = passwordProblem(f.password);
    if (pw) e.password = pw;
    if (f.companyName.trim().length < 2) e.companyName = 'Enter your company name';
    if (f.contactName.trim().length < 2) e.contactName = 'Enter your name';
    if (!PHONE_RE.test(normalizePhone(f.phone))) e.phone = 'Enter a 10-digit mobile number';
    setErrors(e);
    if (Object.keys(e).length === 0) signUp.mutate();
  };

  return (
    <Screen footer={<Button label="Create account" onPress={submit} loading={signUp.isPending} />}>
      <T kind="small" style={{ marginBottom: 16 }}>
        We will email you a 6-digit code to confirm it is you.
      </T>
      {signUp.isError ? <Banner tone="error">{errorMessage(signUp.error)}</Banner> : null}
      <Field label="Company name" value={f.companyName} onChangeText={set('companyName')} error={errors.companyName} autoCapitalize="words" />
      <Field label="Your name" value={f.contactName} onChangeText={set('contactName')} error={errors.contactName} autoCapitalize="words" autoComplete="name" />
      <Field label="Mobile number" value={f.phone} onChangeText={set('phone')} error={errors.phone} keyboardType="phone-pad" prefix="+91" autoComplete="tel" maxLength={14} />
      <Field label="Email" value={f.email} onChangeText={set('email')} error={errors.email} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <Field
        label="Password"
        value={f.password}
        onChangeText={set('password')}
        error={errors.password}
        hint="At least 8 characters, letters and numbers"
        secureTextEntry
        autoComplete="new-password"
      />
      <LinkButton label="Already have an account? Sign in" onPress={() => router.replace('/sign-in')} />
    </Screen>
  );
}
