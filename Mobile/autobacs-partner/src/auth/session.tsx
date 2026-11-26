/**
 * Who is signed in, and where that lets them go.
 *
 * The token lives in SecureStore (api/client). The account — and therefore the
 * status that decides which screens are reachable — is ALWAYS the server's
 * answer from GET /partner/me, never something the app sets locally. After any
 * action that can change status (submit, sign-in) we write the server's reply
 * into the query cache; we never guess the next status.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type AuthResult, type SupplierAccount } from '../api';
import { loadToken, setToken, setUnauthorizedHandler } from '../api/client';

export const ME_KEY = ['me'] as const;

type Phase = 'loading' | 'signedOut' | 'signedIn';

type SessionValue = {
  phase: Phase;
  account: SupplierAccount | null;
  /** Set when /me failed for a reason other than "signed out" (offline, 5xx). */
  accountError: unknown;
  retryAccount: () => void;
  completeSignIn: (r: AuthResult) => Promise<void>;
  signOut: () => Promise<void>;
  setAccount: (a: SupplierAccount) => void;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [hasToken, setHasToken] = useState<boolean | null>(null);

  useEffect(() => {
    loadToken().then((t) => setHasToken(!!t));
  }, []);

  const signOut = useCallback(async () => {
    await setToken(null);
    setHasToken(false);
    qc.clear(); // nothing of the previous supplier stays on the phone
  }, [qc]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void signOut();
    });
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await api.me();
      } catch (err) {
        // 401 = the stored token is dead (expired, "sign out everywhere", account
        // removed): drop it rather than show "could not load". The HTTP client
        // also does this; doing it here covers every PartnerApi implementation.
        if (err instanceof ApiError && err.status === 401) void signOut();
        throw err;
      }
    },
    enabled: hasToken === true,
    staleTime: 30_000,
    retry: (n, err) => !(err instanceof ApiError && err.status > 0 && err.status < 500) && n < 2,
  });

  const completeSignIn = useCallback(
    async (r: AuthResult) => {
      await setToken(r.token);
      qc.setQueryData(ME_KEY, r.account);
      setHasToken(true);
    },
    [qc],
  );

  const setAccount = useCallback((a: SupplierAccount) => qc.setQueryData(ME_KEY, a), [qc]);

  const phase: Phase =
    hasToken === null ? 'loading' : !hasToken ? 'signedOut' : me.data ? 'signedIn' : me.isError ? 'signedIn' : 'loading';

  const value = useMemo<SessionValue>(
    () => ({
      phase,
      account: me.data ?? null,
      accountError: me.data ? null : me.error,
      retryAccount: () => void me.refetch(),
      completeSignIn,
      signOut,
      setAccount,
    }),
    [phase, me, completeSignIn, signOut, setAccount],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

/** Signed in AND the account is known (not merely a token). */
export function useAccount(): SupplierAccount {
  const { account } = useSession();
  if (!account) throw new Error('useAccount used before the account loaded');
  return account;
}
