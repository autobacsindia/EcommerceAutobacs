/**
 * Who is signed in. The employee record always comes from the server
 * (GET /hr/me); the phone stores only the session (SecureStore, api/client).
 * A dead session (401 after one refresh) lands here via the signed-out handler
 * and the app shows Login.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, IS_MOCK, type Employee } from '../api';

type Phase = 'loading' | 'signedOut' | 'signedIn';

type SessionValue = {
  phase: Phase;
  employee: Employee | null;
  /** /hr/me failed for a reason other than sign-out (offline, no HR profile, 5xx). */
  employeeError: unknown;
  retry: () => void;
  signIn: (identifier: string, password: string) => Promise<void>;
  /** Local + server sign-out. `beforeClear` lets the caller drop queued punches. */
  signOut: (beforeClear?: () => Promise<void>) => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

type Backend = { isSignedIn: () => Promise<boolean>; onSignedOut: (fn: (() => void) | null) => void };

function backend(): Backend {
  if (IS_MOCK) return { isSignedIn: async () => false, onSignedOut: () => {} };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { http, setSignedOutHandler } = require('../api/client') as typeof import('../api/client');
  return { isSignedIn: () => http.isSignedIn(), onSignedOut: setSignedOutHandler };
}

const BACKEND = backend();

export const ME_KEY = ['me'] as const;

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const be = BACKEND;

  useEffect(() => {
    be.isSignedIn().then(setSignedIn, () => setSignedIn(false));
  }, [be]);

  const dropLocal = useCallback(() => {
    setSignedIn(false);
    qc.clear(); // nothing of the previous person stays on screen
  }, [qc]);

  useEffect(() => {
    be.onSignedOut(dropLocal);
    return () => be.onSignedOut(null);
  }, [be, dropLocal]);

  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: () => api.me(),
    enabled: signedIn === true,
    staleTime: 5 * 60_000,
    retry: (n, err) => !(err instanceof ApiError && err.status > 0 && err.status < 500) && n < 2,
  });

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      await api.login(identifier, password);
      qc.removeQueries();
      setSignedIn(true);
    },
    [qc],
  );

  const signOut = useCallback(
    async (beforeClear?: () => Promise<void>) => {
      try {
        await beforeClear?.();
        await api.logout();
      } catch {
        // Offline sign-out still forgets the session on this phone.
      }
      dropLocal();
    },
    [dropLocal],
  );

  const phase: Phase = signedIn === null ? 'loading' : signedIn ? (me.isPending && !me.isError ? 'loading' : 'signedIn') : 'signedOut';

  const value = useMemo<SessionValue>(
    () => ({
      phase,
      employee: me.data ?? null,
      employeeError: me.data ? null : me.error,
      retry: () => void me.refetch(),
      signIn,
      signOut,
    }),
    [phase, me, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

export function useEmployee(): Employee {
  const { employee } = useSession();
  if (!employee) throw new Error('useEmployee before the employee loaded');
  return employee;
}
