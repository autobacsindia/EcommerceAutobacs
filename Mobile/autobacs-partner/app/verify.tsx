/**
 * Email code. Shown only to a SIGNED-IN account whose status is
 * email_unverified (sign-up returns a token at once). Confirming writes the
 * server's account into the session; the navigator then moves on by itself.
 */
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError, errorMessage } from '../src/api';
import { useAccount, useSession } from '../src/auth/session';
import { CODE_RE, digitsOnly } from '../src/lib/validate';
import { Banner, Button, Field, LinkButton, Screen, T } from '../src/ui';

const RESEND_SECONDS = 60;

export default function Verify() {
  const account = useAccount();
  const { setAccount, signOut } = useSession();
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const verify = useMutation({ mutationFn: () => api.verifyEmail(code), onSuccess: setAccount });
  const resend = useMutation({
    mutationFn: () => api.resendCode(),
    onSuccess: () => setWait(RESEND_SECONDS),
    onError: (err) => {
      // The server's cooldown wins over ours.
      const s = err instanceof ApiError ? Number(err.extra.retryAfterSeconds) : NaN;
      if (Number.isFinite(s) && s > 0) setWait(Math.ceil(s));
    },
  });

  return (
    <Screen footer={<Button label="Confirm" onPress={() => verify.mutate()} disabled={!CODE_RE.test(code)} loading={verify.isPending} />}>
      <T style={{ marginBottom: 20 }}>
        We sent a 6-digit code to <T kind="bodyBold">{account.email}</T>. It can take a minute; check spam too.
      </T>
      {verify.isError ? <Banner tone="error">{errorMessage(verify.error)}</Banner> : null}
      {resend.isError ? <Banner tone="error">{errorMessage(resend.error)}</Banner> : null}
      {resend.isSuccess && wait > 0 ? <Banner tone="success">A new code is on its way.</Banner> : null}
      <Field
        label="6-digit code"
        value={code}
        onChangeText={(v) => setCode(digitsOnly(v).slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        style={{ fontSize: 24, letterSpacing: 8, textAlign: 'center' }}
        autoFocus
      />
      {wait > 0 ? (
        <T kind="small">You can ask for a new code in {wait}s</T>
      ) : (
        <LinkButton label={resend.isPending ? 'Sending…' : 'Send a new code'} onPress={() => resend.mutate()} />
      )}
      <LinkButton label="Wrong email? Start again" onPress={() => void signOut()} style={{ marginTop: 24 }} />
    </Screen>
  );
}
