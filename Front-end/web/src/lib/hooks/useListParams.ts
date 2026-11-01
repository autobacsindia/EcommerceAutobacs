'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * A list's search / filter / sort, kept in the page address — so Back, a
 * refresh, or a link sent to someone else opens the same filtered list.
 *
 * `defaults` names every key the list owns and what it is when absent; a key at
 * its default is left out of the address (no `?sort=newest&q=` noise). Keys the
 * list does not own (`?task=…`) are kept as they are. The caller's component
 * must sit inside <Suspense> (useSearchParams).
 */
export function useListParams<K extends string>(defaults: Record<K, string>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qs = params.toString();
  /*
    The address as last written. router.replace lands a render later, so two
    changes in a row (pick a sort, then a filter) must build on the first one's
    address, not on the one this render saw — or the first change is lost.
  */
  const latest = useRef(qs);
  useEffect(() => { latest.current = qs; }, [qs]);

  const values = useMemo(() => {
    const current = new URLSearchParams(qs);
    const out = { ...defaults };
    for (const k of Object.keys(defaults) as K[]) {
      const v = current.get(k);
      if (v !== null) out[k] = v;
    }
    return out;
    // `defaults` is a literal at the call site; its contents, not its identity, matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs, JSON.stringify(defaults)]);

  const set = useCallback((patch: Partial<Record<K, string>>) => {
    const next = new URLSearchParams(latest.current);
    for (const [k, v] of Object.entries(patch) as [K, string | undefined][]) {
      if (v === undefined || v === '' || v === defaults[k]) next.delete(k);
      else next.set(k, v);
    }
    const s = next.toString();
    latest.current = s;
    router.replace(`${pathname}${s ? `?${s}` : ''}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, router, JSON.stringify(defaults)]);

  /** Back to the defaults for every key except those in `keep`. */
  const clear = useCallback((keep: K[] = []) => {
    const patch = {} as Partial<Record<K, string>>;
    for (const k of Object.keys(defaults) as K[]) if (!keep.includes(k)) patch[k] = defaults[k];
    set(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, JSON.stringify(defaults)]);

  return { values, set, clear };
}
