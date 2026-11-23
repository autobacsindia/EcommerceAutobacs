/**
 * "/" — send the supplier to the one place their (server-given) status allows.
 * The guards in _layout.tsx enforce it; this only picks the landing screen.
 */
import { Redirect } from 'expo-router';
import { useSession } from '../src/auth/session';

export default function Index() {
  const { phase, account } = useSession();
  if (phase === 'signedOut') return <Redirect href="/welcome" />;
  if (account?.status === 'approved') return <Redirect href="/products" />;
  if (account?.status === 'email_unverified') return <Redirect href="/verify" />;
  return <Redirect href="/onboarding" />;
}
